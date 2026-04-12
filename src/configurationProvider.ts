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
import * as path from 'path';
import { WinccoaProject } from './projectDetector';
import { ADAPTER_PORT } from './lifecycle';

/** Default manager number used for quick-debug script sessions */
const DEFAULT_SCRIPT_MANAGER_NUM = 98;

export interface WinCCDebugConfiguration extends vscode.DebugConfiguration {
  /** Request type */
  request: 'launch' | 'attach';
  /**
   * Path to the CTRL script to debug.
   * When set (request=launch), a temporary WCCOActrl manager is started
   * automatically and removed when the debug session ends.
   */
  script?: string;
  /** Manager number (-num) for the auto-started script manager (default: 98) */
  scriptManagerNum?: number;
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
   * Called when the user creates a new launch.json **and** when the
   * "Run and Debug" dropdown is populated (dynamic configurations).
   */
  provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    const p = this.activeProject;
    return [
      {
        type: 'winccoa',
        request: 'launch',
        name: 'Debug CTRL Script',
        script: '${file}',
        scriptManagerNum: DEFAULT_SCRIPT_MANAGER_NUM,
      },
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
        pathMappings: {
          '${workspaceFolder}/scripts': ''
        }
      }
    ];
  }

  /**
   * Resolve debug configuration before launching
   *
   * When called with an empty config (no launch.json), auto-creates a
   * "quick debug" launch config for the active .ctl file.
   */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // ── Quick Debug: no launch.json or empty config ──────────────────────────
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'ctrl') {
        vscode.window.showErrorMessage(
          'Cannot start quick debug: open a .ctl file first.',
        );
        return undefined;
      }

      config.type = 'winccoa';
      config.request = 'launch';
      config.name = 'Debug CTRL Script';
      config.script = editor.document.uri.fsPath;
      config.scriptManagerNum = DEFAULT_SCRIPT_MANAGER_NUM;
    }

    // ── Resolve script path for launch requests ──────────────────────────────
    if (config.request === 'launch' && config.script) {
      const p = this.activeProject;

      // Derive the WinCC OA-relative script path from the absolute file path.
      // e.g.  /opt/projects/DevEnv/scripts/test.ctl  →  test.ctl
      // The project's scripts dir is <projectDir>/scripts/
      if (p && path.isAbsolute(config.script)) {
        const scriptsDir = path.join(p.projectDir, 'scripts') + path.sep;
        if (config.script.startsWith(scriptsDir)) {
          config._absoluteScriptPath = config.script;
          config.script = config.script.slice(scriptsDir.length);
        }
      }

      // Set manager to the script manager number so the adapter attaches
      // to the right debug DPE (_CtrlDebug_CTRL_<num>)
      if (!config.scriptManagerNum) {
        config.scriptManagerNum = DEFAULT_SCRIPT_MANAGER_NUM;
      }
      config.manager = {
        type: 'CTRL',
        number: config.scriptManagerNum,
      };

      // The script manager is started with -dbg CTRL_DEBUGBREAK, which pauses
      // the script at entry.  stopOnEntry tells the adapter to NOT resume with
      // "cont" after connecting — otherwise the script runs through and exits
      // before breakpoints can be set.
      if (config.stopOnEntry === undefined) {
        config.stopOnEntry = true;
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

    // Inject project name so the adapter can log and resolve it correctly
    if (!config.project && p) {
      config.project = p.name;
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

    // Auto-inject adapterPort so the debug adapter factory knows where to connect
    if (!config.adapterPort) {
      config.adapterPort = ADAPTER_PORT;
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
