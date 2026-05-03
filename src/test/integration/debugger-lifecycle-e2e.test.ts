/**
 * debugger-lifecycle-e2e.test.ts
 *
 * E2E test for the full debug lifecycle managed by ManagerLifecycle:
 *
 *   1. Start runnable fixture project (pmon + DM + event)
 *   2. Set active project in Core extension
 *   3. Deploy adapter via AdapterDeployer
 *   4. Insert + start adapter manager via ManagerLifecycle.ensureAdapter()
 *   5. Insert + start script manager via ManagerLifecycle.startScriptManager()
 *   6. Start a debug session → hit a breakpoint
 *   7. Cleanup → verify script manager removed
 *
 * The fixture project already has its own debugAdapter.js symlink and a
 * `node | once | debugAdapter.js` entry in config/progs.  This test uses
 * an extra CTRL manager at -num 98 (not in fixture progs) to prove that
 * ManagerLifecycle can add/start/stop/remove managers at runtime.
 *
 * Running locally:
 *   npm run test:e2e:lifecycle
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed
 *   - WINCCOA_VSCODE_SKIP=1 to opt-out
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { waitForCoreApi } from '../../otherExtensions';
import { ManagerLifecycle, AdapterDeployer } from '../../lifecycle';
import { WinccoaProject } from '../../projectDetector';
import { PmonComponent } from '@winccoa-tools-pack/npm-winccoa-core';

type CoreApi = {
    getRunningProjects?: () => Promise<unknown[]>;
    setCurrentProject?: (id: string) => void | Promise<void>;
};

// ─── constants ───────────────────────────────────────────────────────────────

/** CTRL manager number used exclusively by this lifecycle test (not in fixture progs) */
const LIFECYCLE_MANAGER_NUM = 98;
/** Script to debug — a simple loop that hits a BP at line 13 */
const SCRIPT_REL_PATH = 'bp_basic_loop.ctl';
const BP_LINE = 13;

