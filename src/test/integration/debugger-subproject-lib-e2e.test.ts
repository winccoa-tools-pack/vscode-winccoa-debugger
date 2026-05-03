/**
 * debugger-subproject-lib-e2e.test.ts
 *
 * VS Code E2E tests for debugging scripts that use libraries from a sub-project
 * (referenced via `pvss_path` in the runnable project's config).
 *
 * Uses `call_subproject_lib.ctl` (CTRL manager -num 10, manual mode)
 * which imports `libs/sub_math.ctl` from the sub-project via `#uses "sub_math"`.
 *
 * Key line numbers:
 *   call_subproject_lib.ctl, line 13: DebugBreak()            (WinCC OA reports stop at line 15)
 *   call_subproject_lib.ctl, line 17: result = sub_multiply_add(...)  ← BP_MAIN_LINE
 *
 * Manager number 10 also validates the auto-create debug DP feature:
 * WinCC OA only pre-creates _CtrlDebug_CTRL_1 through _9 during project setup.
 * The debug adapter must auto-create _CtrlDebug_CTRL_10 via dpCreate before
 * dpConnect can succeed.
 *
 * What this test verifies:
 *   - dpCreate auto-creation for manager ≥10 (adapter creates _CtrlDebug_CTRL_10)
 *   - Session-first flow (session started before manager so DP exists at manager start)
 *   - DebugBreak() detection in scripts using sub-project libraries
 *   - Breakpoint at a line calling a sub-project library function (BP_MAIN_LINE 17)
 *   - Sub-project library loading via pvss_path (#uses "sub_math" resolves correctly)
 *
 * Test flow:
 *   1. Session attaches with stopOnEntry=false and NO breakpoints set yet.
 *      The adapter auto-creates _CtrlDebug_CTRL_10 during connect().
 *      No BPs ⇒ no setBreakpoints requests ⇒ configurationDone completes instantly.
 *      (Setting BPs before session would trigger 'info scripts' against a non-running
 *       CTRL manager, causing ~40 s of command timeouts.)
 *   2. Start manager 10 (manual) → #uses loads sub_math from sub-project → DebugBreak() fires
 *   3. Adapter receives stop → StoppedEvent(breakpoint) at line 15
 *   4. Add main-script BP (line 17)
 *   5. continue → hit BP_MAIN_LINE 17
 *
 * NOTE: WinCC OA CTRL debugger limitations with sub-project (pvss_path) libraries:
 *   - 'info libs' only returns system libraries — sub-project libs are not listed
 *   - 'step in' does NOT enter function bodies (behaves like 'continue to next BP')
 *   - 'step over' across sub-project library calls times out
 *   - Multiple BPs in the same script: only the first-hit BP fires reliably
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

/**
 * WinCC OA reports the stop at the NEXT statement after DebugBreak() —
 * line 15 (`while (true)`) rather than line 13 (DebugBreak itself).
 */
const STOP_LINE = 15;
/** Line in call_subproject_lib.ctl — `result = sub_multiply_add(counter, 7);` */
const BP_MAIN_LINE = 17;

/** CTRL manager number for call_subproject_lib.ctl (≥10 → tests dpCreate auto-create) */
const SUB_MANAGER = 10;

