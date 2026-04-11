/**
 * debugger-class-e2e.test.ts
 *
 * E2E tests for debugging CTRL classes (base + derived with inheritance).
 *
 * Uses `debug_classes.ctl` (CTRL manager -num 9, manual mode) which imports
 * classes from `libs/classes/Shape.ctl` and `libs/classes/Circle.ctl`.
 *
 * libs/classes/Shape.ctl:
 *   - Shape (base class): private m_name (string), m_sides (int);
 *     constructor Shape(string, int); methods getName(), getSides(), describe()
 *   - line 26: string result = ...   → body of Shape.describe()
 *
 * libs/classes/Circle.ctl:
 *   - Circle (derived : Shape): private m_radius (float);
 *     constructor Circle(string, int, float); methods getRadius(), area()
 *   - line 22: float a = ...         → body of Circle.area()
 *
 * debug_classes.ctl line map:
 *   line 14: DebugBreak()         → WinCC OA reports stop at line 16 (while)
 *   line 18: desc = shapeInstant.describe()
 *   line 19: circleArea = circleInstant.area()
 *
 * Test 1: Class instance variables visible in locals — shapeInstant and
 *         circleInstant are expandable with correct member values.
 * Test 2: BP in base class method (describe) fires with correct stack trace.
 * Test 3: BP in derived class method (area) fires; stack shows class method.
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { waitForCoreApi } from '../../otherExtensions';

type CoreApi = {
    setCurrentProject?: (id: string) => void | Promise<void>;
};

type DapVariable = {
    name: string;
    value: string;
    variablesReference: number;
    indexedVariables?: number;
    namedVariables?: number;
};

// ─── constants ───────────────────────────────────────────────────────────────

/** WinCC OA reports stop at NEXT statement after DebugBreak() — line 16 (while) */
const STOP_LINE = 16;

/** Lines in debug_classes.ctl (main body) */
const BP_DESCRIBE_CALL = 18;  // desc = shapeInstant.describe()
const BP_AREA_CALL = 19;      // circleArea = circleInstant.area()

/** Line in libs/classes/Shape.ctl — body of describe() */
const BP_DESCRIBE_BODY = 26;  // string result = m_name + " has " + ...

/** Line in libs/classes/Circle.ctl — body of area() */
const BP_AREA_BODY = 22;      // float a = 3.14159 * m_radius * m_radius

/** CTRL manager number for debug_classes.ctl */
const CLASS_MANAGER = 9;

