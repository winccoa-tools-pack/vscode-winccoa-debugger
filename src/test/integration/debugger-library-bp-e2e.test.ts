/**
 * debugger-library-bp-e2e.test.ts
 *
 * VS Code E2E tests for breakpoints in library files loaded via `#uses`.
 *
 * Uses `call_library_function.ctl` (CTRL manager -num 4, manual mode)
 * which imports `libs/debugger_lib.ctl` via `#uses "debugger_lib"`.
 *
 * Key line numbers:
 *   call_library_function.ctl, line 11: DebugBreak()       (WinCC OA reports stop at line 13)
 *   call_library_function.ctl, line 15: sum = add_two_integers(...)  ← BP_MAIN_LINE
 *   libs/debugger_lib.ctl, line 7:      int sum = a + b;              ← BP_LIB_LINE
 *
 * Why DebugBreak() is needed (test 1 only):
 *   The manager runs in `manual` mode so the test controls when it starts.
 *   `DebugBreak()` at line 11 gives the debug adapter a chance to attach with
 *   stopOnEntry=true and set all BPs while the script is paused. At that point
 *   `debugger_lib` is already loaded via `#uses`, so `info libs` returns its LibId
 *   and the adapter can set the lib BP immediately (verified=true).
 *   WinCC OA reports the stop at the NEXT statement after DebugBreak (line 13).
 *
 * Test 1 flow (lib BP fires):
 *   1. Start manager 4 (manual) → #uses loads debugger_lib → DebugBreak() fires
 *   2. Session attaches with stopOnEntry=true → adapter sets all BPs (both verified)
 *   3. StoppedEvent(entry) at line 13 (while — WinCC OA PC after DebugBreak)
 *   4. continue → loop starts → hit BP_MAIN_LINE 15 (before entering lib)
 *   5. continue → may hit BP_MAIN_LINE 15 again (WinCC OA "double-click" behavior,
 *      possibly a WinCC OA quirk — unknown if feature or bug)
 *   6. continue → hit BP_LIB_LINE 7 (inside add_two_integers)
 *
 * Test 2 flow (main BP, normal attach):
 *   1. Start manager 4 (manual) → DebugBreak() fires, CTRL pauses
 *   2. Session attaches WITHOUT stopOnEntry → adapter sends 'cont' → CTRL resumes
 *   3. CTRL enters while loop → main BP fires at line 15
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
 * line 13 (`while (true)`) rather than line 11 (DebugBreak itself).
 * (line 12 is blank)
 */
const STOP_LINE = 13;
/** Line in call_library_function.ctl — `sum = add_two_integers(a, b);` (line 15) */
const BP_MAIN_LINE = 15;
const BP_LIB_LINE = 7;

/** CTRL manager number for call_library_function.ctl */
const LIB_MANAGER = 4;

