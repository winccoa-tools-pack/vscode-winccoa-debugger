/**
 * @fileoverview Utilities for integrating with other VS Code extensions.
 *
 * This module provides functions for safely handling dependent extensions,
 * particularly the WinCC OA Project Admin core extension. It includes
 * activation waiting, event subscription, and cleanup management.
 */

import * as vscode from 'vscode';
import { ExtensionOutputChannel } from './extensionOutput';
import { EXTENSION_CONFIG_SECTION, CORE_EXTENSION_ID } from './const';

/**
 * Interface representing a WinCC OA project.
 *
 * This matches the project structure provided by the WinCC OA Project Admin extension.
 * Used when subscribing to project change events.
 */
export interface ProjectInfo {
    /** The display name of the project */
    name: string;
    /** The installation path of WinCC OA for this project */
    oaInstallPath: string;
}

/**
 * Promise that prevents concurrent setup of core extension integration.
 * Used to avoid race conditions during initialization.
 */
let coreIntegrationSetupInFlight: Promise<void> | undefined;

/**
 * Unsubscribe function for the project change event listener.
 * Stored to allow cleanup on deactivation or reconfiguration.
 */
let coreProjectChangeUnsubscribe: (() => void) | undefined;

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
export async function setupCoreExtensionIntegration(
    context: vscode.ExtensionContext,
): Promise<void> {
    if (coreIntegrationSetupInFlight) {
        return coreIntegrationSetupInFlight;
    }

    coreIntegrationSetupInFlight = (async () => {
        const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
        const pathSource = config.get<string>('pathSource', 'automatic');

        if (pathSource !== 'automatic') {
            ExtensionOutputChannel.info(
                'CoreIntegration',
                'Static mode - Core extension integration disabled',
            );
            if (coreProjectChangeUnsubscribe) {
                coreProjectChangeUnsubscribe();
                coreProjectChangeUnsubscribe = undefined;
            }
            return;
        }

        const coreExtension = vscode.extensions.getExtension(CORE_EXTENSION_ID);

        if (!coreExtension) {
            ExtensionOutputChannel.warn(
                'CoreIntegration',
                'WinCC OA Core extension not found - automatic mode unavailable',
            );
            return;
        }

        // Core extension is typically activated via its own activationEvents (e.g. onStartupFinished).
        // Explicitly calling activate() here can race and cause the Core to initialize twice.
        if (!coreExtension.isActive) {
            ExtensionOutputChannel.info(
                'CoreIntegration',
                'Waiting for Core extension to activate...',
            );
            const becameActive = await waitForExtensionActive(coreExtension, 4000);
            if (!becameActive) {
                // Fallback: if it still isn't active, try activating once.
                ExtensionOutputChannel.info(
                    'CoreIntegration',
                    'Core still inactive - activating (fallback)...',
                );
                await coreExtension.activate();
            }
        }

        ExtensionOutputChannel.info('CoreIntegration', 'Core extension active');

        const coreApi = coreExtension.exports;
        if (!coreApi) {
            ExtensionOutputChannel.warn('CoreIntegration', 'Core extension has no exported API');
            return;
        }

        // Avoid stacking multiple listeners if setup runs more than once
        if (coreProjectChangeUnsubscribe) {
            coreProjectChangeUnsubscribe();
            coreProjectChangeUnsubscribe = undefined;
        }

        // Subscribe to project changes
        const maybeUnsubscribe = coreApi.onDidChangeProject((project: ProjectInfo | undefined) => {
            if (project) {
                ExtensionOutputChannel.info(
                    'CoreIntegration',
                    `Project changed: ${project.name} (${project.oaInstallPath})`,
                );
            } else {
                ExtensionOutputChannel.info('CoreIntegration', 'No project selected');
            }
        });

        if (typeof maybeUnsubscribe === 'function') {
            coreProjectChangeUnsubscribe = maybeUnsubscribe;
            context.subscriptions.push({ dispose: maybeUnsubscribe });
        }

        const currentProject = coreApi.getCurrentProject() as ProjectInfo | undefined;
        if (currentProject) {
            ExtensionOutputChannel.info(
                'CoreIntegration',
                `Current project: ${currentProject.name} (${currentProject.oaInstallPath})`,
            );
        } else {
            ExtensionOutputChannel.info('CoreIntegration', 'No project currently selected');
        }
    })().finally(() => {
        coreIntegrationSetupInFlight = undefined;
    });

    return coreIntegrationSetupInFlight;
}

