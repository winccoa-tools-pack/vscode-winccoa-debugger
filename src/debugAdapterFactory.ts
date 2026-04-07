/**
 * WinCCDebugAdapterDescriptorFactory
 *
 * Connects VS Code to the WinCC OA debug adapter TCP server.
 *
 * The adapter process is started and managed by WinCC OA pmon as a `node`
 * manager entry in the project's progs file.  The adapter listens on a fixed
 * TCP port (default 7474) and VS Code connects via DebugAdapterServer.
 *
 * The launch configuration must contain `adapterPort: <number>` — this is
 * populated by WinccoaProjectLifecycle (tests) or the extension's launch
 * provider (production).
 */

import * as net from 'net';
import * as vscode from 'vscode';

/** Milliseconds to wait for the adapter's TCP server to become available. */
const ADAPTER_READY_TIMEOUT_MS = 15_000;
/** Polling interval while waiting for the TCP server. */
const ADAPTER_READY_POLL_MS = 100;

export class WinCCDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable
{
  constructor(_context: vscode.ExtensionContext) {
    // Adapter lifecycle is managed by pmon — nothing to subscribe to.
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

    const port = config.adapterPort;
    if (!port) {
      throw new Error(
        'WinCC OA debug adapter: adapterPort is required in launch configuration.\n' +
        'The adapter must be started as a pmon-managed node manager before debugging.',
      );
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
