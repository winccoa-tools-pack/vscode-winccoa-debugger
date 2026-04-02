/**
 * @fileoverview Global constants for the WinCC OA VS Code extension.
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
 *
 * @example 'winccoa.my-extension'
 */
export const EXTENSION_ID = 'winccoa.yourExtensionId';

/**
 * The human-readable display name of the extension.
 *
 * This name appears in the VS Code UI, extension list, and marketplace.
 * It should be descriptive and follow the WinCC OA naming convention.
 *
 * @example 'WinCC OA My Extension'
 */
export const EXTENSION_NAME = 'WinCC OA Your Extension Name';

/**
 * The configuration section name for this extension's settings.
 *
 * This namespace is used for all VS Code workspace/extension settings.
 * Settings are accessed via `vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION)`.
 *
 * @example 'winccoaMyExtension'
 */
export const EXTENSION_CONFIG_SECTION = 'winccoaTemplateExtension';

/**
 * The extension ID of the WinCC OA Project Admin core extension.
 *
 * This extension provides project management and WinCC OA integration.
 * Used for dependency checking and API access.
 */
export const CORE_EXTENSION_ID = 'RichardJanisch.winccoa-project-admin';
