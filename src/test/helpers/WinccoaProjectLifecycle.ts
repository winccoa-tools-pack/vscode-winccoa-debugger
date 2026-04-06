/**
 * WinccoaProjectLifecycle
 *
 * Manages the lifetime of the `vscode-dbg` WinCC OA fixture project for VS Code
 * extension E2E tests.
 *
 * Responsibilities:
 * - Substitute <WinCC_OA_PATH> / <WinCC_OA_VERSION> / <PROJ_DIR> placeholders
 * - Restore clean SQLite databases from seeds before each test run
 * - Start/stop the WinCC OA project via PmonComponent
 * - Expose launch-config parameters for DebugSessionHelper
 *
 * Differences from the npm-winccoa-debugger version:
 * - CommonJS module (uses `__dirname` instead of `import.meta.url`)
 * - Seeds dir resolved relative to the compiled `out/test/helpers/` location
 * - No `startManagerByNum()` — scripts are launched fresh per debug session
 *
 * Usage:
 * ```typescript
 * const lc = new WinccoaProjectLifecycle();
 * if (!lc.isWinccoaAvailable()) { this.skip(); return; }
 * await lc.start();
 * try {
 *   const launchParams = lc.getLaunchParams();
 *   // ... tests using launchParams ...
 * } finally {
 *   await lc.stop();
 * }
 * ```
 *
 * Environment variables:
 *   WINCCOA_VSCODE_SKIP   – set to '1' to skip all lifecycle tests
 *   WINCCOA_TEST_HOST     – WinCC OA host  (default: localhost)
 *   WINCCOA_TEST_PORT     – WinCC OA port  (default: 4999)
 *   WINCCOA_EXTERNAL      – set to '1' when lifecycle is managed externally
 *   WINCCOA_UNREGISTER_ON_STOP – set to '1' to remove pvssInst.conf entry on stop
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import {
    PmonComponent,
    getAvailableWinCCOAVersions,
    getWinCCOAInstallationPathByVersion,
} from '@winccoa-tools-pack/npm-winccoa-core';

// ─── constants ───────────────────────────────────────────────────────────────

const PROJECT_NAME = 'runnable';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 4999;

/**
 * Absolute path to the compiled fixture project directory.
 * At runtime __dirname = out/test/helpers/, so we go up two levels to out/test/
 * then down into fixtures/projects/vscode-dbg/.
 */
const PROJ_PATH = path.resolve(__dirname, '..', 'fixtures', 'projects', PROJECT_NAME);

/**
 * SQLite seed files — copied into the project's db/ before each WinCC OA start.
 * At runtime __dirname = out/test/helpers/, seeds live at out/test/fixtures/seeds/sqlite/.
 */
const SEEDS_SQLITE_DIR = path.resolve(__dirname, '..', 'fixtures', 'seeds', 'sqlite');

/** Polling interval for TCP availability checks */
const POLL_INTERVAL_MS = 500;
/** Maximum time to wait for WinCC OA Data Manager to become reachable */
const STARTUP_TIMEOUT_MS = 30_000;
/** Maximum time to wait for WinCC OA to stop */
const STOP_TIMEOUT_MS = 15_000;

// ─── helpers ─────────────────────────────────────────────────────────────────

function isTcpReachable(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const cleanup = (result: boolean) => { socket.destroy(); resolve(result); };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => cleanup(true));
        socket.once('error', () => cleanup(false));
        socket.once('timeout', () => cleanup(false));
        socket.connect(port, host);
    });
}

async function waitForPort(
    host: string,
    port: number,
    totalMs: number,
    pollMs = POLL_INTERVAL_MS,
): Promise<boolean> {
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
        if (await isTcpReachable(host, port)) return true;
        await new Promise((r) => setTimeout(r, pollMs));
    }
    return false;
}

