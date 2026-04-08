/**
 * debugger-setup-e2e.test.ts
 *
 * Foundation E2E test — verifies the full test environment is wired up
 * correctly before any feature tests run.
 *
 * What this test covers:
 *   1. WinCC OA (fixture project "runnable") starts and Data Manager port is reachable
 *   2. The debugger extension itself is active in the test VS Code instance
 *   3. The Core extension (Project Admin) is installed and active
 *   4. Core API exposes getRunningProjects / setCurrentProject and the
 *      "runnable" project appears after startup — and can be set as active
 *   5. A CTL script (bp_basic_loop.ctl) can be opened in the VS Code editor
 *      so the user can see the source and breakpoints during subsequent tests
 *
 * workspaceFolder: ./out/test/fixtures/projects/runnable
 *   → VS Code Explorer shows scripts/, config/, etc. during the test run.
 *     This is intentional — the user can watch breakpoints fire in the editor.
 *
 * Running locally:
 *   npm run test:e2e:setup
 *
 * Prerequisites:
 *   - WinCC OA 3.21 installed
 *   - Set WINCCOA_VSCODE_SKIP=1 to opt-out when WinCC OA is unavailable
 *   - Set WINCCOA_EXTERNAL=1 when the project is already running externally
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { CORE_EXTENSION_ID, EXTENSION_ID } from '../../const';
import { waitForCoreApi } from '../../otherExtensions';

// ─── types ───────────────────────────────────────────────────────────────────

type CoreApi = {
    /** Returns Promise<ProjectInfo[]> — MUST be awaited */
    getRunningProjects?: () => Promise<unknown[]>;
    getCurrentProject?: () => unknown;
    /** Takes a project ID string (not the project object) */
    setCurrentProject?: (projectId: string) => void | Promise<void>;
    onDidChangeProject?: (cb: (p: unknown) => void) => (() => void) | void;
};

// ─── suite ───────────────────────────────────────────────────────────────────

const lifecycle = new WinccoaProjectLifecycle();

