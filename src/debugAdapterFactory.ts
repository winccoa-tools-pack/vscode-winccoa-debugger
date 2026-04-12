/**
 * WinCCDebugAdapterDescriptorFactory
 *
 * Connects VS Code to the WinCC OA debug adapter TCP server.
 *
 * The adapter process is started and managed by WinCC OA pmon as a `node`
 * manager entry in the project's progs file.  The adapter listens on a fixed
 * TCP port (default 7474) and VS Code connects via DebugAdapterServer.
 *
 * On first use the factory calls ManagerLifecycle.ensureAdapter() to deploy
 * the adapter JS file and register+start it via pmon automatically.
 */

import * as net from 'net';
import * as vscode from 'vscode';
import { getRegisteredProjects } from '@winccoa-tools-pack/npm-winccoa-core';
import { ManagerLifecycle, ADAPTER_PORT } from './lifecycle';
import { WinccoaProject, resolveInstallDir } from './projectDetector';

/** Milliseconds to wait for the adapter's TCP server to become available. */
const ADAPTER_READY_TIMEOUT_MS = 15_000;
/** Polling interval while waiting for the TCP server. */
const ADAPTER_READY_POLL_MS = 100;

export class WinCCDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable
{
  private lifecycle: ManagerLifecycle | null = null;
  private project: WinccoaProject | null = null;

  constructor(_context: vscode.ExtensionContext) {
    // lifecycle and project are injected after construction via setters.
  }

  setLifecycle(lifecycle: ManagerLifecycle): void {
    this.lifecycle = lifecycle;
  }

  setProject(project: WinccoaProject | null): void {
    this.project = project;
  }

  dispose(): void {
    // Adapter lifecycle is managed by pmon — nothing to dispose.
  }

  async createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined,
  ): Promise<vscode.DebugAdapterDescriptor> {
    const config = session.configuration as {
      adapterPort?: number;
      script?: string;
      scriptManagerNum?: number;
      project?: string;
      system?: string;
      host?: string;
      port?: number;
      winCCOAVersion?: string;
      autoStartManager?: boolean;
      autoStopOnDisconnect?: boolean;
      manager?: { type: string; number: number };
    };

    const port = config.adapterPort ?? ADAPTER_PORT;

    // Resolve the project: prefer the injected project, fall back to pvssInst.conf
    const project = this.project ?? await this.resolveProjectFromConfig(config);

    // Auto-start the adapter if lifecycle management is available
    if (this.lifecycle && project) {
      await this.lifecycle.ensureAdapter(project);

      // Quick debug: start a temporary script manager for the .ctl file
      if (config.script && config.scriptManagerNum) {
        await this.lifecycle.startScriptManager(
          project,
          config.script,
          config.scriptManagerNum,
          session.id,
        );
        // Give the CTRL manager time to initialise debug DPs
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // autoStartManager: start an existing pmon manager if not running
      if (config.autoStartManager && !config.script && config.manager?.number) {
        await this.lifecycle.ensureManagerRunning(
          project,
          config.manager.number,
          session.id,
        );
        // Give the manager time to initialise debug DPs
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }

    await this.waitForPort(port);
    return new vscode.DebugAdapterServer(port, '127.0.0.1');
  }

  /**
   * Fallback project resolution from the debug config + pvssInst.conf.
   * Used when ProjectDetector did not detect a project (e.g. Project Admin
   * extension not installed).
   */
  private async resolveProjectFromConfig(config: {
    project?: string;
    system?: string;
    host?: string;
    port?: number;
    winCCOAVersion?: string;
  }): Promise<WinccoaProject | null> {
    const projectName = config.project;
    if (!projectName) {
      return null;
    }

    try {
      const projects = await getRegisteredProjects();
      const registered = projects.find((p) => p.getId() === projectName);
      if (!registered) {
        return null;
      }

      const version = config.winCCOAVersion ?? registered.getVersion() ?? '3.21';
      const installDir = resolveInstallDir(version);
      if (!installDir) {
        return null;
      }

      // getDir() returns the full project path (installDir + id + /)
      const projectDir = registered.getDir().replace(/\/+$/, '');

      return {
        name: projectName,
        projectDir,
        system: config.system ?? 'System1',
        host: config.host ?? 'localhost',
        port: config.port ?? 4999,
        version,
        installDir,
      };
    } catch {
      return null;
    }
  }

  private waitForPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + ADAPTER_READY_TIMEOUT_MS;

      const attempt = () => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() >= deadline) {
            reject(
              new Error(
                `Debug adapter did not start within ${ADAPTER_READY_TIMEOUT_MS / 1000}s (port ${port})`,
              ),
            );
          } else {
            setTimeout(attempt, ADAPTER_READY_POLL_MS);
          }
        });
      };

      attempt();
    });
  }
}
