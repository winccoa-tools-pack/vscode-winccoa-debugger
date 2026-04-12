#!/usr/bin/env node
/**
 * Setup script for E2E tests running via vscode-test (without make test-local).
 *
 * Creates the same symlinks that make test-local creates in the installed extension,
 * but for the local dist/ directory used by vscode-test:
 *
 *   dist/adapter/  →  <npm-winccoa-debugger>/dist/cjs/  (resolved via npm link)
 *
 * This mirrors the DevEnv3.21 pattern where javascript/debugAdapter.js is a symlink
 * to the npm-winccoa-debugger package, ensuring the latest compiled adapter is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// dist/adapter/ → npm-winccoa-debugger/dist/cjs/
const adapterLinkDir = path.join(projectRoot, 'dist', 'adapter');

// Resolve the adapter source directory dynamically via the npm-linked package
// instead of relying on a hardcoded relative path that varies across OS/layouts.
let adapterSrcDir;
try {
  const pkgDir = fs.realpathSync(path.resolve(projectRoot, 'node_modules', '@winccoa-tools-pack', 'winccoa-debug-adapter'));
  adapterSrcDir = path.join(pkgDir, 'dist', 'cjs');
} catch {
  adapterSrcDir = null;
}

if (!adapterSrcDir || !fs.existsSync(adapterSrcDir)) {
  console.error(
    `ERROR: Adapter source not found.\n` +
      `  Ensure @winccoa-tools-pack/winccoa-debug-adapter is npm-linked and built:\n` +
      `    cd <npm-winccoa-debugger> && npm run build\n` +
      `    cd <vscode-winccoa-debugger> && npm link @winccoa-tools-pack/winccoa-debug-adapter`,
  );
  process.exit(1);
}

const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(adapterLinkDir)) {
  fs.rmSync(adapterLinkDir, { recursive: true, force: true });
}

fs.symlinkSync(adapterSrcDir, adapterLinkDir, process.platform === 'win32' ? 'junction' : 'dir');
console.log(`Linked: ${adapterLinkDir} -> ${adapterSrcDir}`);
