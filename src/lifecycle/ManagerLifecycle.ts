/**
 * ManagerLifecycle
 *
 * Manages the full debug-session lifecycle via WinCC OA pmon:
 *
 *   1. **Adapter manager** — persistent node manager running debugAdapter.js.
 *      Added once and left running across sessions. Listens on TCP port 7474.
 *
 *   2. **Script manager** — WCCOActrl manager running the user's CTRL script
 *      with `-dbg CTRL_DEBUGBREAK`. Added at debug-start, removed at debug-end.
 *
 * All pmon interaction goes through PmonComponent from npm-winccoa-core.
 */

import * as vscode from 'vscode';
import {
    PmonComponent,
    ProjEnvManagerOptions,
    ProjEnvManagerStartMode,
    ProjEnvManagerState,
} from '@winccoa-tools-pack/npm-winccoa-core';
import { WinccoaProject } from '../projectDetector';
import { AdapterDeployer } from './AdapterDeployer';

/** Default TCP port the debug adapter listens on */
export const ADAPTER_PORT = 7474;

/** Start options path used for the adapter node manager in pmon */
const ADAPTER_START_OPTIONS = 'debugAdapter/debugAdapter.js';
/** Keyword used to detect the adapter manager in the pmon manager list */
const ADAPTER_MANAGER_KEY = 'debugAdapter';

export interface ScriptManagerHandle {
    /** Index in pmon's manager list (needed for stop/remove) */
    index: number;
    /** The project ID used with PmonComponent */
    projectId: string;
    /** WinCC OA version (needed to create PmonComponent during cleanup) */
    version: string;
}

export interface AttachManagerHandle {
    /** Index in pmon's manager list (needed for stop) */
    index: number;
    /** The project ID used with PmonComponent */
    projectId: string;
    /** WinCC OA version (needed to create PmonComponent during cleanup) */
    version: string;
    /** Whether the manager was started by us (only stop if we started it) */
    wasStartedByUs: boolean;
}

export class ManagerLifecycle implements vscode.Disposable {
    private readonly deployer: AdapterDeployer;
    private readonly outputChannel: vscode.OutputChannel | null;

    /** Tracks script managers added during debug sessions → cleaned up on terminate */
    private activeScriptManagers = new Map<string, ScriptManagerHandle>();
    /** Tracks attach managers started via autoStartManager → stopped on terminate */
    private activeAttachManagers = new Map<string, AttachManagerHandle>();

    constructor(deployer: AdapterDeployer, outputChannel?: vscode.OutputChannel | null) {
        this.deployer = deployer;
        this.outputChannel = outputChannel ?? null;
    }

    dispose(): void {
        this.activeScriptManagers.clear();
        this.activeAttachManagers.clear();
    }

    // ─── Adapter lifecycle ─────────────────────────────────────────────────────

    /**
     * Ensure the debug adapter manager is present in pmon and running.
     *
     * Steps:
     *   1. Deploy debugAdapter.js into the project's javascript/ directory
     *   2. Check pmon manager list for existing adapter entry
     *   3. If missing → insert as manual node manager
     *   4. Start the manager if not already running
     */
    async ensureAdapter(project: WinccoaProject): Promise<void> {
        // Step 1: Deploy the adapter JS file
        this.log(`Deploying debug adapter to ${project.projectDir}...`);
        await this.deployer.deploy(project.projectDir);

        const pmon = this.createPmon(project.version);
        const projectId = this.getProjectId(project);

        // Step 2: Find existing adapter manager
        const managers = await pmon.getManagerOptionsList(projectId);
        let adapterIndex = managers.findIndex(
            (m) => m.component === 'node' && m.startOptions?.includes(ADAPTER_MANAGER_KEY),
        );

        // Step 3: Insert if missing
        if (adapterIndex < 0) {
            this.log('Adapter manager not found in pmon — inserting...');
            const options: ProjEnvManagerOptions = {
                component: 'node',
                startMode: ProjEnvManagerStartMode.Manual,
                secondToKill: 30,
                resetMin: 1,
                resetStartCounter: 1,
                startOptions: ADAPTER_START_OPTIONS,
            };
            const insertPosition = managers.length;
            const exitCode = await pmon.insertManagerAt(options, projectId, insertPosition);
            if (exitCode !== 0) {
                throw new Error(`Failed to insert adapter manager (pmon exit code ${exitCode})`);
            }
            adapterIndex = insertPosition;
            this.log(`Adapter manager inserted at index ${adapterIndex}`);
        } else {
            this.log(`Adapter manager found at index ${adapterIndex}`);
        }

        // Step 4: Start the manager
        this.log('Starting adapter manager...');
        const startCode = await pmon.startManager(projectId, adapterIndex);
        if (startCode !== 0) {
            this.log(`Warning: pmon startManager returned ${startCode} (may already be running)`);
        }
    }

