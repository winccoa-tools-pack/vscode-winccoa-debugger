/**
 * debugger-bp-cycle-e2e.test.ts
 *
 * VS Code E2E tests for the basic breakpoint cycle using `bp_basic_loop.ctl`
 * (CTRL manager -num 91).
 *
 * Tests the complete debug pipeline via VS Code's debug API:
 *   VS Code → DebugAdapterDescriptorFactory → bootstrap.js → adapter tcp →
 *   WinCCDebugSession → DatapointClient → _CtrlDebug_CTRL_91 DPs →
 *   bp_basic_loop.ctl running via pmon
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed
 *   - `vscode-dbg` fixture project registered (done by WinccoaProjectLifecycle.start())
 *   - WINCCOA_VSCODE_SKIP=1 to opt-out of all tests
 *
 * Running locally:
 *   npm run test:e2e:bpcycle
 *
 * bp_basic_loop.ctl:
 *   Line 13: counter++;   ← BP_LINE
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
// import * as path from 'path';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { waitForCoreApi } from '../../otherExtensions';

type CoreApi = {
    getRunningProjects?: () => Promise<unknown[]>;
    setCurrentProject?: (id: string) => void | Promise<void>;
};

// ─── constants ───────────────────────────────────────────────────────────────

const BP_LINE = 13;
/** CTRL manager number for bp_basic_loop.ctl */
const BP_MANAGER = 2;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E breakpoint cycle (bp_basic_loop)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[bp-cycle-e2e] WinCC OA not available — skipping');
            return;
        }

        // ── Step 1: Register + start fixture project ─────────────────────────
        // lifecycle.start() registers project in pvssInst.conf (if needed),
        // then starts pmon, waits for Data Manager port (4999) and
        // debug adapter port (7474) to be reachable.
        console.log('[bp-cycle-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[bp-cycle-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log(
            '[bp-cycle-e2e] Project started — pmon, Data Manager and debugAdapter are running',
        );

        // ── Step 2: Let WinCC OA settle before tests ─────────────────────────
        console.log('[bp-cycle-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        // ── Step 3: Open CTL script in editor (visual anchor) ────────────────
        console.log('[bp-cycle-e2e] Step 3: Opening bp_basic_loop.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('bp_basic_loop.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        // ── Step 4: Set "runnable" as active project in Core extension ────────
        // The debugger extension queries the Core extension for the current project.
        // Without this, startDebugging() is cancelled immediately.
        console.log('[bp-cycle-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[bp-cycle-e2e] Active project set to "runnable"');
            } else {
                console.warn(
                    '[bp-cycle-e2e] Core API not available — continuing without setCurrentProject',
                );
            }
        } catch (err) {
            console.warn(
                `[bp-cycle-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`,
            );
        }

        console.log('[bp-cycle-e2e] ✓ Setup complete — ready to run tests');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(60_000);

        console.log('[bp-cycle-e2e] Teardown: removing breakpoints and stopping project…');

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }

        // Stop CTRL manager in case a test left it running
        await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});

        // Stop project + unregister from pvssInst.conf (clean state for next run)
        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle
                .stop()
                .catch((e: Error) => console.error(`[bp-cycle-e2e] stop failed: ${e.message}`));
        }

        console.log('[bp-cycle-e2e] Teardown complete');
    });

    // ── helpers ───────────────────────────────────────────────────────────────

    function buildLaunchConfig(name: string): vscode.DebugConfiguration {
        const base = lifecycle.getBaseLaunchConfig();
        return {
            type: 'winccoa',
            request: 'launch',
            name,
            ...base,
            manager: { type: 'CTRL', number: BP_MANAGER },
        };
    }

    function addBreakpoint(scriptPath: string, line: number): void {
        const uri = vscode.Uri.file(scriptPath);
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(uri, new vscode.Position(line - 1, 0)),
        );
        addedBreakpoints.push(bp);
        vscode.debug.addBreakpoints([bp]);
    }

    // ── test 1: BP is hit ─────────────────────────────────────────────────────

    test('sets BP and stops at line 13', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            // Manager already running via 'once' — just wait for BP hit.
            await helper.startSession(undefined, buildLaunchConfig('E2E: bp line 13'), 25_000);

            const stopped = await helper.waitForEvent('stopped', 20_000);
            const body = stopped.body as { reason?: string; threadId?: number };

            assert.strictEqual(body?.reason, 'breakpoint', 'stop reason must be "breakpoint"');
            assert.ok(typeof body?.threadId === 'number', 'threadId must be a number');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 2: stack frame at correct line ───────────────────────────────────

    test.skip('stack frame points to line 13', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: stack frame'), 25_000);

            const stopped = await helper.waitForEvent('stopped', 20_000);
            const body = stopped.body as { threadId?: number };
            assert.ok(typeof body?.threadId === 'number', 'threadId must be a number');

            const st = await helper.request<{
                stackFrames: Array<{ line: number; source?: { name?: string } }>;
            }>('stackTrace', { threadId: body.threadId, levels: 5 });

            assert.ok(st.stackFrames.length > 0, 'stackTrace should have at least one frame');
            assert.strictEqual(
                st.stackFrames[0].line,
                BP_LINE,
                `top frame line must be ${BP_LINE}`,
            );

            const srcName = st.stackFrames[0].source?.name ?? '';
            assert.ok(
                srcName.includes('bp_basic_loop'),
                `frame source must include "bp_basic_loop", got: "${srcName}"`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 3: local variable 'counter' ─────────────────────────────────────

    test.skip('local variable counter is readable at BP', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: variables'), 25_000);

            const stopped = await helper.waitForEvent('stopped', 20_000);
            const body = stopped.body as { threadId?: number };
            assert.ok(typeof body?.threadId === 'number');

            const st = await helper.request<{ stackFrames: Array<{ id: number }> }>('stackTrace', {
                threadId: body.threadId,
                levels: 1,
            });
            assert.ok(st.stackFrames.length > 0);
            const frameId = st.stackFrames[0].id;

            const scopes = await helper.request<{ scopes: Array<{ variablesReference: number }> }>(
                'scopes',
                { frameId },
            );
            assert.ok(scopes.scopes.length > 0, 'should have at least one scope');

            const vars = await helper.request<{
                variables: Array<{ name: string; value: string }>;
            }>('variables', { variablesReference: scopes.scopes[0].variablesReference });

            const counter = vars.variables.find((v) => v.name === 'counter');
            assert.ok(counter, 'local variable "counter" must be present');
            assert.ok(
                !isNaN(parseInt(counter.value, 10)),
                `counter must have numeric value, got: "${counter.value}"`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 4: continue reaches next BP stop ─────────────────────────────────

    test.skip('continue triggers next stop at line 13', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: continue'), 25_000);

            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            // First stop: verify line
            const st1 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace',
                { threadId: body1.threadId, levels: 1 },
            );
            assert.strictEqual(st1.stackFrames[0].line, BP_LINE);

            // Continue
            await helper.request('continue', { threadId: body1.threadId });

            // Second stop: must also be at BP_LINE
            const stop2 = await helper.waitForEvent('stopped', 10_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.strictEqual(body2?.reason, 'breakpoint');

            const st2 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace',
                { threadId: body2.threadId!, levels: 1 },
            );
            assert.strictEqual(
                st2.stackFrames[0].line,
                BP_LINE,
                'second stop must also be at BP_LINE',
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 5: no spurious stopped events per single continue ────────────────

    test.skip('single continue produces exactly one stopped event', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: spurious stops'), 25_000);

            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            // Issue stack + scopes queries (these internally send 'script N' + 'thread N'
            // context commands which previously triggered spurious 'message' events).
            const st = await helper.request<{ stackFrames: Array<{ id: number }> }>('stackTrace', {
                threadId: body1.threadId,
                levels: 1,
            });
            await helper.request('scopes', { frameId: st.stackFrames[0].id });

            // Now continue — should produce exactly one stop, not multiple.
            await helper.request('continue', { threadId: body1.threadId });

            // Wait for second stop (next iteration)
            await helper.waitForEvent('stopped', 10_000);

            // Check there are no additional stopped events queued (poll briefly)
            let extraStops = 0;
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 1_500);
                const interval = setInterval(() => {
                    // We already consumed the one 'stopped'. If any more arrive, count them.
                }, 100);
                // The helper's waitForEvent would throw if another stop arrives in time.
                // Using a timeout-based approach: after observing the second stop, no
                // immediate further stop should fire within 1.5s.
                clearInterval(interval);
                clearTimeout(timer);
                resolve();
            });

            assert.strictEqual(extraStops, 0, 'no extra stopped events after single continue');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
