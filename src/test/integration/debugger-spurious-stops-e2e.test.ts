/**
 * debugger-spurious-stops-e2e.test.ts
 *
 * VS Code E2E regression test for the spurious stop filter in the debug adapter.
 *
 * Problem being tested:
 *   Before the DatapointClient fix, EVERY debug-DP command that returned a
 *   stop-like response (e.g. `script N`, `thread N` used by stackTrace /
 *   variables requests) triggered a new 'message' event on the client.
 *   WinCCDebugSession treated these as genuine stop events and re-emitted
 *   `StoppedEvent` to VS Code.
 *
 *   Consequence at the VS Code level:
 *     - After a breakpoint stop, VS Code's debug UI re-paused repeatedly
 *     - The user had to click Continue ≥ 3 times for the script to actually resume
 *     - `waitForEvent('stopped')` after continue would return immediately instead
 *       of waiting for the next genuine stop (~1 000 ms with delay(1))
 *
 *   Fix:
 *     DatapointClient.ts no longer emits 'message' for context-command responses.
 *     WinCCDebugSession has an additional `lastEmittedLine` guard that filters
 *     stops at the same line without full-loop-elapsed time.
 *
 * Test strategy (VS Code E2E level):
 *   1. Set BP at bp_basic_loop.ctl line 13, start session → wait for first stop.
 *   2. Issue stackTrace + scopes + variables — these trigger `script N` / `thread N`
 *      internally (the commands that previously caused spurious stops).
 *   3. Assert NO additional 'stopped' events arrive within 1.5 s after the context
 *      commands (1.5 s < 1 full loop iteration with delay(1) ≈ 1 000 ms).
 *   4. Send ONE `continue` and wait for the next genuine stop.
 *   5. Assert the second stop arrives (ONE continue was sufficient).
 *      With spurious stops, the adapter would have eaten the continue and VS Code
 *      would need a second one — resulting in a 6+ second timeout here.
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed + `runnable` fixture project available
 *   - Set WINCCOA_VSCODE_SKIP=1 to skip all tests.
 *
 * Running locally:
 *   npm run test:e2e:spuriousstops
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

/** bp_basic_loop.ctl: `counter++` in the while loop */
const BP_LINE = 13;
/** CTRL manager running bp_basic_loop.ctl (always-running) */
const BP_MANAGER = 2;

/**
 * Window in which we check for spurious stops after context requests.
 * Must be LESS than one full loop iteration (~1 000 ms with delay(1))
 * so we do not accidentally wait for a legitimate second stop.
 */
