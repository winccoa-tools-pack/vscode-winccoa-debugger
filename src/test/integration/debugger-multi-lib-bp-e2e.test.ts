/**
 * debugger-multi-lib-bp-e2e.test.ts
 *
 * E2E tests for breakpoints across multiple libraries and nested lib depth.
 *
 * Uses `call_multi_libs.ctl` (CTRL manager -num 8, manual mode) which imports:
 *   - `math_lib`   → multiply_two(a, b)           — direct lib
 *   - `nested_lib`  → add_then_double(a, b)        — direct lib that #uses debugger_lib
 *   - `debugger_lib` (via nested_lib) → add_two_integers(a, b) — nested lib (depth 2)
 *
 * Key line numbers:
 *   call_multi_libs.ctl, line 22: DebugBreak()     (WinCC OA reports stop at line 24)
 *   call_multi_libs.ctl, line 26: multiply_two     ← BP_MAIN_MATH
 *   call_multi_libs.ctl, line 27: add_then_double  ← BP_MAIN_NESTED
 *   libs/math_lib.ctl, line 7:    int result = a * b       ← BP_MATH_LINE
 *   libs/nested_lib.ctl, line 9:  int added = add_two_integers(a, b) ← BP_NESTED_LINE
 *   libs/debugger_lib.ctl, line 7: int sum = a + b          ← BP_DEEP_LINE
 *
 * Test 1 — multi-lib BPs: BPs in two different libs (math_lib + nested_lib) both fire.
 * Test 2 — nested depth:  BP in debugger_lib fires when called via nested_lib (depth 2).
 *          Stack trace must show 3 frames: debugger_lib → nested_lib → call_multi_libs.
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

// ─── constants ───────────────────────────────────────────────────────────────

/** WinCC OA reports stop at NEXT statement after DebugBreak() — line 24 (while) */
const STOP_LINE = 24;

/** call_multi_libs.ctl line numbers */
const BP_MAIN_MATH = 26; // result1 = multiply_two(...)
const BP_MAIN_NESTED = 27; // result2 = add_then_double(...)

/** Library BP lines */
const BP_MATH_LINE = 7; // math_lib.ctl: int result = a * b
const BP_NESTED_LINE = 9; // nested_lib.ctl: int added = add_two_integers(a, b)
const BP_DEEP_LINE = 7; // debugger_lib.ctl: int sum = a + b

/** CTRL manager number for call_multi_libs.ctl */
const MULTI_LIB_MANAGER = 8;

