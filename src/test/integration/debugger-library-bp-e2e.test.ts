/**
 * debugger-library-bp-e2e.test.ts
 *
 * VS Code E2E tests for breakpoints in library files loaded via `#uses`.
 *
 * Uses `call_library_function.ctl` (CTRL manager -num 93) which imports
 * `libs/debugger_lib.ctl` via `#uses "libs/debugger_lib"`.
 *
 * Key line numbers:
 *   call_library_function.ctl, line 14:  sum = add_two_integers(...);  ← BP_MAIN_LINE
 *   libs/debugger_lib.ctl, line 7:       int sum = a + b;                  ← BP_LIB_LINE
 *
 * Library BP challenge: `libs/debugger_lib.ctl` does not appear in `info scripts`
 * until the library function is first invoked. The adapter detects unverified BPs
 * (source not yet loaded) and retries on every stop event, notifying VS Code via
 * BreakpointEvent when verification succeeds.
 *
 * Test flow:
 *   1. Set BP at lib line 7 (initially unverified) AND main line 13
 *   2. Start session — adapter sets BPs (lib BP is unverified)
 *   3. Wait for first stop at main line 13 (verified BP)
 *   4. Continue → adapter retries lib BP (now visible in info scripts)
 *   5. Wait for second stop → must be at lib line 7, source = debugger_lib.ctl
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';

// ─── constants ───────────────────────────────────────────────────────────────

const BP_MAIN_LINE = 14;
const BP_LIB_LINE = 7;

/** CTRL manager number for call_library_function.ctl */
const LIB_MANAGER = 3;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E library breakpoints (call_library_function)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(60_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[lib-bp-e2e] WinCC OA not available — skipping');
            return;
        }

        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[lib-bp-e2e] Could not start WinCC OA: ${(err as Error).message}`);
            return;
        }

        canRun = true;
        console.log('[lib-bp-e2e] Prerequisites met — tests will run');
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
            request: 'launch',
            name,
            ...base,
            manager: { type: 'CTRL', number: LIB_MANAGER },
        };
    }

    // ── test: BP in library file fires with correct source ────────────────────

    test('BP in library file fires at lib line 7 with source debugger_lib', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(45_000);

        const mainScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const libScriptPath = lifecycle.getScriptPath('libs/debugger_lib.ctl');
        const helper = new DebugSessionHelper('winccoa');

        // Set BP in library (initially unverified) + in main script (verified)
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
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: library BP'),
                25_000,
            );
            console.log('[lib-bp-e2e] debug session started');

            // First stop: expected at main line 13
            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { reason?: string; threadId?: number };
            assert.strictEqual(body1?.reason, 'breakpoint', 'first stop must be a breakpoint');

            const st1 = await helper.request<{ stackFrames: Array<{ line: number; source?: { name?: string } }> }>(
                'stackTrace',
                { threadId: body1.threadId!, levels: 1 },
            );
            assert.strictEqual(
                st1.stackFrames[0].line,
                BP_MAIN_LINE,
                `first stop must be at main line ${BP_MAIN_LINE}`,
            );
            console.log(`[lib-bp-e2e] First stop at line ${st1.stackFrames[0].line} ✔`);

            // Continue — adapter retries lib BP (now visible after first call into lib)
            await helper.request('continue', { threadId: body1.threadId! });

            // Second stop: expected in library at line 7
            const stop2 = await helper.waitForEvent('stopped', 15_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.strictEqual(body2?.reason, 'breakpoint', 'second stop must be a breakpoint (lib)');

            const st2 = await helper.request<{ stackFrames: Array<{ line: number; source?: { name?: string; path?: string } }> }>(
                'stackTrace',
                { threadId: body2.threadId!, levels: 3 },
            );
            assert.ok(st2.stackFrames.length > 0, 'stack must have frames at lib stop');

            const topFrame = st2.stackFrames[0];
            assert.strictEqual(topFrame.line, BP_LIB_LINE, `lib stop must be at line ${BP_LIB_LINE}`);

            const srcName = topFrame.source?.name ?? topFrame.source?.path ?? '';
            assert.ok(
                srcName.toLowerCase().includes('debugger_lib'),
                `lib stop source must include "debugger_lib", got: "${srcName}"`,
            );
            console.log(`[lib-bp-e2e] Library BP fired at ${srcName}:${topFrame.line} ✔`);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await helper.dispose();
        }
    });

    // ── test: main-script BP still works after lib BP is set ─────────────────

    test('main BP fires correctly even when lib BP is also set', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(30_000);

        const mainScriptPath = lifecycle.getScriptPath('call_library_function.ctl');
        const helper = new DebugSessionHelper('winccoa');

        const mainUri = vscode.Uri.file(mainScriptPath);
        const mainBp = new vscode.SourceBreakpoint(
            new vscode.Location(mainUri, new vscode.Position(BP_MAIN_LINE - 1, 0)),
        );
        addedBreakpoints = [mainBp];
        vscode.debug.addBreakpoints(addedBreakpoints);

        try {
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: main BP with lib'),
                25_000,
            );

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
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await helper.dispose();
        }
    });
});
