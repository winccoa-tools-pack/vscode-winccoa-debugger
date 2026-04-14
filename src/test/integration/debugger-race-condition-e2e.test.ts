/**
 * debugger-race-condition-e2e.test.ts
 *
 * VS Code E2E regression test for the bpOperationQueue race-condition fix.
 *
 * Problem being tested:
 *   When VS Code activates a debug session that has breakpoints in MULTIPLE
 *   source files it sends `setBreakpoints` for each file concurrently
 *   (one call per file with pending BPs).  Because of `async/await` in
 *   WinCCDebugSession.setBreakpointsRequest, both handlers ran at the same
 *   time.  The inner `work()` function is:
 *
 *     1. deleteAllBreakpoints()    ← both calls erase all BPs
 *     2. setBreakpoint(line)       ← both then set only their OWN file's BP
 *
 *   Result: whichever call ran second "lost" the other file's BP AND set its
 *   own BP twice (or at a duplicate address) because pvssSrv holds duplicate
 *   BPs from both races.
 *
 *   With duplicate BPs at the same address, the CTRL script stops immediately
 *   on every iteration, so `continue` brings it back in < 100 ms instead of
 *   the expected ≥ 500 ms (one full `delay(1)` loop iteration).
 *
 * Fix (bpOperationQueue):
 *   All calls to `work()` are serialized via a promise chain:
 *     `this.bpOperationQueue = this.bpOperationQueue.then(() => work()).catch(…)`
 *   This guarantees deleteAll → reapplyAll sequence across all files.
 *
 * Test strategy (VS Code E2E level):
 *   1. Add BPs to TWO different source files before `startSession()`.
 *        • bp_basic_loop.ctl       : line 13
 *        • call_library_function.ctl : line 14
 *   2. Call `startSession()` → VS Code automatically sends concurrent
 *      `setBreakpoints` from the two pending BreakpointManager entries.
 *   3. Wait for the first stop (proves a BP fired correctly).
 *   4. Record `t0 = Date.now()`, send `continue`.
 *   5. Wait for the next stop and compute `deltaMs = Date.now() - t0`.
 *   6. Assert `deltaMs >= MIN_LEGITIMATE_ITER_MS (500)`:
 *        • With the race condition (bug):  both calls wrote duplicate BPs.
 *          The adapter triggers again instantly → deltaMs ≈ 10–80 ms.
 *        • With the fix: BPs are set correctly once, the script runs one
 *          full loop iteration with delay(1) → deltaMs ≈ 1 000 ms.
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed + `runnable` fixture project available
 *   - Set WINCCOA_VSCODE_SKIP=1 to skip all tests.
 *
 * Running locally:
 *   npm run test:e2e:racecondition
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

/** bp_basic_loop.ctl: `counter++` */
const BP_LINE = 13;
/** call_library_function.ctl: `int result = callLib()` */
const LIB_CALL_LINE = 14;
/** CTRL manager running bp_basic_loop.ctl (always-running) */
const BP_MANAGER = 2;

/**
 * Minimum expected time (ms) between `continue` and the NEXT legitimate stop.
 *
 * bp_basic_loop.ctl contains `delay(1)` which sleeps 1 000 ms per iteration.
 * Even accounting for system load and debug-protocol overhead we can safely
 * use 500 ms as the threshold.
 *
 * With duplicate BPs (race condition), the script stops immediately → deltaMs
 * will be well below 100 ms. This threshold provides a large safety margin.
 */