async function waitForPortClosed(
    host: string,
    port: number,
    totalMs: number,
    pollMs = POLL_INTERVAL_MS,
): Promise<void> {
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
        if (!(await isTcpReachable(host, port))) return;
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── main class ──────────────────────────────────────────────────────────────

/**
 * Manages the WinCC OA `vscode-dbg` fixture project lifecycle for VS Code E2E tests.
 */
export class WinccoaProjectLifecycle {
    private readonly host: string;
    private readonly port: number;
    private winccoaInstallPath: string | null = null;
    private winccoaVersion: string | null = null;
    /** Set to true when start() registered the project — used to decide cleanup in stop() */
    private didRegisterProject = false;

    constructor() {
        this.host = process.env['WINCCOA_TEST_HOST'] ?? DEFAULT_HOST;
        this.port = Number(process.env['WINCCOA_TEST_PORT'] ?? DEFAULT_PORT);

        // Restore config placeholders on process exit as a safety net.
        process.on('exit', () => this.restoreConfigPlaceholders());
    }

    // ─── public API ────────────────────────────────────────────────────────────

    /**
     * Returns false when:
     * - WINCCOA_VSCODE_SKIP=1 is set, or
     * - No WinCC OA installation is found on this machine.
     */
    public isWinccoaAvailable(): boolean {
        if (process.env['WINCCOA_EXTERNAL'] === '1') return true;
        if (process.env['WINCCOA_VSCODE_SKIP'] === '1') return false;
        return this.resolveInstallation() !== null;
    }

    /**
     * Prepare config, restore DB from seeds, register and start the WinCC OA project.
     * Idempotent: if WinCC OA is already reachable, startup is skipped.
     */
    public async start(): Promise<void> {
        if (process.env['WINCCOA_EXTERNAL'] === '1') return;

        this.requireAvailable();
        this.substituteConfigPlaceholders();

        if (await isTcpReachable(this.host, this.port)) {
            console.log(
                `[WinccoaProjectLifecycle] WinCC OA already reachable at ${this.host}:${this.port} — skipping start`,
            );
            return;
        }

        const info = this.resolveInstallation()!;
        const pmon = new PmonComponent();
        pmon.setVersion(info.version);

        const configFilePath = path.join(PROJ_PATH, 'config', 'config');
        if (this.isProjectRegisteredInPvssConf()) {
            console.log(
                `[WinccoaProjectLifecycle] Project "${PROJECT_NAME}" already registered — skipping registration`,
            );
        } else {
            console.log(`[WinccoaProjectLifecycle] Registering project "${PROJECT_NAME}" …`);
            await pmon.registerProject(configFilePath, info.version);
            this.didRegisterProject = true;
        }

        this.restoreDbFromSeed();

        console.log(`[WinccoaProjectLifecycle] Starting WinCC OA project "${PROJECT_NAME}" …`);
        await pmon.startProject(PROJECT_NAME, false);

        const ready = await waitForPort(this.host, this.port, STARTUP_TIMEOUT_MS);
        if (!ready) {
            throw new Error(
                `[WinccoaProjectLifecycle] WinCC OA did not become reachable on ` +
                `${this.host}:${this.port} within ${STARTUP_TIMEOUT_MS / 1000}s`,
            );
        }
        console.log(`[WinccoaProjectLifecycle] WinCC OA ready at ${this.host}:${this.port}`);
    }

    /**
     * Stop pmon and wait for port to close.
     * The pvssInst.conf registration is kept by default so the project remains
     * visible in VS Code Project Admin.  Set WINCCOA_UNREGISTER_ON_STOP=1 to remove it.
     */
    public async stop(): Promise<void> {
        if (process.env['WINCCOA_EXTERNAL'] === '1') return;

        this.requireAvailable();

        if (!(await isTcpReachable(this.host, this.port))) {
            console.log('[WinccoaProjectLifecycle] WinCC OA not running — skipping stop');
            return;
        }

        const info = this.resolveInstallation()!;
        const pmon = new PmonComponent();
        pmon.setVersion(info.version);

        console.log(`[WinccoaProjectLifecycle] Stopping WinCC OA project "${PROJECT_NAME}" …`);
        await pmon.stopProjectAndPmon(PROJECT_NAME, STOP_TIMEOUT_MS);
        await waitForPortClosed(this.host, this.port, STOP_TIMEOUT_MS);
        console.log('[WinccoaProjectLifecycle] WinCC OA stopped');

        if (this.didRegisterProject && process.env['WINCCOA_UNREGISTER_ON_STOP'] === '1') {
            console.log(`[WinccoaProjectLifecycle] Unregistering project "${PROJECT_NAME}" …`);
            await pmon.unregisterProject(PROJECT_NAME);
            this.didRegisterProject = false;
        }

        this.restoreConfigPlaceholders();
    }

    /**
     * Returns true if WinCC OA is currently reachable on the configured port.
     */
    public async isRunning(): Promise<boolean> {
        return isTcpReachable(this.host, this.port);
    }

    /**
     * Starts a specific CTRL manager identified by its `-num N` flag.
     * Scans the manager list via pmon and starts the entry whose options contain `-num <managerNum>`.
     */
    public async startManagerByNum(managerNum: number): Promise<void> {
        this.requireAvailable();
        const info = this.resolveInstallation()!;
        const pmon = new PmonComponent();
        pmon.setVersion(info.version);

        const list = await pmon.getManagerOptionsList(PROJECT_NAME);
        const idx = list.findIndex((m) => m.startOptions?.includes(`-num ${managerNum}`));
        if (idx < 0) {
            throw new Error(
                `[WinccoaProjectLifecycle] No manager with -num ${managerNum} found in manager list`,
            );
        }
        console.log(`[WinccoaProjectLifecycle] Starting manager -num ${managerNum} (index ${idx}) …`);
        await pmon.startManager(PROJECT_NAME, idx);
    }

    /**
     * Stops a specific CTRL manager identified by its `-num N` flag.
     */
    public async stopManagerByNum(managerNum: number): Promise<void> {
        this.requireAvailable();
        const info = this.resolveInstallation()!;
        const pmon = new PmonComponent();
        pmon.setVersion(info.version);

        const list = await pmon.getManagerOptionsList(PROJECT_NAME);
        const idx = list.findIndex((m) => m.startOptions?.includes(`-num ${managerNum}`));
        if (idx < 0) {
            throw new Error(
                `[WinccoaProjectLifecycle] No manager with -num ${managerNum} found in manager list`,
            );
        }
        console.log(`[WinccoaProjectLifecycle] Stopping manager -num ${managerNum} (index ${idx}) …`);
        await pmon.stopManager(PROJECT_NAME, idx);
    }

    /**
     * Returns the project name used for all debug launch configurations.
     */
    public getProjectName(): string {
        return PROJECT_NAME;
    }

    /**
     * Returns the resolved WinCC OA version string (e.g. "3.21").
     * Only valid after isWinccoaAvailable() returned true.
     */
    public getVersion(): string {
        return this.resolveInstallation()?.version ?? '3.21';
    }

    /**
     * Returns the base set of debug launch configuration parameters shared by all
     * vscode-dbg test suites.  Merge with script-specific fields before passing to
     * `vscode.debug.startDebugging()`.
     */
    public getBaseLaunchConfig(): {
        project: string;
        system: string;
        host: string;
        port: number;
        winCCOAVersion: string;
        adapterManagerNumber: number;
    } {
        return {
            project: PROJECT_NAME,
            system: PROJECT_NAME,
            host: this.host,
            port: this.port,
            winCCOAVersion: this.getVersion(),
            adapterManagerNumber: 99,
        };
    }

    /**
     * Returns the absolute path to a CTL script inside the compiled fixture directory.
     * @param relPath  e.g. 'bp_basic_loop.ctl' or 'libs/debugger_lib.ctl'
     */
    public getScriptPath(relPath: string): string {
        return path.join(PROJ_PATH, 'scripts', relPath);
    }

    // ─── internal ──────────────────────────────────────────────────────────────

    private requireAvailable(): void {
        if (!this.isWinccoaAvailable()) {
            throw new Error(
                '[WinccoaProjectLifecycle] WinCC OA is not available on this machine. ' +
                'Set WINCCOA_VSCODE_SKIP=1 to skip.',
            );
        }
    }

    private substituteConfigPlaceholders(): void {
        const info = this.resolveInstallation();
        if (!info) return;

        const configDir = path.join(PROJ_PATH, 'config');
        if (!fs.existsSync(configDir)) return;

        for (const file of fs.readdirSync(configDir)) {
            const filePath = path.join(configDir, file);
            if (!fs.statSync(filePath).isFile()) continue;
            let content = fs.readFileSync(filePath, 'utf-8');
            if (
                !content.includes('<WinCC_OA_PATH>') &&
                !content.includes('<WinCC_OA_VERSION>') &&
                !content.includes('<PROJ_DIR>')
            ) {
                continue;
            }
            content = content
                .replace(/<WinCC_OA_PATH>/g, info.installPath)
                .replace(/<WinCC_OA_VERSION>/g, info.version)
                .replace(/<PROJ_DIR>/g, PROJ_PATH);
            fs.writeFileSync(filePath, content, 'utf-8');
        }
    }

    private restoreConfigPlaceholders(): void {
        if (process.env['WINCCOA_EXTERNAL'] === '1') return;
        if (!this.didRegisterProject || process.env['WINCCOA_UNREGISTER_ON_STOP'] !== '1') return;

        const info = this.resolveInstallation();
        if (!info) return;

        const configDir = path.join(PROJ_PATH, 'config');
        if (!fs.existsSync(configDir)) return;

        for (const file of fs.readdirSync(configDir)) {
            const filePath = path.join(configDir, file);
            if (!fs.statSync(filePath).isFile()) continue;
            let content = fs.readFileSync(filePath, 'utf-8');
            if (
                !content.includes(info.installPath) &&
                !content.includes(info.version) &&
                !content.includes(PROJ_PATH)
            ) {
                continue;
            }
            content = content
                .replace(new RegExp(escapeRegExp(PROJ_PATH), 'g'), '<PROJ_DIR>')
                .replace(new RegExp(escapeRegExp(info.installPath), 'g'), '<WinCC_OA_PATH>')
                .replace(new RegExp(escapeRegExp(info.version), 'g'), '<WinCC_OA_VERSION>');
            fs.writeFileSync(filePath, content, 'utf-8');
        }
    }

    private restoreDbFromSeed(): void {
        const targetDir = path.join(PROJ_PATH, 'db', 'wincc_oa', 'sqlite');
        if (!fs.existsSync(SEEDS_SQLITE_DIR)) {
            console.warn(
                `[WinccoaProjectLifecycle] Seed directory not found: ${SEEDS_SQLITE_DIR} — skipping DB restore`,
            );
            return;
        }
        fs.mkdirSync(targetDir, { recursive: true });
        for (const file of fs.readdirSync(SEEDS_SQLITE_DIR)) {
            if (!file.endsWith('.sqlite')) continue;
            fs.copyFileSync(
                path.join(SEEDS_SQLITE_DIR, file),
                path.join(targetDir, file),
            );
        }
        console.log(`[WinccoaProjectLifecycle] DB restored from seeds`);
    }

    private isProjectRegisteredInPvssConf(): boolean {
        const pvssInstConfPath =
            process.platform === 'win32'
                ? 'C:\\ProgramData\\Siemens\\WinCC_OA\\pvssInst.conf'
                : '/etc/opt/pvss/pvssInst.conf';
        try {
            const content = fs.readFileSync(pvssInstConfPath, 'utf-8');
            return content.includes(PROJ_PATH);
        } catch {
            return false;
        }
    }

    private resolveInstallation(): { installPath: string; version: string } | null {
        if (this.winccoaInstallPath && this.winccoaVersion) {
            return { installPath: this.winccoaInstallPath, version: this.winccoaVersion };
        }
        try {
            const versions = getAvailableWinCCOAVersions();
            if (versions.length === 0) return null;
            const version = versions.includes('3.21') ? '3.21' : versions[versions.length - 1];
            const installPath = getWinCCOAInstallationPathByVersion(version);
            if (!installPath) return null;
            this.winccoaInstallPath = installPath;
            this.winccoaVersion = version;
            return { installPath, version };
        } catch {
            return null;
        }
    }
}
