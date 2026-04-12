/**
 * ProjectDetector
 *
 * Integrates with the WinCC OA Project Admin Extension to discover the currently
 * active WinCC OA project and monitor project switches.
 *
 * Pattern is identical to vscode-winccoa-mcp-server/src/projectConfigDetector.ts.
 * On every project change:
 *   1. Read project metadata (name, path, system, version) from Project Admin API
 *   2. Check whether the winccoa-debug-adapter can connect:
 *      - Does the WinCC OA installation directory exist?
 *      - Does it contain the winccoa-manager JS package?
 *   3. Fire onDidChangeProject so extension.ts / configurationProvider can react
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Extension ID of the WinCC OA Project Admin extension */
const PROJECT_ADMIN_EXT_ID = 'RichardJanisch.winccoa-project-admin';

export interface WinccoaProject {
    /** Human-readable project name */
    name: string;
    /** Absolute path to the project directory */
    projectDir: string;
    /** WinCC OA system name, e.g. "System1" */
    system: string;
    /** WinCC OA dist host (default: localhost) */
    host: string;
    /** WinCC OA dist port (default: 4999) */
    port: number;
    /** WinCC OA installation version, e.g. "3.21" */
    version: string;
    /** Absolute path to WinCC OA installation directory */
    installDir: string;
}

export type AdapterReadiness =
    | 'ready'
    | 'no-project'
    | 'no-project-admin'
    | 'winccoa-not-found';

export interface ProjectDetectionResult {
    project: WinccoaProject | null;
    readiness: AdapterReadiness;
}

export class ProjectDetector implements vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<ProjectDetectionResult>();

    /** Fires whenever the active project changes or is re-detected. */
    readonly onDidChangeProject = this.changeEmitter.event;

    private cachedResult: ProjectDetectionResult | null = null;
    private disposables: vscode.Disposable[] = [];

    dispose(): void {
        this.changeEmitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    /**
     * Return the last cached detection result (synchronous, no I/O).
     * Returns null if detectProject() has not been called yet.
     */
    getCachedResult(): ProjectDetectionResult | null {
        return this.cachedResult;
    }

    /**
     * Detect the currently active WinCC OA project.
     * Reads from the Project Admin extension and verifies the WinCC OA installation.
     */
    async detectProject(): Promise<ProjectDetectionResult> {
        const projectAdmin = vscode.extensions.getExtension(PROJECT_ADMIN_EXT_ID);

        if (!projectAdmin) {
            const result: ProjectDetectionResult = {
                project: null,
                readiness: 'no-project-admin',
            };
            this.cachedResult = result;
            return result;
        }

        if (!projectAdmin.isActive) {
            await projectAdmin.activate();
        }

        const api = projectAdmin.exports as ProjectAdminApi | undefined;
        if (!api?.getCurrentProject) {
            const result: ProjectDetectionResult = {
                project: null,
                readiness: 'no-project-admin',
            };
            this.cachedResult = result;
            return result;
        }

        const raw = api.getCurrentProject();
        if (!raw) {
            const result: ProjectDetectionResult = {
                project: null,
                readiness: 'no-project',
            };
            this.cachedResult = result;
            return result;
        }

        const version = raw.version ?? '3.21';
        const installDir = resolveInstallDir(version);

        if (!installDir) {
            const result: ProjectDetectionResult = {
                project: null,
                readiness: 'winccoa-not-found',
            };
            this.cachedResult = result;
            return result;
        }

        const project: WinccoaProject = {
            name: raw.name,
            projectDir: raw.projectDir,
            system: raw.systemName ?? 'System1',
            host: 'localhost',
            port: 4999,
            version,
            installDir,
        };

        const result: ProjectDetectionResult = {
            project,
            readiness: 'ready',
        };
        this.cachedResult = result;
        return result;
    }

    /**
     * Subscribe to project changes from the Project Admin extension.
     * Calls detectProject() on every change and fires onDidChangeProject.
     */
    async subscribeToProjectChanges(): Promise<void> {
        const projectAdmin = vscode.extensions.getExtension(PROJECT_ADMIN_EXT_ID);

        if (!projectAdmin) {
            return;
        }

        if (!projectAdmin.isActive) {
            await projectAdmin.activate();
        }

        const api = projectAdmin.exports as ProjectAdminApi | undefined;
        if (!api?.onDidChangeProject) {
            return;
        }

        const disposable = api.onDidChangeProject(async (_project: any) => {
            const result = await this.detectProject();
            this.changeEmitter.fire(result);
        });

        // onDidChangeProject may return a vscode.Disposable or a plain function
        if (disposable && typeof (disposable as vscode.Disposable).dispose === 'function') {
            this.disposables.push(disposable as vscode.Disposable);
        }
    }
}

// ---------------------------------------------------------------------------
// Project Admin API shape (not shipped in its package — discovered at runtime)
// ---------------------------------------------------------------------------

interface ProjectAdminApi {
    getCurrentProject(): RawProject | undefined | null;
    onDidChangeProject(cb: (project: RawProject | null) => void): vscode.Disposable | (() => void);
}

interface RawProject {
    /** Display name */
    name: string;
    /** Absolute project directory */
    projectDir: string;
    /** WinCC OA system name */
    systemName?: string;
    /** WinCC OA version, e.g. "3.21" */
    version?: string;
}

// ---------------------------------------------------------------------------
// Helper: locate WinCC OA installation directory
// ---------------------------------------------------------------------------

/**
 * Return the best-match WinCC OA installation directory for the given version.
 *
 * Search order:
 *   1. /opt/WinCC_OA/<version>           (Linux standard)
 *   2. /opt/WinCC_OA/<major>.<minor>     (numeric match fallback)
 *   3. /opt/pvss                          (legacy)
 */
export function resolveInstallDir(version: string): string | null {
    const candidates = [
        `/opt/WinCC_OA/${version}`,
        `/opt/WinCC_OA/${version.split('.').slice(0, 2).join('.')}`,
        '/opt/pvss',
    ];

    for (const dir of candidates) {
        const managerPath = path.join(dir, 'javascript', 'winccoa-manager');
        if (fs.existsSync(managerPath)) {
            return dir;
        }
    }

    // Accept the directory even without the winccoa-manager package —
    // maybe it's a different install layout.
    for (const dir of candidates) {
        if (fs.existsSync(dir)) {
            return dir;
        }
    }

    return null;
}