/** ms to wait for DebugBreak() to fire before attaching */
const DEBUGBREAK_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E multi-library breakpoints (call_multi_libs)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[multi-lib-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[multi-lib-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[multi-lib-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[multi-lib-e2e] Project started');

        console.log('[multi-lib-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[multi-lib-e2e] Step 3: Opening call_multi_libs.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('call_multi_libs.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[multi-lib-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[multi-lib-e2e] Active project set to "runnable"');
            } else {
                console.warn('[multi-lib-e2e] Core API not available');
            }
        } catch (err) {
            console.warn(
                `[multi-lib-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`,
            );
        }

        console.log('[multi-lib-e2e] ✓ Setup complete');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(30_000);

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }

        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle
                .stop()
                .catch((e: Error) => console.error(`[multi-lib-e2e] stop failed: ${e.message}`));
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
            manager: { type: 'CTRL', number: MULTI_LIB_MANAGER },
            stopOnEntry: true,
            trace: true,
        };
    }

    /**
     * Continue until a breakpoint fires in the specified library file at the
     * given line. Tolerates up to `maxAttempts` extra stops at main-script BP
     * lines (WinCC OA double-click behavior).
     */
    async function continueUntilLibBp(
        helper: DebugSessionHelper,
        threadId: number,
        expectedLine: number,
        expectedSrcSubstring: string,
        maxAttempts: number = 5,
    ): Promise<{
        threadId: number;
        stackFrames: Array<{ line: number; source?: { name?: string; path?: string } }>;
    }> {
        let lastThreadId = threadId;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await helper.request('continue', { threadId: lastThreadId });
            const stopEvent = await helper.waitForEvent('stopped', 15_000);
            const body = stopEvent.body as { reason?: string; threadId?: number };
            assert.strictEqual(
                body?.reason,
                'breakpoint',
                `stop must be a breakpoint (attempt ${attempt + 1})`,
            );
            lastThreadId = body.threadId!;

            const st = await helper.request<{
                stackFrames: Array<{ line: number; source?: { name?: string; path?: string } }>;
            }>('stackTrace', { threadId: lastThreadId, levels: 5 });

            const topLine = st.stackFrames[0].line;
            const topSrc = st.stackFrames[0].source?.name ?? st.stackFrames[0].source?.path ?? '';

            if (
                topLine === expectedLine &&
                topSrc.toLowerCase().includes(expectedSrcSubstring.toLowerCase())
            ) {
                console.log(`[multi-lib-e2e] ✔ Hit ${topSrc}:${topLine} (attempt ${attempt + 1})`);
                return { threadId: lastThreadId, stackFrames: st.stackFrames };
            }

            console.log(
                `[multi-lib-e2e] Stop at ${topSrc}:${topLine}, want ${expectedSrcSubstring}:${expectedLine} — continuing (attempt ${attempt + 1})…`,
            );
        }
        assert.fail(
            `Expected BP at ${expectedSrcSubstring}:${expectedLine} not reached within ${maxAttempts} attempts`,
        );
    }

    // ── Test 1: BPs in two different libraries both fire ─────────────────────

    test('BPs in math_lib and nested_lib both fire from same script', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('call_multi_libs.ctl');
        const mathLibPath = lifecycle.getScriptPath('libs/math_lib.ctl');
        const nestedLibPath = lifecycle.getScriptPath('libs/nested_lib.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // Set BPs in both libraries
        const mathBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mathLibPath),
                new vscode.Position(BP_MATH_LINE - 1, 0),
            ),
        );
        const nestedBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(nestedLibPath),
                new vscode.Position(BP_NESTED_LINE - 1, 0),
            ),
        );
        // Also set a main-script BP so execution pauses predictably
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mainScriptPath),
                new vscode.Position(BP_MAIN_MATH - 1, 0),
            ),
        );
        addedBreakpoints = [mathBp, nestedBp, mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await lifecycle.startManagerByNum(MULTI_LIB_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(undefined, buildLaunchConfig('E2E: multi-lib BPs'), 25_000);
            console.log('[multi-lib-e2e] debug session started');

            // ── DebugBreak entry stop ─────────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                ['entry', 'pause', 'breakpoint'].includes(entryBody?.reason ?? ''),
                `entry stop reason must be entry|pause|breakpoint, got "${entryBody?.reason}"`,
            );

            const entryThreadId = entryBody.threadId!;
            const entrySt = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace',
                { threadId: entryThreadId, levels: 1 },
            );
            assert.strictEqual(
                entrySt.stackFrames[0].line,
                STOP_LINE,
                `entry stop must be at line ${STOP_LINE}`,
            );
            console.log(`[multi-lib-e2e] DebugBreak entry at line ${STOP_LINE} ✔`);

            // ── Hit math_lib BP ───────────────────────────────────────────────
            const mathResult = await continueUntilLibBp(
                helper,
                entryThreadId,
                BP_MATH_LINE,
                'math_lib',
            );
            console.log('[multi-lib-e2e] math_lib BP confirmed ✔');

            // ── Hit nested_lib BP ─────────────────────────────────────────────
            const _nestedResult = await continueUntilLibBp(
                helper,
                mathResult.threadId,
                BP_NESTED_LINE,
                'nested_lib',
            );
            console.log('[multi-lib-e2e] nested_lib BP confirmed ✔');

            console.log('[multi-lib-e2e] ✅ Both library BPs fired successfully');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(MULTI_LIB_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── Test 2: BP in nested depth-2 lib fires with correct stack trace ──────
    // TODO: Skipped — after cont from stopOnEntry, VS Code re-sends setBreakpoints
    //       which triggers reapplyAllBreakpoints → delete-all while script is running.
    //       Also startPendingBpRetryTimer is not started for stopOnEntry sessions.
    //       Needs adapter-level fix before this test can pass.

    test.skip('BP in depth-2 lib (debugger_lib via nested_lib) fires with 3-frame stack', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('call_multi_libs.ctl');
        const deepLibPath = lifecycle.getScriptPath('libs/debugger_lib.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // BP only in the deepest lib (debugger_lib) — called via nested_lib
        const deepBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(deepLibPath),
                new vscode.Position(BP_DEEP_LINE - 1, 0),
            ),
        );
        // Main-script BP to ensure execution control
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(mainScriptPath),
                new vscode.Position(BP_MAIN_NESTED - 1, 0),
            ),
        );
        addedBreakpoints = [deepBp, mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await lifecycle.startManagerByNum(MULTI_LIB_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: nested lib depth-2'),
                25_000,
            );
            console.log('[multi-lib-e2e] debug session started');

            // ── DebugBreak entry stop ─────────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                ['entry', 'pause', 'breakpoint'].includes(entryBody?.reason ?? ''),
                `entry stop reason must be entry|pause|breakpoint, got "${entryBody?.reason}"`,
            );
            const entryThreadId = entryBody.threadId!;
            console.log(`[multi-lib-e2e] DebugBreak entry ✔`);

            // ── Continue until debugger_lib BP fires ──────────────────────────
            const deepResult = await continueUntilLibBp(
                helper,
                entryThreadId,
                BP_DEEP_LINE,
                'debugger_lib',
            );

            // ── Validate stack trace: must have 3 frames ─────────────────────
            // Frame 0: debugger_lib.ctl (add_two_integers)
            // Frame 1: nested_lib.ctl (add_then_double)
            // Frame 2: call_multi_libs.ctl (main)
            const frames = deepResult.stackFrames;
            assert.ok(
                frames.length >= 3,
                `stack must have ≥3 frames for nested call, got ${frames.length}`,
            );

            const frame0Src = frames[0].source?.name ?? frames[0].source?.path ?? '';
            const frame1Src = frames[1].source?.name ?? frames[1].source?.path ?? '';
            const frame2Src = frames[2].source?.name ?? frames[2].source?.path ?? '';

            assert.ok(
                frame0Src.toLowerCase().includes('debugger_lib'),
                `frame 0 must be debugger_lib, got "${frame0Src}"`,
            );
            assert.ok(
                frame1Src.toLowerCase().includes('nested_lib'),
                `frame 1 must be nested_lib, got "${frame1Src}"`,
            );
            assert.ok(
                frame2Src.toLowerCase().includes('call_multi_libs'),
                `frame 2 must be call_multi_libs, got "${frame2Src}"`,
            );

            console.log(`[multi-lib-e2e] Stack trace:`);
            console.log(`  #0 ${frame0Src}:${frames[0].line}`);
            console.log(`  #1 ${frame1Src}:${frames[1].line}`);
            console.log(`  #2 ${frame2Src}:${frames[2].line}`);
            console.log('[multi-lib-e2e] ✅ Nested depth-2 lib BP with correct 3-frame stack');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(MULTI_LIB_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
