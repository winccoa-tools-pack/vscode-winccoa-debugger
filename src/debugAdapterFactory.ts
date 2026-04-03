/**
 * WinCCDebugAdapterDescriptorFactory
 *
 * Factory that creates debug adapter descriptors for WinCC OA debugging sessions.
 *
 * The adapter is started via WinCC OA's bootstrap.js so that the native
 * ConnectionBinding is initialised with proper pmon authentication before our
 * TypeScript code runs.  bootstrap.js redirects stdout → stderr, so the DAP
 * stream cannot use stdin/stdout.  Instead the adapter opens a TCP server on a
 * free local port and VS Code connects to it via DebugAdapterServer.
 *
 * The adapter cli.js is resolved in this order:
 *  1. dist/adapter/cli.js  — a symlink created by `make test-local`.
 *  2. winccoa.debugger.adapterCliPath  — VS Code setting for manual override.
 *
 * bootstrap.js path defaults to the WinCC OA 3.21 installation; override via
 * the "winccoa.debugger.bootstrapPath" VS Code setting.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

/** Milliseconds to wait for the adapter's TCP server to become available. */
const ADAPTER_READY_TIMEOUT_MS = 15_000;
/** Polling interval while waiting for the TCP server. */
const ADAPTER_READY_POLL_MS = 100;

export class WinCCDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable
{
  /** Active adapter processes keyed by debug session ID. */
  private readonly children = new Map<string, cp.ChildProcess>();

  constructor(context: vscode.ExtensionContext) {
    // Kill the adapter process as soon as VS Code terminates the debug session.
    context.subscriptions.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        this.killChild(session.id);
      }),
    );
  }

  dispose(): void {
    // Kill all remaining adapters when the extension deactivates.
    for (const id of [...this.children.keys()]) {
      this.killChild(id);
    }
  }

  private killChild(sessionId: string): void {
    const child = this.children.get(sessionId);
    if (!child) { return; }
    this.children.delete(sessionId);
    if (!child.killed) {
      child.kill();
    }
  }

  async createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined,
  ): Promise<vscode.DebugAdapterDescriptor> {
    const adapterCliPath = this.resolveAdapterCli();
    const bootstrapPath = this.resolveBootstrap();
    const tcpPort = await this.findFreePort();

    const config = session.configuration as {
      project?: string;
      system?: string;
    };

    const spawnArgs = [
      bootstrapPath,
      '-PROJ', config.project || config.system || 'DevEnv3.21',
      '-pmonIndex', '99',
      adapterCliPath,
      '--tcp-port', String(tcpPort),
      '--system', config.system || 'System1',
    ];

    const child = cp.spawn(process.execPath, spawnArgs, {
      detached: false,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    // Track so we can kill it when the session ends.
    this.children.set(session.id, child);

    child.on('error', (err) => {
      void vscode.window.showErrorMessage(
        `WinCC OA debug adapter failed to start: ${err.message}`,
      );
    });

    child.on('exit', () => {
      this.children.delete(session.id);
    });

    await this.waitForPort(tcpPort);

    return new vscode.DebugAdapterServer(tcpPort, '127.0.0.1');
  }

  private resolveAdapterCli(): string {
    // 1. Bundled / symlinked adapter (created by make test-local)
    const bundled = path.join(__dirname, 'adapter', 'cli.js');
    if (fs.existsSync(bundled)) {
      return bundled;
    }

    // 2. Developer override via VS Code setting
    const configured = vscode.workspace
      .getConfiguration('winccoa.debugger')
      .get<string>('adapterCliPath');
    if (configured && fs.existsSync(configured)) {
      return configured;
    }

    throw new Error(
      'WinCC OA debug adapter not found.\n\n' +
        'Either run `make test-local` to set up the dev environment, ' +
        'or set "winccoa.debugger.adapterCliPath" in your VS Code settings ' +
        'to the absolute path of the adapter cli.js file.',
    );
  }

  private resolveBootstrap(): string {
    const configured = vscode.workspace
      .getConfiguration('winccoa.debugger')
      .get<string>('bootstrapPath');
    if (configured) {
      return configured;
    }
    return '/opt/WinCC_OA/3.21/javascript/winccoa-manager/lib/bootstrap.js';
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Could not determine free port'));
          return;
        }
        const port = address.port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
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