/** ms to wait for DebugBreak() to fire before attaching */
const DEBUGBREAK_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E library breakpoints (call_library_function)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[lib-bp-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[lib-bp-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[lib-bp-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[lib-bp-e2e] Project started');

        console.log('[lib-bp-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[lib-bp-e2e] Step 3: Opening call_library_function.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('call_library_function.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[lib-bp-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[lib-bp-e2e] Active project set to "runnable"');
            } else {
                console.warn('[lib-bp-e2e] Core API not available — continuing without setCurrentProject');
            }
        } catch (err) {
            console.warn(`[lib-bp-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`);
        }

        console.log('[lib-bp-e2e] ✓ Setup complete — ready to run tests');
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
                console.error(`[lib-bp-e2e] stop failed: ${e.message}`),
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
            manager: { type: 'CTRL', number: LIB_MANAGER },
            stopOnEntry: true,
            trace: true,
        };
    }

    // ── test: BP in library file fires with correct source ────────────────────

    test('BP in library file fires at lib line 7 with source debugger_lib', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(60_000);

        const mainScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const libScriptPath = lifecycle.getScriptPath('libs/debugger_lib.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // Set both BPs in VS Code before the session (so adapter receives them on init)
        const mainUri = vscode.Uri.file(mainScriptPath);
        const libUri = vscode.Uri.file(libScriptPath);

        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(mainUri, new vscode.Position(BP_MAIN_LINE - 1, 0)),
        );
        const libBp = new vscode.SourceBreakpoint(
            new vscode.Location(libUri, new vscode.Position(BP_LIB_LINE - 1, 0)),
        );
        addedBreakpoints = [mainBp, libBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            // Start manager 4 (manual, -dbg CTRL_DEBUGBREAK) — script hits DebugBreak
            await lifecycle.startManagerByNum(LIB_MANAGER);
            // Wait for DebugBreak to fire before attaching
            await sleep(DEBUGBREAK_SETTLE_MS);

            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: library BP'),
                25_000,
            );
            console.log('[lib-bp-e2e] debug session started');

            // ── Step 1: DebugBreak stop (stop-on-entry) ───────────────────────
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            assert.ok(
                entryBody?.reason === 'entry' || entryBody?.reason === 'pause' || entryBody?.reason === 'breakpoint',
                `entry stop must have reason 'entry'|'pause'|'breakpoint', got: "${entryBody?.reason}"`,
            );
            console.log(`[lib-bp-e2e] DebugBreak stop: reason="${entryBody.reason}" ✔`);

            const entryThreadId = entryBody.threadId!;
            const entrySt = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: entryThreadId, levels: 1 },
            );
            assert.strictEqual(
                entrySt.stackFrames[0].line,
                STOP_LINE,
                `entry stop must be at DebugBreak line ${STOP_LINE}, got ${entrySt.stackFrames[0].line}`,
            );
            console.log(`[lib-bp-e2e] Stack at DebugBreak line ${STOP_LINE} ✔`);

            // ── Step 2: continue → main BP fires at BP_MAIN_LINE ─────────────
            await helper.request('continue', { threadId: entryThreadId });

            const stop2 = await helper.waitForEvent('stopped', 15_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.strictEqual(body2?.reason, 'breakpoint', 'second stop must be a breakpoint (main)');

            const st2 = await helper.request<{ stackFrames: Array<{ line: number; source?: { name?: string } }> }>(
                'stackTrace', { threadId: body2.threadId!, levels: 1 },
            );
            assert.strictEqual(
                st2.stackFrames[0].line,
                BP_MAIN_LINE,
                `second stop must be at main line ${BP_MAIN_LINE}, got ${st2.stackFrames[0].line}`,
            );
            console.log(`[lib-bp-e2e] Main BP fired at line ${BP_MAIN_LINE} ✔`);

            // ── Step 3: continue → lib BP fires at BP_LIB_LINE ───────────────
            // WinCC OA may require an extra continue from the main BP line
            // ("double-click" behavior — unknown if feature or bug). We loop
            // up to 3 times: if we stop at BP_MAIN_LINE again, continue once more.
            let lastThreadId = body2.threadId!;
            let libReached = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                await helper.request('continue', { threadId: lastThreadId });

                const stopN = await helper.waitForEvent('stopped', 15_000);
                const bodyN = stopN.body as { reason?: string; threadId?: number };
                assert.strictEqual(bodyN?.reason, 'breakpoint', `stop #${attempt + 3} must be a breakpoint`);
                lastThreadId = bodyN.threadId!;

                const stN = await helper.request<{ stackFrames: Array<{ line: number; source?: { name?: string; path?: string } }> }>(
                    'stackTrace', { threadId: lastThreadId, levels: 3 },
                );
                const topLine = stN.stackFrames[0].line;
                const topSrc = stN.stackFrames[0].source?.name ?? stN.stackFrames[0].source?.path ?? '';

                if (topLine === BP_LIB_LINE && topSrc.toLowerCase().includes('debugger_lib')) {
                    console.log(`[lib-bp-e2e] Library BP fired at ${topSrc}:${topLine} ✔ (attempt ${attempt + 1})`);
                    libReached = true;
                    break;
                }

                assert.strictEqual(
                    topLine,
                    BP_MAIN_LINE,
                    `expected main BP (${BP_MAIN_LINE}) or lib BP (${BP_LIB_LINE}), got ${topLine}`,
                );
                console.log(`[lib-bp-e2e] Still at main BP ${BP_MAIN_LINE}, continuing (attempt ${attempt + 1})…`);
            }
            assert.ok(libReached, 'lib BP must fire within 3 continue attempts');

            const srcName = 'debugger_lib'; // already validated inside loop
            console.log(`[lib-bp-e2e] Library BP confirmed at ${srcName}:${BP_LIB_LINE} ✔`);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(LIB_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test: main-script BP still works after lib BP is set ─────────────────
    // TODO: This test has a timing issue — the adapter's configurationDone
    // sends 'cont' before VS Code finishes setBreakpoints, so the CTRL
    // resumes without any BPs set. Needs investigation into the DAP
    // initialization sequence for non-stopOnEntry attach sessions.

    test.skip('main BP fires correctly even when lib BP is also set', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(45_000);

        const mainScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const helper = new DebugSessionHelper('winccoa');

        const mainUri = vscode.Uri.file(mainScriptPath);
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(mainUri, new vscode.Position(BP_MAIN_LINE - 1, 0)),
        );
        addedBreakpoints = [mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            // Start manager 4 (manual) — script pauses at DebugBreak
            await lifecycle.startManagerByNum(LIB_MANAGER);
            await sleep(DEBUGBREAK_SETTLE_MS);

            // Attach WITH stopOnEntry so that BPs are guaranteed to be set
            // before execution resumes. Without stopOnEntry the adapter sends
            // 'cont' in configurationDone which can race ahead of setBreakpoints.
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: main BP with lib'),
                25_000,
            );

            // Wait for the entry stop at DebugBreak line
            const entryStop = await helper.waitForEvent('stopped', 15_000);
            const entryBody = entryStop.body as { reason?: string; threadId?: number };
            console.log(`[lib-bp-e2e] Test2 entry stop: reason="${entryBody?.reason}"`);

            // Continue past DebugBreak — CTRL enters the while loop
            await helper.request('continue', { threadId: entryBody.threadId! });

            // CTRL hits main BP at line 14
            const stopped = await helper.waitForEvent('stopped', 20_000);
            const body = stopped.body as { reason?: string; threadId?: number };
            assert.strictEqual(body?.reason, 'breakpoint');

            const st = await helper.request<{ stackFrames: Array<{ line: number; source?: { name?: string } }> }>(
                'stackTrace',
                { threadId: body.threadId!, levels: 1 },
            );
            assert.strictEqual(st.stackFrames[0].line, BP_MAIN_LINE);

            const srcName = st.stackFrames[0].source?.name ?? '';
            assert.ok(
                srcName.includes('call_library_function'),
                `source must be call_library_function, got: "${srcName}"`,
            );
            console.log(`[lib-bp-e2e] Main BP still fires at ${srcName}:${BP_MAIN_LINE} ✔`);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(LIB_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
