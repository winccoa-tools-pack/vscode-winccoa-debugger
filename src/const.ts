/**
 * @fileoverview Global constants for the WinCC OA Debugger VS Code extension.
 *
 * This file contains all extension-wide constants that are used across
 * different modules. These constants define the extension's identity,
 * configuration namespace, and other immutable values.
 */

/**
 * The unique identifier for this VS Code extension.
 *
 * This ID must match the publisher.name format in package.json and is used
 * for extension registration, command contributions, and VS Code marketplace identification.
 */
export const EXTENSION_ID = 'winccoa-tools-pack.vscode-winccoa-debugger';

/**
 * The human-readable display name of the extension.
 */
export const EXTENSION_NAME = 'WinCC OA — Debugger';

/**
 * The configuration section name for this extension's settings.
 *
 * Settings are accessed via `vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION)`.
 */
export const EXTENSION_CONFIG_SECTION = 'winccoa.debugger';

/**
 * The extension ID of the WinCC OA Project Admin core extension.
 *
 * This extension provides project management and WinCC OA integration.
 * Used for dependency checking and API access.
 */
export const CORE_EXTENSION_ID = 'RichardJanisch.winccoa-project-admin';
