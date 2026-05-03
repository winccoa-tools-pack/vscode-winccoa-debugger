import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(projectRoot, 'src', 'test', 'fixtures');
const destDir = path.join(projectRoot, 'out', 'test', 'fixtures');

if (!fs.existsSync(srcDir)) {
  console.error(`Missing fixtures source directory: ${srcDir}`);
  process.exit(1);
}

fs.rmSync(destDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
fs.mkdirSync(path.dirname(destDir), { recursive: true });
// verbatimSymlinks: preserve symlinks (e.g. javascript/debugAdapter.js → npm adapter)
// filter: skip *.log and pmon.* runtime files that WinCC OA writes into src/
fs.cpSync(srcDir, destDir, {
  recursive: true,
  verbatimSymlinks: true,
  filter: (src) => {
    const base = path.basename(src);
    // Skip WinCC OA runtime log files — WinCC OA recreates them on start
    if (/\.(log|txt)$/.test(base) && base !== 'README.md') return false;
    if (/^pmon\./.test(base)) return false;
    return true;
  },
});

// WinCC OA requires the log/ directory to exist inside each project.
// Ensure it is present even if it was empty or excluded by .gitignore patterns.
const projectsDir = path.join(destDir, 'projects');
if (fs.existsSync(projectsDir)) {
  for (const entry of fs.readdirSync(projectsDir)) {
    const logDir = path.join(projectsDir, entry, 'log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log(`Created log dir: ${logDir}`);
    }
  }
}

console.log(`Copied fixtures: ${srcDir} -> ${destDir}`);
