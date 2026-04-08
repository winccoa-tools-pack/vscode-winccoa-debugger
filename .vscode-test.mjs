import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    coverage: {
        // Exclude test sources from coverage reports. This keeps the coverage
        // signal focused on the shipped extension code.
        exclude: ['**/test/**', '**\\test\\**']
    },
    tests: [
        {
            label: 'unitTests',
            files: 'out/test/unit/index.js',
            version: 'stable',
            // unit tests usually don’t need a workspace
            mocha: {
                ui: 'tdd',
                timeout: 5000
            }
        },
        {
            label: 'integrationTests',
            files: 'out/test/integration/vscode-integration.test.js',
            version: 'stable',
            // integration tests usually run with a workspace open
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 30000
            }
        },
        {
            // Full E2E debugger tests: real WCCOActrl + WinCC OA project required.
            // Skip gracefully via WINCCOA_E2E_SKIP=1 or absence of WCCOActrl.
            label: 'debuggerE2eTests',
            files: 'out/test/integration/debugger-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 60000
            }
        },
        {
            // Foundation setup test — must pass before any feature test.
            // workspaceFolder points to the compiled fixture project so VS Code
            // Explorer shows scripts/, config/ etc. during the test run.
            label: 'debuggerSetupE2e',
            files: 'out/test/integration/debugger-setup-e2e.test.js',
            version: 'stable',
            workspaceFolder: './out/test/fixtures/projects/runnable',
            mocha: {
                ui: 'tdd',
                timeout: 180000
            }
        },
        {
            // E2E breakpoint-cycle tests: vscode-dbg fixture project, manager 91.
            label: 'debuggerBpCycleE2e',
            files: 'out/test/integration/debugger-bp-cycle-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        },
        {
            // E2E step-commands tests: vscode-dbg fixture project, manager 92.
            label: 'debuggerStepCommandsE2e',
            files: 'out/test/integration/debugger-step-commands-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        },
        {
            // E2E library-breakpoint tests: vscode-dbg fixture project, manager 93.
            label: 'debuggerLibraryBpE2e',
            files: 'out/test/integration/debugger-library-bp-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        },
        {
            // E2E stop-on-entry tests: vscode-dbg fixture project, manager 94 (manual).
            label: 'debuggerStopOnEntryE2e',
            files: 'out/test/integration/debugger-stop-on-entry-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        },
        {
            // E2E spurious-stops regression: context requests must not trigger extra StoppedEvents.
            label: 'debuggerSpuriousStopsE2e',
            files: 'out/test/integration/debugger-spurious-stops-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        },
        {
            // E2E race-condition regression: concurrent setBreakpoints must not duplicate BPs.
            label: 'debuggerRaceConditionE2e',
            files: 'out/test/integration/debugger-race-condition-e2e.test.js',
            version: 'stable',
            workspaceFolder: './test-workspace',
            mocha: {
                ui: 'tdd',
                timeout: 90000
            }
        }
    ]
});