const DEBUGBREAK_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E class debugging (debug_classes)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[class-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[class-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[class-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[class-e2e] Project started');

        console.log('[class-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[class-e2e] Step 3: Opening debug_classes.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('debug_classes.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[class-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[class-e2e] Active project set to "runnable"');
            }
        } catch (err) {
            console.warn(`[class-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`);
        }

        console.log('[class-e2e] ✓ Setup complete');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(30_000);

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }
        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle.stop().catch((e: Error) =>
                console.error(`[class-e2e] stop failed: ${e.message}`),
            );
        }
    });

    // ── helpers ───────────────────────────────────────────────────────────────

    function buildLaunchConfig(name: string): vscode.DebugConfiguration {
        const base = lifecycle.getBaseLaunchConfig();
        return {
            type: 'winccoa',
            request: 'attach',
            name,
            ...base,
            manager: { type: 'CTRL', number: CLASS_MANAGER },
            stopOnEntry: true,
            trace: true,
        };
    }

    /**
     * Continue until a BP fires at the expected line in the expected source
     * (tolerates WinCC OA double-click / main-BP resends).
     */
    async function continueUntilBp(
        helper: DebugSessionHelper,
        threadId: number,
        expectedLine: number,
        expectedSrcSubstring: string,
        maxAttempts: number = 5,
    ): Promise<{
        threadId: number;
        stackFrames: Array<{ id: number; line: number; source?: { name?: string; path?: string } }>;
    }> {
        let lastThreadId = threadId;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await helper.request('continue', { threadId: lastThreadId });
            const stopEvent = await helper.waitForEvent('stopped', 15_000);
            const body = stopEvent.body as { reason?: string; threadId?: number };
            assert.strictEqual(body?.reason, 'breakpoint', `stop must be breakpoint (attempt ${attempt + 1})`);
            lastThreadId = body.threadId!;

            const st = await helper.request<{
                stackFrames: Array<{ id: number; line: number; source?: { name?: string; path?: string } }>;
            }>('stackTrace', { threadId: lastThreadId, levels: 5 });

            const topLine = st.stackFrames[0].line;
            const topSrc = st.stackFrames[0].source?.name ?? st.stackFrames[0].source?.path ?? '';

            if (topLine === expectedLine && topSrc.toLowerCase().includes(expectedSrcSubstring.toLowerCase())) {
                console.log(`[class-e2e] ✔ Hit ${topSrc}:${topLine} (attempt ${attempt + 1})`);
                return { threadId: lastThreadId, stackFrames: st.stackFrames };
            }

            console.log(`[class-e2e] Stop at ${topSrc}:${topLine}, want ${expectedSrcSubstring}:${expectedLine} — continuing (attempt ${attempt + 1})…`);
        }
        assert.fail(`Expected BP at ${expectedSrcSubstring}:${expectedLine} not reached within ${maxAttempts} attempts`);
    }

    /**
     * Get the Locals scope variables for the current stop.
     */
    async function getLocals(
        helper: DebugSessionHelper,
        threadId: number,
    ): Promise<DapVariable[]> {
        const st = await helper.request<{ stackFrames: Array<{ id: number }> }>(
            'stackTrace', { threadId, levels: 1 },
        );
        const frameId = st.stackFrames[0].id;

        const scopes = await helper.request<{
            scopes: Array<{ name: string; variablesReference: number }>;
        }>('scopes', { frameId });

        const localsScope = scopes.scopes.find((s) => s.name === 'Locals') ?? scopes.scopes[0];
        const vars = await helper.request<{ variables: DapVariable[] }>(
            'variables', { variablesReference: localsScope.variablesReference },
        );

        console.log('[class-e2e] === LOCALS ===');
        for (const v of vars.variables) {
            console.log(`  ${v.name}: ${JSON.stringify(v.value)}  (varRef=${v.variablesReference})`);
        }
        console.log('[class-e2e] === END ===');

        return vars.variables;
    }

    // ── Test 1: Class instance variables visible in locals ───────────────────

    test('class instances visible in locals with expandable members', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('debug_classes.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // BP at the describe() call line — so class instances are initialized
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mainScriptPath),
                new vscode.Position(BP_DESCRIBE_CALL - 1, 0),
            ),
        );
        addedBreakpoints = [mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await lifecycle.startManagerByNum(CLASS_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: class variables'),
                25_000,
            );
            console.log('[class-e2e] debug session started');

            // ── DebugBreak entry stop ─────────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                ['entry', 'pause', 'breakpoint'].includes(entryBody?.reason ?? ''),
                `entry stop reason must be entry|pause|breakpoint, got "${entryBody?.reason}"`,
            );
            const entryThreadId = entryBody.threadId!;
            console.log('[class-e2e] DebugBreak entry ✔');

            // ── Step past while(true) — WinCC OA sticks on the while line ─────
            await helper.request('next', { threadId: entryThreadId });
            const whileStop = await helper.waitForEvent('stopped', 15_000);
            const whileBody = whileStop.body as { threadId?: number };
            const loopThreadId = whileBody.threadId ?? entryThreadId;
            console.log('[class-e2e] Stepped past while ✔');

            // ── Continue to BP_DESCRIBE_CALL line ─────────────────────────────
            const result = await continueUntilBp(
                helper, loopThreadId, BP_DESCRIBE_CALL, 'debug_classes',
            );
            console.log(`[class-e2e] Stopped at describe call line ${BP_DESCRIBE_CALL} ✔`);

            // ── Get locals and validate class instances ───────────────────────
            const vars = await getLocals(helper, result.threadId);

            const find = (name: string) => {
                const v = vars.find((x) => x.name === name);
                assert.ok(v, `variable "${name}" must be present in Locals (got: ${vars.map((x) => x.name).join(', ')})`);
                return v!;
            };

            // Shape instance: should be expandable
            const shapeVar = find('shapeInstant');
            assert.ok(shapeVar.variablesReference > 0, 'shapeInstant must be expandable (class instance)');
            console.log(`[class-e2e] shapeInstant: value="${shapeVar.value}" varRef=${shapeVar.variablesReference}`);

            // Expand shape members
            const shapeChildren = await helper.request<{ variables: DapVariable[] }>(
                'variables', { variablesReference: shapeVar.variablesReference },
            );
            console.log('[class-e2e] shapeInstant children:');
            for (const c of shapeChildren.variables) {
                console.log(`  ${c.name}: ${JSON.stringify(c.value)} (varRef=${c.variablesReference})`);
            }

            // Verify shape members (private m_name, m_sides)
            const shapeName = shapeChildren.variables.find((c) => c.name === 'm_name');
            const shapeSides = shapeChildren.variables.find((c) => c.name === 'm_sides');
            assert.ok(shapeName, '"m_name" member must be present in Shape');
            assert.ok(shapeSides, '"m_sides" member must be present in Shape');
            assert.strictEqual(shapeName!.value, '"Triangle"', 'Shape.m_name must be "Triangle"');
            assert.strictEqual(shapeSides!.value, '3', 'Shape.m_sides must be 3');

            // Circle instance: should be expandable
            const circleVar = find('circleInstant');
            assert.ok(circleVar.variablesReference > 0, 'circleInstant must be expandable (class instance)');
            console.log(`[class-e2e] circleInstant: value="${circleVar.value}" varRef=${circleVar.variablesReference}`);

            // Expand circle members
            const circleChildren = await helper.request<{ variables: DapVariable[] }>(
                'variables', { variablesReference: circleVar.variablesReference },
            );
            console.log('[class-e2e] circleInstant children:');
            for (const c of circleChildren.variables) {
                console.log(`  ${c.name}: ${JSON.stringify(c.value)} (varRef=${c.variablesReference})`);
            }

            // Verify circle has radius + inherited members (private m_radius, m_name, m_sides)
            const circleRadius = circleChildren.variables.find((c) => c.name === 'm_radius');
            assert.ok(circleRadius, '"m_radius" member must be present in Circle');
            assert.ok(circleRadius!.value.startsWith('2.5'), `Circle.m_radius must start with "2.5", got ${circleRadius!.value}`);

            // Circle inherits from Shape — check inherited members
            const circleName = circleChildren.variables.find((c) => c.name === 'm_name');
            const circleSides = circleChildren.variables.find((c) => c.name === 'm_sides');
            assert.ok(circleName, '"m_name" (inherited) must be present in Circle');
            assert.ok(circleSides, '"m_sides" (inherited) must be present in Circle');
            assert.strictEqual(circleName!.value, '"Circle"', 'Circle.m_name (inherited) must be "Circle"');
            assert.strictEqual(circleSides!.value, '0', 'Circle.m_sides (inherited) must be 0');

            console.log('[class-e2e] ✅ Class instances visible with correct members');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(CLASS_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── Test 2: BP in base class method (describe) fires ─────────────────────

    test('BP in base class method (Shape.describe) fires with correct stack', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('debug_classes.ctl');
        const shapeClassPath = lifecycle.getScriptPath('libs/classes/Shape.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // BP inside describe() method body in Shape.ctl
        const describeBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(shapeClassPath),
                new vscode.Position(BP_DESCRIBE_BODY - 1, 0),
            ),
        );
        // Main-script BP for execution control
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mainScriptPath),
                new vscode.Position(BP_DESCRIBE_CALL - 1, 0),
            ),
        );
        addedBreakpoints = [describeBp, mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await lifecycle.startManagerByNum(CLASS_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: class method BP'),
                25_000,
            );
            console.log('[class-e2e] debug session started');

            // ── DebugBreak entry stop ─────────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                ['entry', 'pause', 'breakpoint'].includes(entryBody?.reason ?? ''),
                `entry stop reason must be entry|pause|breakpoint, got "${entryBody?.reason}"`,
            );
            const entryThreadId = entryBody.threadId!;
            console.log('[class-e2e] DebugBreak entry ✔');

            // ── Step past while(true) — WinCC OA sticks on the while line ─────
            await helper.request('next', { threadId: entryThreadId });
            const whileStop = await helper.waitForEvent('stopped', 15_000);
            const whileBody = whileStop.body as { threadId?: number };
            const loopThreadId = whileBody.threadId ?? entryThreadId;
            console.log('[class-e2e] Stepped past while ✔');

            // ── Continue until BP in describe() body ──────────────────────────
            const result = await continueUntilBp(
                helper, loopThreadId, BP_DESCRIBE_BODY, 'Shape',
            );

            // ── Validate stack trace ──────────────────────────────────────────
            const frames = result.stackFrames;
            assert.ok(frames.length >= 2,
                `stack must have ≥2 frames (describe → main), got ${frames.length}`);

            const frame0Src = frames[0].source?.name ?? frames[0].source?.path ?? '';

            assert.ok(frame0Src.includes('Shape'),
                `frame 0 must be Shape.ctl, got "${frame0Src}"`);
            assert.strictEqual(frames[0].line, BP_DESCRIBE_BODY,
                `frame 0 must be line ${BP_DESCRIBE_BODY} (describe body)`);

            console.log(`[class-e2e] Stack trace:`);
            for (let i = 0; i < Math.min(frames.length, 3); i++) {
                const src = frames[i].source?.name ?? frames[i].source?.path ?? '';
                console.log(`  #${i} ${src}:${frames[i].line}`);
            }
            console.log('[class-e2e] ✅ BP in Shape.describe() fired with correct stack');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(CLASS_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── Test 3: BP in derived class method (Circle.area) fires ───────────────

    test('BP in derived class method (Circle.area) fires with correct stack', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('debug_classes.ctl');
        const circleClassPath = lifecycle.getScriptPath('libs/classes/Circle.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // BP inside area() method body in Circle.ctl
        const areaBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(circleClassPath),
                new vscode.Position(BP_AREA_BODY - 1, 0),
            ),
        );
        // Main-script BP for execution control
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mainScriptPath),
                new vscode.Position(BP_AREA_CALL - 1, 0),
            ),
        );
        addedBreakpoints = [areaBp, mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await lifecycle.startManagerByNum(CLASS_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: derived class method BP'),
                25_000,
            );
            console.log('[class-e2e] debug session started');

            // ── DebugBreak entry stop ─────────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                ['entry', 'pause', 'breakpoint'].includes(entryBody?.reason ?? ''),
                `entry stop reason must be entry|pause|breakpoint, got "${entryBody?.reason}"`,
            );
            const entryThreadId = entryBody.threadId!;
            console.log('[class-e2e] DebugBreak entry ✔');

            // ── Step past while(true) — WinCC OA sticks on the while line ─────
            await helper.request('next', { threadId: entryThreadId });
            const whileStop = await helper.waitForEvent('stopped', 15_000);
            const whileBody = whileStop.body as { threadId?: number };
            const loopThreadId = whileBody.threadId ?? entryThreadId;
            console.log('[class-e2e] Stepped past while ✔');

            // ── Continue until BP in area() body ──────────────────────────────
            const result = await continueUntilBp(
                helper, loopThreadId, BP_AREA_BODY, 'Circle',
            );

            // ── Validate stack trace ──────────────────────────────────────────
            const frames = result.stackFrames;
            assert.ok(frames.length >= 2,
                `stack must have ≥2 frames (area → main), got ${frames.length}`);

            const frame0Src = frames[0].source?.name ?? frames[0].source?.path ?? '';

            assert.ok(frame0Src.includes('Circle'),
                `frame 0 must be Circle.ctl, got "${frame0Src}"`);
            assert.strictEqual(frames[0].line, BP_AREA_BODY,
                `frame 0 must be line ${BP_AREA_BODY} (area body)`);

            console.log(`[class-e2e] Stack trace:`);
            for (let i = 0; i < Math.min(frames.length, 3); i++) {
                const src = frames[i].source?.name ?? frames[i].source?.path ?? '';
                console.log(`  #${i} ${src}:${frames[i].line}`);
            }
            console.log('[class-e2e] ✅ BP in Circle.area() fired with correct stack');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(CLASS_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