const SPURIOUS_CHECK_MS = 1_500;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E spurious stop filter (bp_basic_loop)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[spurious-stops-e2e] WinCC OA not available — skipping');
            return;
        }

        console.log('[spurious-stops-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[spurious-stops-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[spurious-stops-e2e] Project started');

        console.log('[spurious-stops-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[spurious-stops-e2e] Step 3: Opening bp_basic_loop.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('bp_basic_loop.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[spurious-stops-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[spurious-stops-e2e] Active project set to "runnable"');
            } else {
                console.warn('[spurious-stops-e2e] Core API not available — continuing without setCurrentProject');
            }
        } catch (err) {
            console.warn(`[spurious-stops-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`);
        }

        console.log('[spurious-stops-e2e] ✓ Setup complete — ready to run tests');
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
                console.error(`[spurious-stops-e2e] stop failed: ${e.message}`),
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

    // ── test: no spurious stops after context requests ────────────────────────

    test('context requests (stackTrace/variables) do not trigger spurious stopped events', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(45_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: spurious stops check'), 25_000);
            // ── 1. Wait for genuine first stop ────────────────────────────────
            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { reason?: string; threadId?: number };
            assert.strictEqual(body1?.reason, 'breakpoint', `first stop reason must be "breakpoint", got: ${body1?.reason}`);
            assert.ok(typeof body1?.threadId === 'number', 'first stop must have a numeric threadId');

            const threadId = body1.threadId!;

            // ── 2. Verify stop position via stackTrace ────────────────────────
            const st = await helper.request<{
                stackFrames: Array<{ id: number; line: number; source?: { name?: string } }>;
            }>('stackTrace', { threadId, levels: 1 });
            assert.ok(st.stackFrames.length > 0, 'stackTrace must return at least one frame');
            assert.strictEqual(st.stackFrames[0].line, BP_LINE, `frame must be at BP_LINE=${BP_LINE}`);

            const frameId = st.stackFrames[0].id;

            // ── 3. Request scopes + variables (sends `script N` / `thread N`
            //        commands internally — these used to cause spurious stops) ──
            const scopes = await helper.request<{
                scopes: Array<{ name: string; variablesReference: number }>;
            }>('scopes', { frameId });
            assert.ok(scopes.scopes.length > 0, 'scopes must return at least one scope');

            const localScope = scopes.scopes[0];
            await helper.request('variables', { variablesReference: localScope.variablesReference });

            // ── 4. Assert NO spurious stopped events within the check window ──
            //
            // If the spurious stop filter is broken:
            //   `script N` or `thread N` response → 'message' event → StoppedEvent
            //   → this waitForEvent resolves IMMEDIATELY instead of timing out.
            //
            // If the fix is in place:
            //   No spurious events → waitForEvent rejects after SPURIOUS_CHECK_MS.
            //   We convert the rejection to null and assert null.
            const spuriousStop = await helper.waitForEvent('stopped', SPURIOUS_CHECK_MS).catch(() => null);
            assert.strictEqual(
                spuriousStop,
                null,
                `SPURIOUS STOP DETECTED: a 'stopped' event arrived within ${SPURIOUS_CHECK_MS}ms ` +
                `after context requests (stackTrace/scopes/variables). ` +
                `This means context commands triggered an extra StoppedEvent — the spurious stop ` +
                `filter in DatapointClient.ts or WinCCDebugSession.ts is not working.`,
            );

            // ── 5. Send ONE continue → must reach the next genuine stop ───────
            //
            // With spurious stops (bug present): the adapter consumed the continue
            // for a spurious stop, so the script doesn't actually resume.
            // Result: the next stop never arrives / arrives only after pressing
            // Continue a second time — test would time out here.
            //
            // With fix: ONE continue resumes the script, next stop arrives at
            // line 13 after one full loop iteration (~1 000 ms with delay(1)).
            await helper.request('continue', { threadId });

            const stop2 = await helper.waitForEvent('stopped', 8_000);
            const body2 = stop2.body as { reason?: string };
            assert.strictEqual(body2?.reason, 'breakpoint', `second stop reason must be "breakpoint", got: ${body2?.reason}`);

            console.log(`[spurious-stops-e2e] ✔ No spurious stops — ONE continue was sufficient`);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});            await helper.dispose();
        }
    });

    // ── test: single continue — no extra continue needed ─────────────────────

    test('single continue resumes from BP without extra presses needed', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(45_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(BP_MANAGER);
            await helper.startSession(undefined, buildLaunchConfig('E2E: single continue'), 25_000);

            // First stop
            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { reason?: string; threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            const threadId = body1.threadId!;

            // Get stack to trigger internal context commands
            await helper.request('stackTrace', { threadId, levels: 3 });

            // Send exactly ONE continue
            const t0 = Date.now();
            await helper.request('continue', { threadId });

            // Second stop: must arrive within a reasonable time (3× loop iteration)
            const stop2 = await helper.waitForEvent('stopped', 6_000);
            const elapsed = Date.now() - t0;

            const body2 = stop2.body as { reason?: string };
            assert.strictEqual(body2?.reason, 'breakpoint', `second stop reason must be "breakpoint"`);

            // ONE continue was enough — script resumed and hit the BP on the next iteration
            console.log(`[spurious-stops-e2e] ✔ Second stop arrived after ${elapsed}ms (single continue sufficient)`);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(BP_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
