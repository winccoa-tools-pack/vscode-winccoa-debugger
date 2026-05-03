/**
 * download-adapter.mjs
 *
 * Downloads debugAdapter.js from the latest npm-winccoa-debugger GitHub release
 * (pre-releases included) and places it in resources/debugAdapter.js.
 *
 * Uses the public GitHub REST API via Node.js built-in fetch() — no gh CLI or
 * authentication required (winccoa-tools-pack/npm-winccoa-debugger is a public repo).
 *
 * Usage:
 *   node scripts/download-adapter.mjs             # always download
 *   node scripts/download-adapter.mjs --skip-if-exists
 *   npm run adapter:fetch
 */

import { createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dst = resolve(repoRoot, 'resources', 'debugAdapter.js');

const DEBUGGER_REPO = 'winccoa-tools-pack/npm-winccoa-debugger';
const GH_API = 'https://api.github.com';

if (process.argv.includes('--skip-if-exists') && existsSync(dst)) {
    console.log('⏭️  resources/debugAdapter.js already exists — skipping download.');
    process.exit(0);
}

// Find the most recent release (pre-release included, not draft) that has debugAdapter.js as an asset
let latestTag;
let downloadUrl;
try {
    const res = await fetch(
        `${GH_API}/repos/${DEBUGGER_REPO}/releases?per_page=20`,
        { headers: { 'User-Agent': 'vscode-winccoa-debugger-build', Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
    const releases = await res.json();
    // Sort newest first (API order is not guaranteed)
    releases.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    const match = releases.find(
        (r) => !r.draft && r.assets.some((a) => a.name === 'debugAdapter.js'),
    );
    if (!match) throw new Error('No release with debugAdapter.js asset found (yet)');
    latestTag = match.tag_name;
    downloadUrl = match.assets.find((a) => a.name === 'debugAdapter.js').browser_download_url;
} catch (e) {
    console.error(`❌ Could not find a suitable release in ${DEBUGGER_REPO}: ${e.message}`);
    console.error('   Hint: for a local build use "npm run update:adapter:local" instead.');
    process.exit(1);
}

console.log(`📥 Downloading debugAdapter.js from ${DEBUGGER_REPO}@${latestTag}...`);

try {
    const res = await fetch(downloadUrl, { headers: { 'User-Agent': 'vscode-winccoa-debugger-build' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
} catch (e) {
    console.error(`❌ Failed to download debugAdapter.js from release ${latestTag}: ${e.message}`);
    console.error('   The release may not yet have a debugAdapter.js asset.');
    console.error('   Hint: for a local build use "npm run update:adapter:local" instead.');
    process.exit(1);
}

console.log(`✅ resources/debugAdapter.js downloaded from ${latestTag}`);
