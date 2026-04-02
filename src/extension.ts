/**
 * @fileoverview Main extension entry point for WinCC OA VS Code extensions.
 *
 * This file serves as a template/example for building WinCC OA VS Code extensions.
 * It demonstrates:
 * - Basic extension activation and deactivation
 * - Integration with dependent extensions (WinCC OA Project Admin)
 * - Configuration handling
 * - Command registration
 * - Logging setup
 *
 * Key concepts shown:
 * - Extension lifecycle management
 * - Safe dependency handling with activation waiting
 * - Project change event subscription
 * - Configuration change watching
 * - Proper cleanup on deactivation
 *
 * @example
 * ```typescript
 * // Basic extension structure
 * export async function activate(context: vscode.ExtensionContext) {
 *     // Initialize logging
 *     const outputChannel = ExtensionOutputChannel.initialize();
 *     context.subscriptions.push(outputChannel);
 *
 *     // Setup dependent extension integration
 *     await setupCoreExtensionIntegration(context);
 *
 *     // Register commands
 *     const command = vscode.commands.registerCommand('myExtension.command', handler);
 *     context.subscriptions.push(command);
 * }
 *
 * export function deactivate() {
 *     // Cleanup resources
 * }
 * ```
 */

// src/extension.ts
import * as vscode from 'vscode';
import { ExtensionOutputChannel } from './extensionOutput';
import { EXTENSION_CONFIG_SECTION, EXTENSION_ID, EXTENSION_NAME } from './const';
import { setupCoreExtensionIntegration, cleanupCoreExtensionIntegration } from './otherExtensions';

/**
 * Interface representing a WinCC OA project.
 *
 * This matches the project structure provided by the WinCC OA Project Admin extension.
 * Used when subscribing to project change events.
 */

/**
 * Extension activation function - called when VS Code activates the extension.
 *
 * This function sets up the extension's core functionality:
 * 1. Initializes logging infrastructure
 * 2. Sets up integration with dependent extensions
 * 3. Registers configuration watchers
 * 4. Registers commands
 *
 * @param context - VS Code extension context for managing subscriptions and state
 *
 * @example
 * ```typescript
 * // VS Code calls this automatically when the extension activates
 * export async function activate(context: vscode.ExtensionContext) {
 *     // Your setup code here
 * }
 * ```
 */
export async function activate(context: vscode.ExtensionContext) {
    // Initialize output channel
    const outputChannel = ExtensionOutputChannel.initialize();
    context.subscriptions.push(outputChannel);

    ExtensionOutputChannel.info('Extension', `${EXTENSION_NAME} (${EXTENSION_ID}) activated`);
    ExtensionOutputChannel.info('Extension', `Extension Path: ${context.extensionPath}`);
    ExtensionOutputChannel.debug('Extension', `VS Code Version: ${vscode.version}`);

    // Setup Core extension integration if in automatic mode
    await setupCoreExtensionIntegration(context);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.logLevel`)) {
                ExtensionOutputChannel.updateLogLevel();
            }
            if (e.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.pathSource`)) {
                // Re-setup Core integration when mode changes
                void setupCoreExtensionIntegration(context);
            }
        }),
    );

    // Register a simple command
    const disposable = vscode.commands.registerCommand('winccoa.helloWorld', () => {
        vscode.window.showInformationMessage(
            `Hello from WinCC OA VS Code Extension!\n${EXTENSION_NAME}`,
        );
    });

    context.subscriptions.push(disposable);
}

/**
 * Sets up integration with the WinCC OA Project Admin core extension.
 *
 * This function demonstrates best practices for handling dependent extensions:
 * - Checks if the dependent extension is installed
 * - Waits for the dependent extension to activate (with timeout)
 * - Falls back to manual activation if needed
 * - Subscribes to project change events
 * - Handles configuration-based enable/disable
 *
 * The integration supports two modes:
 * - 'automatic': Full integration with project detection
 * - Other values: Static mode (integration disabled)
 *
 * @param context - VS Code extension context for managing subscriptions
 * @returns Promise that resolves when setup is complete
 *
 * @example
 * ```typescript
 * // In your activate function:
 * await setupCoreExtensionIntegration(context);
 *
 * // The extension will now automatically:
 * // - Detect when WinCC OA projects change
 * // - Log project information
 * // - Adapt to the current project context
 * ```
 */

/**
 * Extension deactivation function - called when VS Code deactivates the extension.
 *
 * This function should clean up any resources that were allocated during activation:
 * - Unsubscribe from event listeners
 * - Clear timers/intervals
 * - Close connections
 * - Log deactivation
 *
 * Note: VS Code may call this function at any time, so it should be robust
 * and handle cases where resources may not be initialized.
 *
 * @example
 * ```typescript
 * export function deactivate() {
 *     // Clean up your resources here
 *     ExtensionOutputChannel.info('Extension', 'Extension deactivated');
 * }
 * ```
 */
export function deactivate() {
    ExtensionOutputChannel.info('Extension', `WinCC OA ${EXTENSION_NAME} Extension deactivated`);
    // Clean up core extension integration resources
    cleanupCoreExtensionIntegration();
}