const MIN_LEGITIMATE_ITER_MS = 500;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E bpOperationQueue race condition (multi-file BPs)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[race-condition-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[race-condition-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[race-condition-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[race-condition-e2e] Project started');

        console.log('[race-condition-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[race-condition-e2e] Step 3: Opening bp_basic_loop.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('bp_basic_loop.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[race-condition-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[race-condition-e2e] Active project set to "runnable"');
            } else {
                console.warn(
                    '[race-condition-e2e] Core API not available — continuing without setCurrentProject',
                );
            }
        } catch (err) {
            console.warn(
                `[race-condition-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`,
            );
        }

        console.log('[race-condition-e2e] ✓ Setup complete — ready to run tests');
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
                .catch((e: Error) =>
                    console.error(`[race-condition-e2e] stop failed: ${e.message}`),
                );
        }
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

    // ── test: concurrent setBreakpoints do not cause duplicate BPs ────────────

    test('concurrent setBreakpoints for two files do not produce duplicate BPs', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const bpScriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const libScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // ── Add BPs to TWO files BEFORE starting the session. ─────────────────
        // VS Code will send setBreakpoints for EACH file when the adapter
        // initializes — these messages arrive concurrently and exercise the
        // bpOperationQueue serialization path.
        addBreakpoint(bpScriptPath, BP_LINE);
        addBreakpoint(libScriptPath, LIB_CALL_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            // ── Start session → triggers concurrent setBreakpoints ───────────────
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: race condition check'),
                25_000,
            );
            // ── Wait for first stop ──────────────────────────────────────────
            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { reason?: string; threadId?: number };
            assert.strictEqual(
                body1?.reason,
                'breakpoint',
                `first stop reason must be "breakpoint", got: ${body1?.reason}`,
            );
            assert.ok(typeof body1?.threadId === 'number', 'first stop must have numeric threadId');

            const threadId = body1.threadId!;
            console.log(`[race-condition-e2e] First stop received (threadId=${threadId})`);

            // ── Continue and measure elapsed time to next stop ───────────────
            const t0 = Date.now();
            await helper.request('continue', { threadId });

            const stop2 = await helper.waitForEvent('stopped', 6_000);
            const deltaMs = Date.now() - t0;

            const body2 = stop2.body as { reason?: string };
            assert.strictEqual(
                body2?.reason,
                'breakpoint',
                `second stop reason must be "breakpoint", got: ${body2?.reason}`,
            );

            // ── Assert: delta must be at least MIN_LEGITIMATE_ITER_MS ─────────
            //
            // With the race condition (bug):
            //   Both setBreakpoints calls ran concurrently.  The second one
            //   deleted then re-applied only its own BP — leaving a duplicate
            //   (or orphaned) BP from the first call.  pvssSrv fires
            //   immediately → deltaMs < 100 ms.
            //
            // With bpOperationQueue (fix):
            //   The two work() calls are serialized.  Final state is correct:
            //   one BP per line.  script runs delay(1) per iteration
            //   → deltaMs ≈ 1 000 ms.
            assert.ok(
                deltaMs >= MIN_LEGITIMATE_ITER_MS,
                `RACE CONDITION DETECTED: next stop arrived after only ${deltaMs}ms ` +
                    `(expected >= ${MIN_LEGITIMATE_ITER_MS}ms == one full loop iteration). ` +
                    `This indicates duplicate breakpoints caused by concurrent setBreakpoints ` +
                    `calls — the bpOperationQueue fix is not working correctly.`,
            );

            console.log(
                `[race-condition-e2e] ✔ Next stop after ${deltaMs}ms ` +
                    `(>= ${MIN_LEGITIMATE_ITER_MS}ms threshold — no race condition)`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test: second continue also reaches a legitimate stop ──────────────────

    test('multiple continues each wait for a full iteration (stable execution)', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const bpScriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const libScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // Add BPs to both files — same trigger for race condition path
        addBreakpoint(bpScriptPath, BP_LINE);
        addBreakpoint(libScriptPath, LIB_CALL_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: stable execution'),
                25_000,
            );

            // First stop
            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { reason?: string; threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');
            const threadId = body1.threadId!;

            // First continue
            const t1 = Date.now();
            await helper.request('continue', { threadId });
            const stop2 = await helper.waitForEvent('stopped', 6_000);
            const delta1 = Date.now() - t1;
            const body2 = stop2.body as { reason?: string };
            assert.strictEqual(body2?.reason, 'breakpoint');

            // Second continue
            const t2 = Date.now();
            await helper.request('continue', { threadId });
            const stop3 = await helper.waitForEvent('stopped', 6_000);
            const delta2 = Date.now() - t2;
            const body3 = stop3.body as { reason?: string };
            assert.strictEqual(body3?.reason, 'breakpoint');

            assert.ok(
                delta1 >= MIN_LEGITIMATE_ITER_MS,
                `1st continue: delta ${delta1}ms < ${MIN_LEGITIMATE_ITER_MS}ms threshold`,
            );
            assert.ok(
                delta2 >= MIN_LEGITIMATE_ITER_MS,
                `2nd continue: delta ${delta2}ms < ${MIN_LEGITIMATE_ITER_MS}ms threshold`,
            );

            console.log(
                `[race-condition-e2e] ✔ Continues: delta1=${delta1}ms, delta2=${delta2}ms — execution stable`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
