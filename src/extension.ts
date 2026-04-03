/**
 * WinCC OA Debugger Extension
 *
 * VS Code extension that provides debugging support for WinCC OA CTRL scripts.
 *
 * On activation the extension:
 *   1. Detects the active WinCC OA project via Project Admin extension
 *   2. Subscribes to project changes so the debug configuration is always current
 *   3. Registers the WinCC OA debug type (adapter + configuration provider)
 *   4. Shows a status-bar item reflecting the detected project / readiness
 */

import * as vscode from 'vscode';
import { WinCCDebugAdapterDescriptorFactory } from './debugAdapterFactory';
import { WinCCConfigurationProvider } from './configurationProvider';
import { ProjectDetector, ProjectDetectionResult } from './projectDetector';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let projectDetector: ProjectDetector;
let configProvider: WinCCConfigurationProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('WinCC OA Debugger');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('WinCC OA Debugger extension activating...');

    // ── Status bar ────────────────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBarItem.command = 'winccoa.debugger.showStatus';
    context.subscriptions.push(statusBarItem);

    // ── Debug adapter components ──────────────────────────────────────────────
    const factory = new WinCCDebugAdapterDescriptorFactory(context);
    configProvider = new WinCCConfigurationProvider();

    context.subscriptions.push(
        factory,
        vscode.debug.registerDebugAdapterDescriptorFactory('winccoa', factory),
        vscode.debug.registerDebugConfigurationProvider('winccoa', configProvider),
    );

    // ── Project detection ─────────────────────────────────────────────────────
    projectDetector = new ProjectDetector();
    context.subscriptions.push(projectDetector);

    // Initial detection
    const initial = await projectDetector.detectProject();
    applyDetectionResult(initial);

    // Subscribe to future project changes
    await projectDetector.subscribeToProjectChanges();
    context.subscriptions.push(
        projectDetector.onDidChangeProject((result) => {
            applyDetectionResult(result);
        }),
    );

    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('winccoa.debugger.showStatus', showStatus),
        vscode.commands.registerCommand('winccoa.debugger.showOutput', () =>
            outputChannel.show(),
        ),
        // Keep the input variable command for backwards compat with launch.json
        vscode.commands.registerCommand(
            'extension.winccoa.debugger.getSystemName',
            async () => {
                const current = projectDetector.getCachedResult()?.project?.system;
                const result = await vscode.window.showInputBox({
                    prompt: 'Enter WinCC OA System Name',
                    placeHolder: 'System1',
                    value: current ?? 'System1',
                });
                return result ?? current ?? 'System1';
            },
        ),
    );

    outputChannel.appendLine('WinCC OA Debugger extension activated');
}

export function deactivate(): void {
    outputChannel?.dispose();
    statusBarItem?.dispose();
}

export function getOutputChannel(): vscode.OutputChannel {
    return outputChannel;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyDetectionResult(result: ProjectDetectionResult): void {
    const { project, readiness } = result;

    // Update configuration provider so new debug sessions use the current project
    configProvider.setActiveProject(project);

    // Update status bar
    switch (readiness) {
        case 'ready':
            statusBarItem.text = `$(debug) ${project!.name} (${project!.system})`;
            statusBarItem.tooltip = `WinCC OA Debugger ready\nProject: ${project!.projectDir}\nWinCC OA: ${project!.version}`;
            statusBarItem.backgroundColor = undefined;
            statusBarItem.show();
            outputChannel.appendLine(
                `Project detected: ${project!.name} — system=${project!.system} dir=${project!.projectDir}`,
            );
            break;

        case 'no-project':
            statusBarItem.text = `$(debug) No project`;
            statusBarItem.tooltip =
                'No WinCC OA project selected — open Project Admin and select a project';
            statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
            statusBarItem.show();
            outputChannel.appendLine('No WinCC OA project selected');
            break;

        case 'no-project-admin':
            statusBarItem.text = `$(debug) Project Admin missing`;
            statusBarItem.tooltip =
                'WinCC OA Project Admin extension not installed or not active';
            statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
            statusBarItem.show();
            outputChannel.appendLine('Project Admin extension not found');
            break;

        case 'winccoa-not-found':
            statusBarItem.text = `$(error) WinCC OA not found`;
            statusBarItem.tooltip =
                'WinCC OA installation not found on this machine — debug adapter will fail to connect';
            statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.errorBackground',
            );
            statusBarItem.show();
            outputChannel.appendLine('WinCC OA installation not found');
            break;
    }
}

function showStatus(): void {
    const result = projectDetector.getCachedResult();
    if (!result || !result.project) {
        vscode.window.showWarningMessage(
            'No WinCC OA project active. Open Project Admin and select a project, then debugging will auto-configure.',
            'Open Project Admin',
        ).then((sel) => {
            if (sel === 'Open Project Admin') {
                vscode.commands.executeCommand(
                    'workbench.view.extension.winccoa-project-admin',
                );
            }
        });
        return;
    }

    const p = result.project;
    vscode.window.showInformationMessage(
        `WinCC OA Debugger — ${p.name} | system: ${p.system} | ${p.host}:${p.port} | v${p.version}`,
        'Show Output',
    ).then((sel) => {
        if (sel === 'Show Output') {
            outputChannel.show();
        }
    });
}