/** ms to wait for DebugBreak() to fire before attaching */
const DEBUGBREAK_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E sub-project debugging (call_subproject_lib)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[sub-proj-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[sub-proj-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[sub-proj-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[sub-proj-e2e] Project started');

        console.log('[sub-proj-e2e] Step 2: Waiting for services to stabilize…');
        await sleep(3_000);

        console.log('[sub-proj-e2e] Step 3: Opening call_subproject_lib.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('call_subproject_lib.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[sub-proj-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[sub-proj-e2e] Active project set to "runnable"');
            } else {
                console.warn(
                    '[sub-proj-e2e] Core API not available — continuing without setCurrentProject',
                );
            }
        } catch (err) {
            console.warn(
                `[sub-proj-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`,
            );
        }

        console.log('[sub-proj-e2e] ✓ Setup complete — ready to run tests');
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
                .catch((e: Error) => console.error(`[sub-proj-e2e] stop failed: ${e.message}`));
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
            manager: { type: 'CTRL', number: SUB_MANAGER },
            // stopOnEntry MUST be false: the session is started BEFORE the CTRL
            // manager so the adapter auto-creates _CtrlDebug_CTRL_10. The manager
            // needs the DP to exist at startup for its debug interface. Once the
            // manager starts and hits DebugBreak(), the adapter receives the stop
            // via dpConnect.
            stopOnEntry: false,
            trace: true,
        };
    }

    // ── test: sub-project library function call via BP ─────────────────────

    test('BP at sub_multiply_add call fires and dpCreate auto-creates DP', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(90_000);

        const mainScriptPath = lifecycle.getScriptPath('call_subproject_lib.ctl');
        const helper = new DebugSessionHelper('winccoa');
        const mainUri = vscode.Uri.file(mainScriptPath);

        // Do NOT add breakpoints before startSession — the adapter would try
        // 'info scripts' / 'info libs' commands against a non-running CTRL
        // manager, causing ~40 s of command timeouts.

        try {
            // ── Phase 1: start session (creates _CtrlDebug_CTRL_10) ──────────
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: sub-project library BP'),
                25_000,
            );
            console.log('[sub-proj-e2e] debug session started (DP auto-created for manager 10)');

            // ── Phase 2: start CTRL manager (DP already exists) ──────────────
            await lifecycle.startManagerByNum(SUB_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);
            console.log('[sub-proj-e2e] manager 10 started — waiting for DebugBreak stop');

            // ── Step 1: DebugBreak stop ──────────────────────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                entryBody?.reason === 'breakpoint' || entryBody?.reason === 'pause',
                `DebugBreak stop must have reason 'breakpoint'|'pause', got: "${entryBody?.reason}"`,
            );
            console.log(`[sub-proj-e2e] DebugBreak stop: reason="${entryBody.reason}" ✔`);

            const entryThreadId = entryBody.threadId!;
            const entrySt = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace',
                { threadId: entryThreadId, levels: 1 },
            );
            assert.strictEqual(
                entrySt.stackFrames[0].line,
                STOP_LINE,
                `entry stop must be at line ${STOP_LINE}, got ${entrySt.stackFrames[0].line}`,
            );
            console.log(`[sub-proj-e2e] Stack at DebugBreak line ${STOP_LINE} ✔`);

            // ── Phase 3: add main-script BP ──────────────────────────────────
            // Line 17: result = sub_multiply_add(counter, 7)
            // This line calls a function from the sub-project library loaded via pvss_path.
            // Reaching this line proves #uses "sub_math" resolved correctly.
            const mainBp = new vscode.SourceBreakpoint(
                new vscode.Location(mainUri, new vscode.Position(BP_MAIN_LINE - 1, 0)),
            );
            addedBreakpoints = [mainBp];
            vscode.debug.addBreakpoints(addedBreakpoints);
            await sleep(3_000);
            console.log('[sub-proj-e2e] BP at line 17 added ✔');

            // ── Step 2: continue → main BP fires at BP_MAIN_LINE ─────────────
            await helper.request('continue', { threadId: entryThreadId });

            const stop2 = await helper.waitForEvent('stopped', 15_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.strictEqual(body2?.reason, 'breakpoint', 'second stop must be a breakpoint');

            const st2 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace',
                { threadId: body2.threadId!, levels: 1 },
            );
            assert.strictEqual(
                st2.stackFrames[0].line,
                BP_MAIN_LINE,
                `second stop must be at line ${BP_MAIN_LINE}, got ${st2.stackFrames[0].line}`,
            );
            console.log(
                `[sub-proj-e2e] BP at line ${BP_MAIN_LINE} (sub_multiply_add call) fired ✔`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(SUB_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
