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
import { WinccoaProject } from './projectDetector';

export interface WinCCDebugConfiguration extends vscode.DebugConfiguration {
  /** Request type */
  request: 'launch' | 'attach';
  /**
   * WinCC OA project name — passed as `-proj <project>` when the adapter connects.
   * Typically the project directory base name, e.g. `DevEnv3.21`.
   * When omitted, `system` is used as fallback.
   */
  project?: string;
  /** WinCC OA system name (used as DP prefix, e.g. `System1:`) */
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
  /** Inject the current project so configurations can be auto-filled */
  setActiveProject(project: WinccoaProject | null): void {
    this.activeProject = project;
  }

  private activeProject: WinccoaProject | null = null;

  /**
   * Provide initial debug configurations
   *
   * This is called when the user creates a new launch.json file.
   */
  provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    const p = this.activeProject;
    const installDir = p?.installDir ?? '/opt/WinCC_OA/3.21';
    return [
      {
        type: 'winccoa',
        request: 'attach',
        name: 'Attach to WinCC OA Manager',
        host: p?.host ?? 'localhost',
        port: p?.port ?? 4999,
        system: p?.system ?? 'System1',
        manager: {
          type: 'CTRL',
          number: 1
        },
        // Key   = local VS Code absolute path (what breakpoint events carry)
        // Value = WinCC OA remote path (relative to project root, as the CTRL debugger expects)
        pathMappings: {
          '${workspaceFolder}/scripts': 'scripts'
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
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // If launch.json is missing or empty → create a minimal config
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'ctrl') {
        config.type = 'winccoa';
        config.name = 'Attach to WinCC OA';
        config.request = 'attach';
      }
    }

    // Fill in defaults from detected project
    const p = this.activeProject;
    if (!config.host) {
      config.host = p?.host ?? 'localhost';
    }
    if (!config.port) {
      config.port = p?.port ?? 4999;
    }

    if (!config.system) {
      if (p?.system) {
        config.system = p.system;
      } else {
        return vscode.window.showErrorMessage(
          'No WinCC OA project selected. Open Project Admin and select a project first.',
        ).then(() => undefined);
      }
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
