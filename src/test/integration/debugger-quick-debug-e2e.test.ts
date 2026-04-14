/**
 * debugger-quick-debug-e2e.test.ts
 *
 * E2E test for the "Quick Debug" flow:
 *
 *   F5 on a .ctl file without launch.json:
 *   1. resolveDebugConfiguration creates a launch config with script + scriptManagerNum
 *   2. debugAdapterFactory auto-deploys adapter, starts script manager at -num 98
 *   3. Debug session connects, hits a breakpoint
 *   4. On session end, cleanupScriptManager removes the manager from pmon
 *
 * Running locally:
 *   npm run test:e2e:quickdebug
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed
 *   - WINCCOA_VSCODE_SKIP=1 to opt-out
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
// import * as path from 'path';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { waitForCoreApi } from '../../otherExtensions';
import { PmonComponent } from '@winccoa-tools-pack/npm-winccoa-core';

type CoreApi = {
    getRunningProjects?: () => Promise<unknown[]>;
    setCurrentProject?: (id: string) => void | Promise<void>;
};

// ─── constants ───────────────────────────────────────────────────────────────

/** Manager number used by the quick-debug flow */
const SCRIPT_MANAGER_NUM = 98;
const SCRIPT_REL_PATH = 'bp_basic_loop.ctl';
const BP_LINE = 13;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E Quick Debug (F5 without launch.json)', function () {
    this.timeout(120_000);

    let canRun = false;
    let projectName: string;
    let _projectDir: string;
    let version: string;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[quick-debug-e2e] WinCC OA not available — skipping');
            return;
        }

        // ── Start the fixture project ────────────────────────────────────────
        console.log('[quick-debug-e2e] Starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[quick-debug-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[quick-debug-e2e] Project started');

        projectName = lifecycle.getProjectName();
        _projectDir = lifecycle.getProjectDir();
        version = lifecycle.getVersion();

        // ── Wait for services to settle ──────────────────────────────────────
        await new Promise((r) => setTimeout(r, 3_000));

        // ── Set active project in Core extension ─────────────────────────────
        console.log('[quick-debug-e2e] Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(projectName));
                console.log('[quick-debug-e2e] Active project set');
            } else {
                console.warn('[quick-debug-e2e] Core API not available — continuing');
            }
        } catch (err) {
            console.warn(`[quick-debug-e2e] setCurrentProject failed: ${(err as Error).message}`);
        }

        console.log('[quick-debug-e2e] ✓ Setup complete');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(60_000);

        console.log('[quick-debug-e2e] Teardown…');

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }

        // Force-remove any leftover -num 98 manager
        if (canRun) {
            try {
                const pmon = new PmonComponent();
                pmon.setVersion(version);
                const list = await pmon.getManagerOptionsList(projectName);
                const idx = list.findIndex((m) =>
                    m.startOptions?.includes(`-num ${SCRIPT_MANAGER_NUM}`),
                );
                if (idx >= 0) {
                    console.log(
                        `[quick-debug-e2e] Force-removing leftover -num ${SCRIPT_MANAGER_NUM} at index ${idx}`,
                    );
                    await pmon.stopManager(projectName, idx).catch(() => {});
                    await new Promise((r) => setTimeout(r, 1000));
                    await pmon.removeManager(projectName, idx).catch(() => {});
                }
            } catch {
                // best-effort
            }
        }

        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle
                .stop()
                .catch((e: Error) => console.error(`[quick-debug-e2e] stop failed: ${e.message}`));
        }

        console.log('[quick-debug-e2e] Teardown complete');
    });

    // ── helpers ───────────────────────────────────────────────────────────────

    function addBreakpoint(scriptPath: string, line: number): void {
        const uri = vscode.Uri.file(scriptPath);
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(uri, new vscode.Position(line - 1, 0)),
        );
        addedBreakpoints.push(bp);
        vscode.debug.addBreakpoints([bp]);
    }

    // ── test 1: quick-debug launch config is auto-generated ──────────────────

    test('1 — launch config creates script + scriptManagerNum from active file', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const scriptPath = lifecycle.getScriptPath(SCRIPT_REL_PATH);
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        // Build a launch config that simulates what resolveDebugConfiguration produces
        // when the user presses F5 with a .ctl file open (Quick Debug flow)
        const base = lifecycle.getBaseLaunchConfig();
        const launchConfig: vscode.DebugConfiguration = {
            type: 'winccoa',
            request: 'launch',
            name: 'Quick Debug E2E',
            ...base,
            script: SCRIPT_REL_PATH,
            scriptManagerNum: SCRIPT_MANAGER_NUM,
            manager: { type: 'CTRL', number: SCRIPT_MANAGER_NUM },
        };

        try {
            // Start the debug session — the factory should:
            //   1. ensureAdapter (deploy + start adapter)
            //   2. startScriptManager (insert + start WCCOActrl -num 98)
            //   3. Connect to the adapter on port 7474
            await helper.startSession(undefined, launchConfig, 30_000);

            // Wait for a breakpoint hit
            const stopped = await helper.waitForEvent('stopped', 25_000);
            const body = stopped.body as { reason?: string; threadId?: number };

            assert.strictEqual(body?.reason, 'breakpoint', 'stop reason must be "breakpoint"');
            assert.ok(typeof body?.threadId === 'number', 'threadId must be a number');

            console.log('[quick-debug-e2e] ✓ BP hit via quick-debug launch');
        } finally {
            await helper.dispose();
        }
    });

    // ── test 2: script manager is cleaned up after session ends ──────────────

    test('2 — script manager removed after debug session ends', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        // Wait for the cleanup callback to fire (onDidTerminateDebugSession in extension.ts)
        await new Promise((r) => setTimeout(r, 3_000));

        const pmon = new PmonComponent();
        pmon.setVersion(version);
        const list = await pmon.getManagerOptionsList(projectName);
        const exists = list.some((m) => m.startOptions?.includes(`-num ${SCRIPT_MANAGER_NUM}`));

        assert.strictEqual(
            exists,
            false,
            `-num ${SCRIPT_MANAGER_NUM} must be removed after debug session ends`,
        );

        console.log('[quick-debug-e2e] ✓ Script manager cleaned up');
    });
});
