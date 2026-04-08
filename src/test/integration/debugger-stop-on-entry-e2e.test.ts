/**
 * debugger-stop-on-entry-e2e.test.ts
 *
 * VS Code E2E tests for stopOnEntry / DebugBreak() behavior.
 *
 * Uses `stop_on_entry.ctl` (CTRL manager -num 94, manual mode).
 * The script calls DebugBreak() early and then exits via dpDisconnect().
 *
 * stop_on_entry.ctl structure:
 *   ...
 *   int a = 10;
 *   int b = 32;
 *   ...
 *   DebugBreak();   ← line 22 (STOP_LINE)
 *   ...
 *   dpDisconnect();
 *
 * Because the script is in "manual" mode in progs, it does NOT auto-start.
 * Each test must call `lifecycle.startManagerByNum(94)` before attaching.
 * After `continue`, the script runs to completion and the session terminates.
 *
 * Since the script exits after one continue, ALL stop-on-entry assertions
 * are packed into a single comprehensive test to avoid restart complexity.
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';

// ─── constants ───────────────────────────────────────────────────────────────

const STOP_LINE = 22;
const STOP_ENTRY_MANAGER = 3;

/** ms to wait for DebugBreak() to fire before attaching */
const DEBUGBREAK_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E stop-on-entry (DebugBreak)', function () {
    this.timeout(90_000);

    let canRun = false;

    suiteSetup(async function () {
        this.timeout(60_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[soe-e2e] WinCC OA not available — skipping');
            return;
        }

        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[soe-e2e] Could not start WinCC OA: ${(err as Error).message}`);
            return;
        }

        canRun = true;
        console.log('[soe-e2e] Prerequisites met — tests will run');
    });

    suiteTeardown(async function () {
        this.timeout(30_000);

        if (lifecycle.isWinccoaAvailable()) {
            // Manager may already be stopped if test ran to completion
            await lifecycle.stopManagerByNum(STOP_ENTRY_MANAGER).catch(() => {
                /* intentionally ignored */
            });
            await lifecycle.stop().catch((e: Error) =>
                console.error(`[soe-e2e] stop failed: ${e.message}`),
            );
        }
    });

    // ── helpers ───────────────────────────────────────────────────────────────

    function buildLaunchConfig(name: string) {
        const base = lifecycle.getBaseLaunchConfig();
        return {
            type: 'winccoa',
            request: 'attach',
            name,
            ...base,
            manager: { type: 'CTRL', number: STOP_ENTRY_MANAGER },
            stopOnEntry: true,
        };
    }

    // ── comprehensive stop-on-entry test ──────────────────────────────────────

    test('DebugBreak at line 22, variables a=10 b=32, continue leads to terminate', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(60_000);

        // Start the manual-mode manager (it calls DebugBreak() and halts there)
        await lifecycle.startManagerByNum(STOP_ENTRY_MANAGER);
        await sleep(DEBUGBREAK_SETTLE_MS);

        const helper = new DebugSessionHelper('winccoa');
        try {
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: stop on entry'),
                20_000,
            );
            console.log('[soe-e2e] debug session started');

            // ── 1. Expect stopped event ───────────────────────────────────────
            const stopped = await helper.waitForEvent('stopped', 15_000);
            const stoppedBody = stopped.body as {
                reason?: string;
                threadId?: number;
                description?: string;
            };

            assert.ok(
                stoppedBody?.reason === 'entry' || stoppedBody?.reason === 'pause' || stoppedBody?.reason === 'breakpoint',
                `expected stopped with reason 'entry'|'pause'|'breakpoint', got: "${stoppedBody?.reason}"`,
            );
            console.log(`[soe-e2e] stopped event: reason="${stoppedBody.reason}" ✔`);

            const threadId = stoppedBody.threadId!;

            // ── 2. Verify stack frame points to STOP_LINE ─────────────────────
            const st = await helper.request<{
                stackFrames: Array<{ id: number; line: number; source?: { name?: string } }>;
            }>('stackTrace', { threadId, levels: 3 });

            assert.ok(st.stackFrames.length > 0, 'stack must not be empty');
            assert.strictEqual(
                st.stackFrames[0].line,
                STOP_LINE,
                `expected stop at line ${STOP_LINE}, got ${st.stackFrames[0].line}`,
            );
            console.log(`[soe-e2e] stack frame at line ${st.stackFrames[0].line} ✔`);

            const frameId = st.stackFrames[0].id;

            // ── 3. Read local variables a and b ───────────────────────────────
            const scopes = await helper.request<{
                scopes: Array<{ name: string; variablesReference: number }>;
            }>('scopes', { frameId });

            assert.ok(scopes.scopes.length > 0, 'must have at least one scope');

            // Prefer "Locals" scope; fall back to first scope
            const localsScope =
                scopes.scopes.find((s) => s.name.toLowerCase().includes('local')) ??
                scopes.scopes[0];

            const vars = await helper.request<{
                variables: Array<{ name: string; value: string }>;
            }>('variables', { variablesReference: localsScope.variablesReference });

            function findVar(name: string): string | undefined {
                return vars.variables.find((v) => v.name === name)?.value;
            }

            const valA = findVar('a');
            const valB = findVar('b');

            assert.ok(valA !== undefined, 'variable "a" must be present in locals');
            assert.ok(valB !== undefined, 'variable "b" must be present in locals');

            // Accept integer representation ("10") and any whitespace variants
            assert.strictEqual(valA?.trim(), '10', `expected a=10, got "${valA}"`);
            assert.strictEqual(valB?.trim(), '32', `expected b=32, got "${valB}"`);
            console.log(`[soe-e2e] locals a=${valA} b=${valB} ✔`);

            // ── 4. Continue and wait for session termination ──────────────────
            await helper.request('continue', { threadId });
            const terminated = await helper.waitForEvent('terminated', 10_000);
            assert.ok(terminated, 'session must terminate after script finishes');
            console.log('[soe-e2e] session terminated after continue ✔');
        } finally {
            await helper.dispose();
        }
    });

    // ── sanity: stopped reason is not 'exception' ─────────────────────────────

    test('DebugBreak stop reason is not exception', async function () {
        if (!canRun) { this.skip(); return; }
        this.timeout(50_000);

        // Restart the manual manager for this independent test
        await lifecycle.startManagerByNum(STOP_ENTRY_MANAGER);
        await sleep(DEBUGBREAK_SETTLE_MS);

        const helper = new DebugSessionHelper('winccoa');
        try {
            await helper.startSession(
                undefined,
                buildLaunchConfig('E2E: stop-on-entry reason'),
                20_000,
            );

            const stopped = await helper.waitForEvent('stopped', 15_000);
            const body = stopped.body as { reason?: string };

            assert.notStrictEqual(
                body?.reason,
                'exception',
                'DebugBreak() must not appear as an exception stop',
            );
            console.log(
                `[soe-e2e] stop reason "${body?.reason}" is not "exception" ✔`,
            );
        } finally {
            await helper.dispose();
        }
    });
});
