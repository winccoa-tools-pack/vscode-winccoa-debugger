#!/usr/bin/env node
/**
 * Setup script for E2E tests running via vscode-test (without make test-local).
 *
 * Creates the same symlinks that make test-local creates in the installed extension,
 * but for the local dist/ directory used by vscode-test:
 *
 *   dist/adapter/  →  ../../npm-winccoa-repos/npm-winccoa-debugger/dist/cjs/
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
const adapterSrcDir = path.resolve(
  projectRoot,
  '..',
  '..',
  'npm-winccoa-repos',
  'npm-winccoa-debugger',
  'dist',
  'cjs',
);

if (!fs.existsSync(adapterSrcDir)) {
  console.error(
    `ERROR: Adapter source not found at ${adapterSrcDir}.\n` +
      `  Run: (cd ${path.resolve(projectRoot, '..', '..', 'npm-winccoa-repos', 'npm-winccoa-debugger')} && npm run build)\n` +
      `  Then re-run the E2E tests.`,
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

fs.symlinkSync(adapterSrcDir, adapterLinkDir, 'dir');
console.log(`Linked: ${adapterLinkDir} -> ${adapterSrcDir}`);
