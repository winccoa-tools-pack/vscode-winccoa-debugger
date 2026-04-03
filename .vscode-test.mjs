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
        }
    ]
});
