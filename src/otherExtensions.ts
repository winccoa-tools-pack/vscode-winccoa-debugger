/**
 * @fileoverview Utilities for integrating with other VS Code extensions.
 *
 * This module provides functions for safely handling dependent extensions,
 * particularly the WinCC OA Project Admin core extension. It includes
 * activation waiting, event subscription, and cleanup management.
 */

import * as vscode from 'vscode';
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
 * @param context - VS Code extension context for managing subscriptions
 * @returns Promise that resolves when setup is complete
 */
export async function setupCoreExtensionIntegration(
    context: vscode.ExtensionContext,
): Promise<void> {
    if (coreIntegrationSetupInFlight) {
        return coreIntegrationSetupInFlight;
    }

    coreIntegrationSetupInFlight = (async () => {
        // EXTENSION_CONFIG_SECTION is available for potential future config-gating
        void EXTENSION_CONFIG_SECTION;

        const coreExtension = vscode.extensions.getExtension(CORE_EXTENSION_ID);

        if (!coreExtension) {
            return;
        }

        if (!coreExtension.isActive) {
            const becameActive = await waitForExtensionActive(coreExtension, 4000);
            if (!becameActive) {
                await coreExtension.activate();
            }
        }

        const coreApi = coreExtension.exports;
        if (!coreApi) {
            return;
        }

        // Avoid stacking multiple listeners if setup runs more than once
        if (coreProjectChangeUnsubscribe) {
            coreProjectChangeUnsubscribe();
            coreProjectChangeUnsubscribe = undefined;
        }

        const maybeUnsubscribe = coreApi.onDidChangeProject((_project: ProjectInfo | undefined) => {
            // Intentional no-op: callers may override via their own subscriptions.
        });

        if (typeof maybeUnsubscribe === 'function') {
            coreProjectChangeUnsubscribe = maybeUnsubscribe;
            context.subscriptions.push({ dispose: maybeUnsubscribe });
        }
    })().finally(() => {
        coreIntegrationSetupInFlight = undefined;
    });

    return coreIntegrationSetupInFlight;
}

/**
 * Waits for a VS Code extension to become active with a timeout.
 *
 * @param extension - The VS Code extension to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise resolving to true if extension became active, false if timeout
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
 * Checks if the core extension is available and active.
 *
 * @returns True if the core extension is available and active, false otherwise
 */
export function isCoreExtensionAvailable(): boolean {
    const coreExtension = getCoreExtension();
    return !!coreExtension && coreExtension.isActive;
}

/**
 * Gets the exported API of the core extension if available and active.
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

/**
 * Waits for the core extension's API to become available with a timeout.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param coreExtensionOverride - Optional override for the core extension (null = no extension)
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
