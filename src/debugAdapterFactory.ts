/**
 * WinCCDebugAdapterDescriptorFactory
 *
 * Factory that creates debug adapter descriptors for WinCC OA debugging sessions.
 *
 * The debug adapter (cli.js) is resolved in this order:
 *  1. dist/adapter/cli.js  — a symlink created by `make test-local` pointing to
 *     the adapter package's dist/cjs/ directory (local-dev workflow).
 *  2. winccoa.debugger.adapterCliPath  — VS Code setting for manual override.
 *
 * The adapter is spawned as a child process with --stdio so VS Code communicates
 * with it over stdin/stdout using the Debug Adapter Protocol.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class WinCCDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const adapterCliPath = this.resolveAdapterCli();
    return new vscode.DebugAdapterExecutable(process.execPath, [adapterCliPath, '--stdio']);
  }

  private resolveAdapterCli(): string {
    // 1. Bundled / symlinked adapter (created by make test-local)
    //    __dirname is the dist/ folder of the installed extension.
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
}
