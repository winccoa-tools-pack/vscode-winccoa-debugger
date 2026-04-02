/**
 * WinCC OA Debugger Extension
 * 
 * VS Code extension that provides debugging support for WinCC OA CTRL scripts.
 */

import * as vscode from 'vscode';
import { WinCCDebugAdapterDescriptorFactory } from './debugAdapterFactory';
import { WinCCConfigurationProvider } from './configurationProvider';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('WinCC OA Debugger');
  outputChannel.appendLine('WinCC OA Debugger extension activated');

  // Register debug adapter factory
  const factory = new WinCCDebugAdapterDescriptorFactory();
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('winccoa', factory)
  );

  // Register configuration provider
  const provider = new WinCCConfigurationProvider();
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('winccoa', provider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.winccoa.debugger.getSystemName', async () => {
      const result = await vscode.window.showInputBox({
        prompt: 'Enter WinCC OA System Name',
        placeHolder: 'System1',
        value: 'System1'
      });
      return result || 'System1';
    })
  );

  outputChannel.appendLine('Debug adapter and configuration provider registered');
}

export function deactivate(): void {
  if (outputChannel) {
    outputChannel.dispose();
  }
}

export function getOutputChannel(): vscode.OutputChannel {
  return outputChannel;
}
