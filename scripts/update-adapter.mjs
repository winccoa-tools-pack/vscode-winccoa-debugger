/**
 * update-adapter.mjs
 *
 * Builds debugAdapter.js from a local npm-winccoa-debugger checkout and copies
 * it to resources/debugAdapter.js.
 *
 * Usage:
 *   node scripts/update-adapter.mjs
 *   npm run update:adapter:local
 *
 * The debugger repo is resolved in order:
 *   1. WINCCOA_DEBUGGER_REPO env variable (absolute or relative to this repo root)
 *   2. Sibling path: ../../npm-winccoa-repos/npm-winccoa-debugger  (workspace default)
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const envPath = process.env['WINCCOA_DEBUGGER_REPO'];
const debuggerRepo = envPath
    ? resolve(repoRoot, envPath)
    : resolve(repoRoot, '..', '..', 'npm-winccoa-repos', 'npm-winccoa-debugger');

const src = resolve(debuggerRepo, 'dist', 'debugAdapter.js');
const dst = resolve(repoRoot, 'resources', 'debugAdapter.js');

if (!existsSync(debuggerRepo)) {
    console.error(`❌ Debugger repo not found at: ${debuggerRepo}`);
    console.error('   Set WINCCOA_DEBUGGER_REPO env to override the path.');
    process.exit(1);
}

console.log(`📁 Debugger repo: ${debuggerRepo}`);
console.log('🔨 Building debugAdapter bundle...');
execSync('npm run build:bundle', { cwd: debuggerRepo, stdio: 'inherit' });

if (!existsSync(src)) {
    console.error(`❌ Bundle not found after build: ${src}`);
    process.exit(1);
}

console.log('📋 Copying debugAdapter.js → resources/debugAdapter.js');
copyFileSync(src, dst);
console.log('✅ Done. resources/debugAdapter.js is up to date.');
