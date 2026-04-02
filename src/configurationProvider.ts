/**
 * WinCCConfigurationProvider
 * 
 * Provides debug configuration for WinCC OA debugging sessions.
 * 
 * Responsibilities:
 * - Resolve debug configurations
 * - Provide initial configurations
 * - Provide dynamic configurations (e.g., from project settings)
 * - Validate configurations before starting debug session
 */

import * as vscode from 'vscode';

export interface WinCCDebugConfiguration extends vscode.DebugConfiguration {
  /** Request type */
  request: 'launch' | 'attach';
  /** WinCC OA system name */
  system: string;
  /** Host where WinCC OA is running */
  host: string;
  /** Port for datapoint connection */
  port: number;
  /** Manager configuration */
  manager: {
    type: 'CTRL' | 'UI' | 'EVENT' | 'ASCII' | 'DEVICE' | 'API' | 'DRIVER';
    number: number;
  };
  /** Path mappings */
  pathMappings?: Record<string, string>;
  /** Enable trace logging */
  trace?: boolean;
}

export class WinCCConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * Provide initial debug configurations
   * 
   * This is called when the user creates a new launch.json file.
   */
  provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        type: 'winccoa',
        request: 'attach',
        name: 'Attach to WinCC OA Manager',
        host: 'localhost',
        port: 4999,
        system: 'System1',
        manager: {
          type: 'CTRL',
          number: 1
        },
        pathMappings: {
          '/opt/WinCC_OA/3.21/scripts': '${workspaceFolder}/scripts'
        }
      }
    ];
  }

  /**
   * Resolve debug configuration before launching
   * 
   * This is called before the debug session starts. Use this to:
   * - Fill in missing values with defaults
   * - Validate configuration
   * - Resolve variables
   */
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // If launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'ctrl') {
        config.type = 'winccoa';
        config.name = 'Attach to WinCC OA';
        config.request = 'attach';
      }
    }

    // Validate required fields
    if (!config.host) {
      config.host = 'localhost';
    }

    if (!config.port) {
      config.port = 4999;
    }

    if (!config.system) {
      return vscode.window.showErrorMessage('Please specify the WinCC OA system name in launch.json').then(_ => {
        return undefined; // abort launch
      });
    }

    if (!config.manager) {
      config.manager = {
        type: 'CTRL',
        number: 1
      };
    }

    // Set default path mappings if not provided
    if (!config.pathMappings) {
      config.pathMappings = {};
    }

    return config;
  }

  /**
   * Resolve debug configuration with substituted variables
   * 
   * This is called after resolveDebugConfiguration.
   * Use this for final validation and transformation.
   */
  resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Final validation
    const winccConfig = config as WinCCDebugConfiguration;

    if (!winccConfig.manager?.type || !winccConfig.manager?.number) {
      vscode.window.showErrorMessage('Invalid manager configuration');
      return undefined;
    }

    return config;
  }
}