const lifecycle = new WinccoaProjectLifecycle();

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E lifecycle (ManagerLifecycle)', function () {
    this.timeout(120_000);

    let canRun = false;
    let managerLifecycle: ManagerLifecycle;
    let project: WinccoaProject;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[lifecycle-e2e] WinCC OA not available — skipping');
            return;
        }

        // ── Step 1: Start the fixture project ────────────────────────────────
        console.log('[lifecycle-e2e] Step 1: Starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[lifecycle-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[lifecycle-e2e] Project started');

        // ── Step 2: Wait for services to settle ──────────────────────────────
        await new Promise((r) => setTimeout(r, 3_000));

        // ── Step 3: Set active project in Core extension ─────────────────────
        console.log('[lifecycle-e2e] Step 3: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[lifecycle-e2e] Active project set');
            } else {
                console.warn('[lifecycle-e2e] Core API not available — continuing');
            }
        } catch (err) {
            console.warn(`[lifecycle-e2e] setCurrentProject failed: ${(err as Error).message}`);
        }

        // ── Step 4: Create ManagerLifecycle with test-friendly deployer ───────
        // The fixture project already has javascript/debugAdapter.js (symlink).
        // We create an AdapterDeployer that points to the extension's dist/ dir
        // so deploy() is a no-op (adapter already present).
        const extensionPath = path.resolve(__dirname, '..', '..', '..');
        const deployer = new AdapterDeployer(extensionPath);

        managerLifecycle = new ManagerLifecycle(deployer);

        // Build a WinccoaProject to pass to lifecycle methods
        project = {
            name: lifecycle.getProjectName(),
            projectDir: lifecycle.getProjectDir(),
            system: 'System1',
            host: 'localhost',
            port: 4999,
            version: lifecycle.getVersion(),
            installDir: lifecycle.getInstallDir(),
        };

        console.log('[lifecycle-e2e] ✓ Setup complete');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(60_000);

        console.log('[lifecycle-e2e] Teardown…');

        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }

        // Clean up any remaining lifecycle-managed managers
        if (managerLifecycle && canRun) {
            try {
                await managerLifecycle.cleanupAll(project);
            } catch (e: any) {
                console.warn(`[lifecycle-e2e] cleanupAll: ${e.message}`);
            }

            // Double-check: force-remove any -num 98 manager left behind
            try {
                const pmon = new PmonComponent();
                pmon.setVersion(project.version);
                const list = await pmon.getManagerOptionsList(project.name);
                const idx = list.findIndex((m) =>
                    m.startOptions?.includes(`-num ${LIFECYCLE_MANAGER_NUM}`),
                );
                if (idx >= 0) {
                    console.log(
                        `[lifecycle-e2e] Force-removing leftover -num ${LIFECYCLE_MANAGER_NUM} at index ${idx}`,
                    );
                    await pmon.stopManager(project.name, idx).catch(() => {});
                    await pmon.removeManager(project.name, idx);
                }
            } catch {
                // best-effort
            }
        }

        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle
                .stop()
                .catch((e: Error) => console.error(`[lifecycle-e2e] stop failed: ${e.message}`));
        }

        if (managerLifecycle) {
            managerLifecycle.dispose();
        }

        console.log('[lifecycle-e2e] Teardown complete');
    });

    // ── helpers ───────────────────────────────────────────────────────────────

    function buildLaunchConfig(name: string): vscode.DebugConfiguration {
        const base = lifecycle.getBaseLaunchConfig();
        return {
            type: 'winccoa',
            request: 'launch',
            name,
            ...base,
            manager: { type: 'CTRL', number: LIFECYCLE_MANAGER_NUM },
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

    // ── test 1: adapter already present in pmon ──────────────────────────────

    test('1 — ensureAdapter finds existing adapter manager', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        // The fixture project already has `node | once | debugAdapter.js` in progs.
        // ensureAdapter() should find it and NOT insert a duplicate.
        const pmon = new PmonComponent();
        pmon.setVersion(project.version);
        const beforeList = await pmon.getManagerOptionsList(project.name);
        const adapterCountBefore = beforeList.filter(
            (m) => m.component === 'node' && m.startOptions?.includes('debugAdapter'),
        ).length;

        // ensureAdapter() — should be idempotent
        await managerLifecycle.ensureAdapter(project);

        const afterList = await pmon.getManagerOptionsList(project.name);
        const adapterCountAfter = afterList.filter(
            (m) => m.component === 'node' && m.startOptions?.includes('debugAdapter'),
        ).length;

        assert.strictEqual(
            adapterCountAfter,
            adapterCountBefore,
            'ensureAdapter must not duplicate the adapter manager entry',
        );
    });

    // ── test 2: startScriptManager adds + starts a CTRL manager ──────────────

    test('2 — startScriptManager inserts and starts -num 98', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const sessionId = 'lifecycle-test-session-1';

        // Verify -num 98 does NOT exist before
        const pmon = new PmonComponent();
        pmon.setVersion(project.version);
        const beforeList = await pmon.getManagerOptionsList(project.name);
        const existsBefore = beforeList.some((m) =>
            m.startOptions?.includes(`-num ${LIFECYCLE_MANAGER_NUM}`),
        );
        assert.strictEqual(existsBefore, false, '-num 98 must not exist before startScriptManager');

        // Start the script manager
        const handle = await managerLifecycle.startScriptManager(
            project,
            SCRIPT_REL_PATH,
            LIFECYCLE_MANAGER_NUM,
            sessionId,
        );

        assert.ok(handle.index >= 0, 'handle.index must be valid');
        assert.strictEqual(handle.projectId, project.name);

        // Verify it exists in the manager list now
        const afterList = await pmon.getManagerOptionsList(project.name);
        const entry = afterList.find((m) =>
            m.startOptions?.includes(`-num ${LIFECYCLE_MANAGER_NUM}`),
        );
        assert.ok(entry, '-num 98 must exist after startScriptManager');
        assert.strictEqual(entry!.component, 'WCCOActrl');
        assert.ok(entry!.startOptions!.includes(SCRIPT_REL_PATH));
        assert.ok(entry!.startOptions!.includes('-dbg CTRL_DEBUGBREAK'));
    });

    // ── test 3: debug session hits BP on lifecycle-managed manager ────────────

    test('3 — debug session hits BP at line 13 via lifecycle manager', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath(SCRIPT_REL_PATH);
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            // The -num 98 manager was started in test 2 with -dbg CTRL_DEBUGBREAK.
            // It should be paused at the top, waiting for a debugger connection.
            await helper.startSession(undefined, buildLaunchConfig('E2E: lifecycle BP'), 25_000);

            const stopped = await helper.waitForEvent('stopped', 20_000);
            const body = stopped.body as { reason?: string; threadId?: number };

            assert.strictEqual(body?.reason, 'breakpoint', 'stop reason must be "breakpoint"');
            assert.ok(typeof body?.threadId === 'number', 'threadId must be a number');

            console.log('[lifecycle-e2e] ✓ BP hit on lifecycle-managed manager');
        } finally {
            await helper.dispose();
        }
    });

    // ── test 4: cleanupScriptManager removes the manager ─────────────────────

    test('4 — cleanupScriptManager stops and removes -num 98', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(30_000);

        const sessionId = 'lifecycle-test-session-1';

        // Cleanup the manager that was started in test 2
        await managerLifecycle.cleanupScriptManager(project, sessionId);

        // Verify it's gone from the manager list
        const pmon = new PmonComponent();
        pmon.setVersion(project.version);
        const afterList = await pmon.getManagerOptionsList(project.name);
        const existsAfter = afterList.some((m) =>
            m.startOptions?.includes(`-num ${LIFECYCLE_MANAGER_NUM}`),
        );
        assert.strictEqual(
            existsAfter,
            false,
            '-num 98 must be removed after cleanupScriptManager',
        );

        console.log('[lifecycle-e2e] ✓ Manager cleaned up successfully');
    });

    // ── test 5: second cleanup is a no-op ────────────────────────────────────

    test('5 — second cleanup for same session is a no-op', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(10_000);

        const sessionId = 'lifecycle-test-session-1';

        // Should not throw — handle was already removed in test 4
        await managerLifecycle.cleanupScriptManager(project, sessionId);
    });
});
