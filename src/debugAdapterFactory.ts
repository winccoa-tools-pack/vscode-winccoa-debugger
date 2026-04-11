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
import { ManagerLifecycle, ADAPTER_PORT } from './lifecycle';
import { WinccoaProject } from './projectDetector';

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
    };

    const port = config.adapterPort ?? ADAPTER_PORT;

    // Auto-start the adapter if lifecycle management is available
    if (this.lifecycle && this.project) {
      await this.lifecycle.ensureAdapter(this.project);
    }

    await this.waitForPort(port);
    return new vscode.DebugAdapterServer(port, '127.0.0.1');
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
