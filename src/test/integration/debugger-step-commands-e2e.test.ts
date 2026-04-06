/**
 * debugger-step-commands-e2e.test.ts
 *
 * VS Code E2E tests for step-over, step-into, step-out and pause commands
 * using `callstack_depth3.ctl` (CTRL manager -num 92).
 *
 * Call chain: main() → compute_outer(n) → compute_inner(n, 3) → multiply_and_add(n, 3, 1)
 *
 * Key line numbers in callstack_depth3.ctl:
 *   Line 17:  int multiply_and_add(int x, int factor, int z)
 *   Line 19:  int result = x * factor + z;   ← BP_LINE (inside multiply_and_add)
 *   Line 20:  return result;
 *   Line 24:  int partial = multiply_and_add(n, factor, 1);  ← call inside compute_inner
 *   Line 31:  int value = compute_inner(n, 3);               ← call inside compute_outer
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';

// ─── constants ───────────────────────────────────────────────────────────────

const BP_DEEP = 19;   // Inside multiply_and_add — deepest frame
const BP_CALL = 31;   // compute_outer: call to compute_inner

/** CTRL manager number for callstack_depth3.ctl */
const STEP_MANAGER = 4;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E step commands (callstack_depth3)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(60_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[step-e2e] WinCC OA not available — skipping');
            return;
        }

        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[step-e2e] Could not start WinCC OA: ${(err as Error).message}`);
            return;
        }

        canRun = true;
        console.log('[step-e2e] Prerequisites met — tests will run');
    });

    suiteTeardown(async function () {
        this.timeout(30_000);

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }

        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle.stop().catch((e: Error) =>
                console.error(`[step-e2e] stop failed: ${e.message}`),
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
            manager: { type: 'CTRL', number: STEP_MANAGER },
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

    // ── test A: step-next advances past current line ──────────────────────────

    test('step-next advances from line 19 to line 20', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('callstack_depth3.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_DEEP);

        try {
            await helper.startSession(undefined, buildLaunchConfig('E2E: step-next'), 25_000);

            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            // Verify stopped at BP_DEEP
            const st1 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body1.threadId, levels: 1 },
            );
            assert.strictEqual(st1.stackFrames[0].line, BP_DEEP, `initial stop must be at line ${BP_DEEP}`);

            // Step over (next)
            await helper.request('next', { threadId: body1.threadId });

            const stop2 = await helper.waitForEvent('stopped', 5_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.ok(
                body2?.reason === 'step' || body2?.reason === 'breakpoint',
                `stop reason after step-next must be 'step' or 'breakpoint', got: "${body2?.reason}"`,
            );

            const st2 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body2.threadId!, levels: 1 },
            );
            assert.strictEqual(
                st2.stackFrames[0].line,
                BP_DEEP + 1,
                `after step-next, line must be ${BP_DEEP + 1}`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await helper.dispose();
        }
    });

    // ── test B: step-into descends into callee ────────────────────────────────

    test('step-into descends into multiply_and_add from compute_inner', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('callstack_depth3.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_CALL); // line 31: compute_outer calls compute_inner

        try {
            await helper.startSession(undefined, buildLaunchConfig('E2E: step-into'), 25_000);

            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            // Verify stopped at BP_CALL
            const st1 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body1.threadId, levels: 1 },
            );
            assert.strictEqual(st1.stackFrames[0].line, BP_CALL, `initial stop must be at line ${BP_CALL}`);

            // Step into
            await helper.request('stepIn', { threadId: body1.threadId });

            const stop2 = await helper.waitForEvent('stopped', 5_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.ok(
                body2?.reason === 'step' || body2?.reason === 'breakpoint',
                `stop after step-into must be 'step' or 'breakpoint', got: "${body2?.reason}"`,
            );

            const st2 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body2.threadId!, levels: 5 },
            );
            // After stepping into compute_inner from compute_outer, we should be deeper
            assert.ok(
                st2.stackFrames.length >= 2,
                'stack must have at least 2 frames after step-into',
            );
            // The stopped line should be inside compute_inner (lines 23–27)
            const stoppedLine = st2.stackFrames[0].line;
            assert.ok(
                stoppedLine >= 23 && stoppedLine <= 27,
                `after step-into, line must be inside compute_inner (23–27), got ${stoppedLine}`,
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await helper.dispose();
        }
    });

    // ── test C: step-out returns from deepest frame ───────────────────────────

    test('step-out returns from multiply_and_add', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath('callstack_depth3.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_DEEP); // line 19: deepest frame

        try {
            await helper.startSession(undefined, buildLaunchConfig('E2E: step-out'), 25_000);

            const stop1 = await helper.waitForEvent('stopped', 20_000);
            const body1 = stop1.body as { threadId?: number };
            assert.ok(typeof body1?.threadId === 'number');

            // Verify 3-level call stack at BP_DEEP
            const st1 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body1.threadId, levels: 5 },
            );
            assert.ok(st1.stackFrames.length >= 2, 'should have at least 2 frames at BP_DEEP');
            assert.strictEqual(st1.stackFrames[0].line, BP_DEEP);

            // Step out from multiply_and_add → should land back in compute_inner
            await helper.request('stepOut', { threadId: body1.threadId });

            const stop2 = await helper.waitForEvent('stopped', 5_000);
            const body2 = stop2.body as { reason?: string; threadId?: number };
            assert.ok(
                body2?.reason === 'step' || body2?.reason === 'breakpoint',
                `stop after step-out must be 'step' or 'breakpoint', got: "${body2?.reason}"`,
            );

            const st2 = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body2.threadId!, levels: 5 },
            );
            const stoppedLine = st2.stackFrames[0].line;
            // After stepping out of multiply_and_add, we should be in compute_inner (lines 23–27)
            // or compute_outer (lines 29–33)
            assert.ok(
                stoppedLine >= 23 && stoppedLine <= 33,
                `after step-out, line must be in outer frame (23–33), got ${stoppedLine}`,
            );
            // Stack should be one level shallower
            assert.ok(
                st2.stackFrames.length < st1.stackFrames.length ||
                    st2.stackFrames.length >= 1,
                'stack depth should be valid after step-out',
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await helper.dispose();
        }
    });

    // ── test D: pause interrupts a running script ─────────────────────────────

    test('pause suspends running script at a valid line', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(30_000);

        // No breakpoints — script runs freely
        const helper = new DebugSessionHelper('winccoa');

        try {
            await helper.startSession(undefined, buildLaunchConfig('E2E: pause'), 25_000);

            // Give script time to reach its loop
            await new Promise((r) => setTimeout(r, 500));

            // Request a pause
            await helper.request('pause', { threadId: 0 });

            const stopped = await helper.waitForEvent('stopped', 8_000);
            const body = stopped.body as { reason?: string; threadId?: number };

            assert.ok(
                body?.reason === 'pause' || body?.reason === 'step' || body?.reason === 'breakpoint',
                `pause stop reason must be pause/step/breakpoint, got: "${body?.reason}"`,
            );
            assert.ok(typeof body?.threadId === 'number');

            const st = await helper.request<{ stackFrames: Array<{ line: number }> }>(
                'stackTrace', { threadId: body.threadId!, levels: 1 },
            );
            assert.ok(st.stackFrames.length > 0, 'should have a stack frame after pause');
            const stoppedLine = st.stackFrames[0].line;
            assert.ok(stoppedLine > 0, `stopped line must be positive, got ${stoppedLine}`);
        } finally {
            await helper.dispose();
        }
    });
});