/**
 * Waits for a VS Code extension to become active with a timeout.
 *
 * This utility function is useful when your extension depends on another extension
 * that may not be activated yet. It polls the extension's active state and
 * returns whether it became active within the timeout period.
 *
 * @param extension - The VS Code extension to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise resolving to true if extension became active, false if timeout
 *
 * @example
 * ```typescript
 * const coreExtension = vscode.extensions.getExtension('publisher.extension-id');
 * if (coreExtension && !coreExtension.isActive) {
 *     const becameActive = await waitForExtensionActive(coreExtension, 5000);
 *     if (!becameActive) {
 *         // Handle timeout - maybe show warning or fallback
 *     }
 * }
 * ```
 */
export async function waitForExtensionActive(
    extension: vscode.Extension<unknown>,
    timeoutMs: number,
): Promise<boolean> {
    if (extension.isActive) {
        return true;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (extension.isActive) {
            return true;
        }
    }
    return extension.isActive;
}

/**
 * Cleans up resources related to core extension integration.
 *
 * This function should be called during extension deactivation to properly
 * unsubscribe from event listeners and clean up any resources.
 *
 * @example
 * ```typescript
 * export function deactivate() {
 *     cleanupCoreExtensionIntegration();
 * }
 * ```
 */
export function cleanupCoreExtensionIntegration(): void {
    if (coreProjectChangeUnsubscribe) {
        coreProjectChangeUnsubscribe();
        coreProjectChangeUnsubscribe = undefined;
    }
}

/**
 * Gets the VS Code extension instance for the WinCC OA Project Admin core extension.
 */
export function getCoreExtension(): vscode.Extension<unknown> | undefined {
    return vscode.extensions.getExtension(CORE_EXTENSION_ID);
}

/**
 *  Checks if the core extension is available and active.
 *
 * This is a simple utility function that can be used to conditionally enable
 * features that depend on the core extension. It checks both the presence
 * of the extension and whether it is currently active.
 * @returns True if the core extension is available and active, false otherwise
 */
export function isCoreExtensionAvailable(): boolean {
    const coreExtension = getCoreExtension();
    return !!coreExtension && coreExtension.isActive;
}

/**
 * Gets the exported API of the core extension if available and active.
 *
 * In our case it is API to access current project information and subscribe to project change events.
 * What API means depends on the core extension's implementation,
 * but it typically includes methods for accessing project information and subscribing to events.
 *
 * @returns The core extension's exported API or null if unavailable
 */
export function getCoreApi(): unknown {
    const coreExtension = getCoreExtension();
    if (coreExtension && coreExtension.isActive) {
        return coreExtension.exports;
    }
    return null;
}

/** Waits for the core extension's API to become available with a timeout.
 *
 * This is a convenience function that combines checking for the core extension's
 * presence, waiting for it to activate, and then returning its exported API.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise resolving to the core extension's API or null if unavailable
 */
export async function waitForCoreApi(
    timeoutMs: number,
    coreExtensionOverride?: vscode.Extension<unknown> | null,
): Promise<unknown> {
    const coreExtension =
        coreExtensionOverride === null ? undefined : (coreExtensionOverride ?? getCoreExtension());
    if (!coreExtension) {
        return Promise.resolve(null);
    }

    if (coreExtension.isActive) {
        return Promise.resolve(coreExtension.exports);
    }

    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const interval = setInterval(() => {
            if (coreExtension.isActive) {
                clearInterval(interval);
                resolve(coreExtension.exports);
            } else if (Date.now() >= deadline) {
                clearInterval(interval);
                resolve(null);
            }
        }, 100);
    });
}
