#!/usr/bin/env node
/**
 * Setup script for E2E tests running via vscode-test.
 *
 * Verifies that resources/debugAdapter.js exists (downloaded via npm run adapter:fetch
 * or built locally via npm run update:adapter:local). The adapter is deployed from
 * resources/ into the WinCC OA project by AdapterDeployer at runtime — no symlinks needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const adapterBundle = path.join(projectRoot, 'resources', 'debugAdapter.js');

if (!fs.existsSync(adapterBundle)) {
  console.error(
    `ERROR: resources/debugAdapter.js not found.\n` +
      `  Run one of:\n` +
      `    npm run adapter:fetch          # download from latest GitHub release\n` +
      `    npm run update:adapter:local   # build from sibling npm-winccoa-debugger repo`,
  );
  process.exit(1);
}

console.log(`✅ resources/debugAdapter.js found (${(fs.statSync(adapterBundle).size / 1024).toFixed(0)} KB) — E2E setup complete.`);