    // ─── Attach manager lifecycle (autoStartManager) ────────────────────────

    /**
     * Ensure a specific manager (identified by manager number) is running.
     * Used by the `autoStartManager` attach flag.
     *
     * Looks through the pmon manager list to find a WCCOActrl entry with the
     * matching `-num` flag. If found and not running, starts it via pmon.
     *
     * @param project       Current WinCC OA project
     * @param managerNumber Manager number to look for (-num flag value)
     * @param sessionId     Debug session ID (used for cleanup tracking)
     * @returns Handle for cleanup, or null if manager was already running
     */
    async ensureManagerRunning(
        project: WinccoaProject,
        managerNumber: number,
        sessionId: string,
    ): Promise<AttachManagerHandle | null> {
        const pmon = this.createPmon(project.version);
        const projectId = this.getProjectId(project);

        // Get status of all managers
        const status = await pmon.getProjectStatus(projectId);
        const managers = await pmon.getManagerOptionsList(projectId);

        // Find the manager entry with matching -num
        const targetIndex = managers.findIndex((m) =>
            m.startOptions?.includes(`-num ${managerNumber}`),
        );

        if (targetIndex < 0) {
            throw new Error(
                `Manager with -num ${managerNumber} not found in pmon config. ` +
                    `Add it to the progs file first, or use request "launch" to create a temporary one.`,
            );
        }

        const managerInfo = status.managers[targetIndex];
        const isRunning =
            managerInfo &&
            (managerInfo.state === ProjEnvManagerState.Running ||
                managerInfo.state === ProjEnvManagerState.Init);

        const handle: AttachManagerHandle = {
            index: targetIndex,
            projectId,
            version: project.version,
            wasStartedByUs: false,
        };

        if (isRunning) {
            this.log(`Manager -num ${managerNumber} already running at index ${targetIndex}`);
            this.activeAttachManagers.set(sessionId, handle);
            return handle;
        }

        // Start the manager
        this.log(`Starting manager -num ${managerNumber} at index ${targetIndex}...`);
        const startCode = await pmon.startManager(projectId, targetIndex);
        if (startCode !== 0) {
            throw new Error(
                `Failed to start manager -num ${managerNumber} (pmon exit code ${startCode})`,
            );
        }

        handle.wasStartedByUs = true;
        this.activeAttachManagers.set(sessionId, handle);
        this.log(`Manager -num ${managerNumber} started successfully`);
        return handle;
    }

    /**
     * Stop a manager that was started via autoStartManager.
     * Only stops it if `autoStopOnDisconnect` was set and we actually started it.
     */
    async cleanupAttachManager(
        project: WinccoaProject | null,
        sessionId: string,
        autoStopOnDisconnect: boolean,
    ): Promise<void> {
        const handle = this.activeAttachManagers.get(sessionId);
        if (!handle) {
            return;
        }

        if (autoStopOnDisconnect && handle.wasStartedByUs) {
            const pmon = this.createPmon(project?.version ?? handle.version);
            try {
                this.log(`Stopping attach manager at index ${handle.index}...`);
                await pmon.stopManager(handle.projectId, handle.index);
            } catch (e: unknown) {
                this.log(`Warning: stop attach manager failed: ${(e as Error).message}`);
            }
        }

        this.activeAttachManagers.delete(sessionId);
    }

    // ─── Script manager lifecycle ──────────────────────────────────────────────

