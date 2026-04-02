/**
 * WinCCDebugAdapterDescriptorFactory
 * 
 * Factory that creates debug adapter descriptors for WinCC OA debugging sessions.
 * 
 * Responsibilities:
 * - Create debug adapter for each debug session
 * - Configure adapter communication (inline, server, executable)
 * - Pass configuration to the debug adapter
 */

import * as vscode from 'vscode';
import { WinCCDebugSession } from '@winccoa-tools-pack/winccoa-debug-adapter';

export class WinCCDebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  /**
   * Create debug adapter descriptor
   * 
   * This runs the debug adapter in-process (inline mode) for better performance
   * and easier debugging during development.
   */
  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    // TODO: For production, consider using DebugAdapterExecutable instead
    // to run the adapter in a separate process for better isolation:
    //
    // const command = 'node';
    // const args = [join(__dirname, 'node_modules/@winccoa-tools-pack/winccoa-debug-adapter/dist/cjs/cli.js')];
    // return new vscode.DebugAdapterExecutable(command, args);

    // Inline mode: run adapter in the same process as the extension
    return new vscode.DebugAdapterInlineImplementation(new WinCCDebugSession());
  }
}