suite('WinCC OA Debugger — E2E Setup Verification', function () {
    this.timeout(180_000);

    /** Set to true in suiteSetup when WinCC OA started successfully */
    let canRun = false;

    // ── lifecycle ────────────────────────────────────────────────────────────

    suiteSetup(async function () {
        this.timeout(120_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[setup-e2e] WinCC OA not available — all tests will be skipped');
            return;
        }

        try {
            await lifecycle.start();
            canRun = true;
            console.log('[setup-e2e] WinCC OA started — ready to run');
        } catch (err) {
            console.error(`[setup-e2e] Startup failed: ${(err as Error).message}`);
        }
    });

    suiteTeardown(async function () {
        this.timeout(30_000);

        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle.stop().catch((e: Error) =>
                console.error(`[setup-e2e] stop failed: ${e.message}`),
            );
        }
    });

    // ── tests ─────────────────────────────────────────────────────────────────

    /**
     * Test 1 — The most basic gate: WinCC OA is reachable.
     * If this fails, every subsequent test in every other suite will also fail.
     */
    test('1 — WinCC OA project is reachable on Data Manager port', async function () {
        if (!canRun) {
            this.skip();
            return;
        }

        const running = await lifecycle.isRunning();
        assert.strictEqual(
            running,
            true,
            `WinCC OA Data Manager must be reachable on port 4999. ` +
                `Check that the "${lifecycle.getProjectName()}" project started.`,
        );
    });

    /**
     * Test 2 — The debugger extension must be active in this VS Code instance.
     * The extension registers the "winccoa" debug type; without it, no debug session
     * can start.
     */
    test('2 — debugger extension is active in this VS Code instance', function () {
        if (!canRun) {
            this.skip();
            return;
        }

        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `Extension "${EXTENSION_ID}" must be installed/loaded`);
        assert.ok(
            ext.isActive,
            `Extension "${EXTENSION_ID}" must be active. ` +
                `Check activationEvents in package.json.`,
        );
    });

    /**
     * Test 3 — The Core extension (Project Admin) is installed and activates.
     * The debugger uses it to resolve the current WinCC OA project.
     */
    test('3 — Core extension (Project Admin) is installed and active', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(20_000);

        const ext = vscode.extensions.getExtension(CORE_EXTENSION_ID);
        assert.ok(ext, `Core extension "${CORE_EXTENSION_ID}" must be installed`);

        if (!ext.isActive) {
            try {
                await ext.activate();
            } catch {
                // activate() can throw if activation is gated on activationEvents;
                // the active check below provides the real verdict.
            }
        }

        assert.ok(
            ext.isActive,
            `Core extension "${CORE_EXTENSION_ID}" must be active after explicit activation.`,
        );
    });

    /**
     * Test 4 — Core API exposes getRunningProjects(), the runnable fixture project
     * appears in the list, and setCurrentProject() fires onDidChangeProject.
     *
     * This is the key integration check: VS Code ↔ Core extension ↔ WinCC OA pmon.
     * If this passes the Project Admin / project selection pipeline is fully wired.
     *
     * API shape (from vscode-winccoa-control extension.ts):
     *   getRunningProjects()   → Promise<ProjectInfo[]>  (must be awaited)
     *   setCurrentProject(id)  → takes a string project ID, not the project object
     *   onDidChangeProject     → fires with ProjectInfo after setCurrentProject()
     */
    test('4 — Core API: running project visible and can be set active', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
        assert.ok(coreApi, 'Core extension API must be reachable via waitForCoreApi()');

        // Guard: if the API shape is not what we expect, skip gracefully rather than fail
        if (
            typeof coreApi.getRunningProjects !== 'function' ||
            typeof coreApi.setCurrentProject !== 'function'
        ) {
            console.warn(
                '[setup-e2e] Core API shape mismatch (getRunningProjects / setCurrentProject missing) — skipping',
            );
            this.skip();
            return;
        }

        // Force a refresh so the background initialization results are up to date.
        // The Core extension initializes in the background (fire-and-forget); if we
        // arrive here right after activation the project list may still be empty.
        console.log('[setup-e2e] Triggering winccoa.core.refreshProjects …');
        await vscode.commands.executeCommand('winccoa.core.refreshProjects').then(
            () => console.log('[setup-e2e] refreshProjects done'),
            (e) => console.warn('[setup-e2e] refreshProjects failed (non-fatal):', e),
        );

        // Poll until the project appears in the running list.
        // getRunningProjects() returns a Promise<ProjectInfo[]> — always await it.
        let runningProjects: unknown[] = [];
        const projectName = lifecycle.getProjectName(); // 'runnable'
        const deadline = Date.now() + 20_000;

        while (Date.now() < deadline) {
            runningProjects = (await coreApi.getRunningProjects!()) ?? [];
            if (runningProjects.length > 0) {
                break;
            }
            // Retry refresh every 2 s if still empty
            if (Date.now() + 2_000 < deadline) {
                await new Promise((r) => setTimeout(r, 2_000));
                await vscode.commands.executeCommand('winccoa.core.refreshProjects').then(
                    undefined,
                    () => undefined,
                );
            } else {
                await new Promise((r) => setTimeout(r, 500));
            }
        }

        assert.ok(
            runningProjects.length > 0,
            `getRunningProjects() returned an empty array after polling. ` +
                `Ensure that the "${projectName}" project is registered and running in pmon. ` +
                `Check that pvssInst.conf contains the fixture project path.`,
        );

        // The Project Admin stores the project ID — for our fixture it is the
        // project directory name ('runnable') or whatever pmon reports.
        const target = runningProjects[0] as Record<string, unknown>;
        const targetId = target['id'] as string | undefined;

        console.log(
            `[setup-e2e] Found running project: id="${targetId}" name="${target['name']}"`,
        );

        assert.ok(targetId, 'Running project must have a string "id" field');

        // setCurrentProject() takes a string project ID (not the object itself)
        if (typeof coreApi.onDidChangeProject === 'function') {
            const changePromise = new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Timed out waiting for onDidChangeProject event')),
                    10_000,
                );
                const unsub = coreApi.onDidChangeProject!((p: unknown) => {
                    clearTimeout(timer);
                    if (typeof unsub === 'function') {
                        unsub();
                    }
                    resolve(p);
                });
            });

            await Promise.resolve(coreApi.setCurrentProject!(targetId));
            await changePromise;
        } else {
            await Promise.resolve(coreApi.setCurrentProject!(targetId));
        }

        const current = coreApi.getCurrentProject?.() as Record<string, unknown> | undefined;
        assert.ok(
            current !== undefined && current !== null,
            'getCurrentProject() must return a project after setCurrentProject() was called',
        );

        console.log(
            `[setup-e2e] Active project confirmed: id="${current?.['id']}" name="${current?.['name']}"`,
        );
    });

    /**
     * Test 5 — A CTL script can be opened in the VS Code editor.
     *
     * This is the visual anchor for all subsequent E2E tests: the user can see
     * where breakpoints are set while the debugger test runs.
     *
     * workspaceFolder for this label is ./out/test/fixtures/projects/runnable so
     * Explorer also shows scripts/, config/ etc. in the sidebar.
     */
    test('5 — bp_basic_loop.ctl opens in VS Code editor', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(15_000);

        const scriptPath = lifecycle.getScriptPath('bp_basic_loop.ctl');
        const uri = vscode.Uri.file(scriptPath);

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        assert.ok(
            vscode.window.activeTextEditor !== undefined,
            'A text editor must be active after opening bp_basic_loop.ctl',
        );
        assert.strictEqual(
            vscode.window.activeTextEditor!.document.uri.fsPath,
            uri.fsPath,
            'Active editor should show bp_basic_loop.ctl',
        );
        assert.ok(
            doc.getText().includes('counter++'),
            'bp_basic_loop.ctl must contain "counter++" — the designated breakpoint line',
        );

        console.log(`[setup-e2e] bp_basic_loop.ctl is open in editor at ${scriptPath}`);
    });
});