    /**
     * Add and start a WCCOActrl manager for the user's script with debug flags.
     *
     * @param project      Current WinCC OA project
     * @param scriptPath   Relative path to the CTRL script (e.g. "scripts/test.ctl")
     * @param managerNum   Manager number for -num flag
     * @param sessionId    Debug session ID (used as key for cleanup tracking)
     * @returns The pmon index of the added manager
     */
    async startScriptManager(
        project: WinccoaProject,
        scriptPath: string,
        managerNum: number,
        sessionId: string,
    ): Promise<ScriptManagerHandle> {
        const pmon = this.createPmon(project.version);
        const projectId = this.getProjectId(project);

        const options: ProjEnvManagerOptions = {
            component: 'WCCOActrl',
            startMode: ProjEnvManagerStartMode.Manual,
            secondToKill: 30,
            resetMin: 1,
            resetStartCounter: 1,
            startOptions: `-num ${managerNum} ${scriptPath} -dbg CTRL_DEBUGBREAK`,
        };

        // Get current list to find insert position
        const managers = await pmon.getManagerOptionsList(projectId);
        const insertPosition = managers.length;

        this.log(
            `Inserting script manager: WCCOActrl -num ${managerNum} ${scriptPath} -dbg CTRL_DEBUGBREAK at index ${insertPosition}`,
        );
        const exitCode = await pmon.insertManagerAt(options, projectId, insertPosition);
        if (exitCode !== 0) {
            throw new Error(`Failed to insert script manager (pmon exit code ${exitCode})`);
        }

        // Start the manager
        this.log(`Starting script manager at index ${insertPosition}...`);
        const startCode = await pmon.startManager(projectId, insertPosition);
        if (startCode !== 0) {
            throw new Error(`Failed to start script manager (pmon exit code ${startCode})`);
        }

        const handle: ScriptManagerHandle = {
            index: insertPosition,
            projectId,
            version: project.version,
        };
        this.activeScriptManagers.set(sessionId, handle);
        return handle;
    }

    /**
     * Stop and remove the script manager that was added for a debug session.
     * The project parameter is optional — when omitted, the version stored in
     * the handle is used.  This allows cleanup even when ProjectDetector
     * did not detect a project (e.g. Project Admin extension not installed).
     */
    async cleanupScriptManager(project: WinccoaProject | null, sessionId: string): Promise<void> {
        const handle = this.activeScriptManagers.get(sessionId);
        if (!handle) {
            this.log(`No script manager tracked for session ${sessionId}`);
            return;
        }

        const pmon = this.createPmon(project?.version ?? handle.version);

        try {
            this.log(`Stopping script manager at index ${handle.index}...`);
            await pmon.stopManager(handle.projectId, handle.index);
        } catch (e: unknown) {
            this.log(`Warning: stop failed: ${(e as Error).message} (may already be stopped)`);
        }

        // Wait for pmon to fully process the stop before attempting removal
        await new Promise((r) => setTimeout(r, 1000));

        try {
            this.log(`Removing script manager at index ${handle.index}...`);
            await pmon.removeManager(handle.projectId, handle.index);
        } catch (e: unknown) {
            this.log(`Warning: remove failed: ${(e as Error).message}`);
        }

        this.activeScriptManagers.delete(sessionId);
    }

    /**
     * Clean up all tracked managers (e.g. on extension deactivation).
     */
    async cleanupAll(project: WinccoaProject | null): Promise<void> {
        for (const sessionId of [...this.activeScriptManagers.keys()]) {
            await this.cleanupScriptManager(project, sessionId);
        }
        for (const sessionId of [...this.activeAttachManagers.keys()]) {
            await this.cleanupAttachManager(project, sessionId, true);
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private createPmon(version: string): PmonComponent {
        const pmon = new PmonComponent();
        try {
            pmon.setVersion(version);
        } catch {
            this.log(`Warning: could not set WinCC OA version ${version} for pmon`);
        }
        return pmon;
    }

    /**
     * Derive the project ID that pmon expects.
     * This is the project directory base name (e.g. "DevEnv3.21").
     */
    private getProjectId(project: WinccoaProject): string {
        // Use the project name as-is — it matches what pmon expects
        return project.name;
    }

    private log(message: string): void {
        const line = `[lifecycle] ${message}`;
        if (this.outputChannel) {
            this.outputChannel.appendLine(line);
        } else {
            console.log(line);
        }
    }
}
