/**
 * download-adapter.mjs
 *
 * Downloads debugAdapter.js from the latest npm-winccoa-debugger GitHub release
 * (pre-releases included) and places it in resources/debugAdapter.js.
 *
 * Requires the `gh` CLI to be installed and authenticated.
 * In GitHub Actions this works automatically via GITHUB_TOKEN.
 *
 * Usage:
 *   node scripts/download-adapter.mjs             # always download
 *   node scripts/download-adapter.mjs --skip-if-exists
 *   npm run adapter:fetch
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dst = resolve(repoRoot, 'resources', 'debugAdapter.js');

const DEBUGGER_REPO = 'winccoa-tools-pack/npm-winccoa-debugger';

if (process.argv.includes('--skip-if-exists') && existsSync(dst)) {
    console.log('⏭️  resources/debugAdapter.js already exists — skipping download.');
    process.exit(0);
}

// Find the most recent release (pre-release included, not draft) that has debugAdapter.js as an asset
let latestTag;
try {
    const raw = execSync(
        `gh api repos/${DEBUGGER_REPO}/releases?per_page=20`,
        { encoding: 'utf8' },
    );
    const releases = JSON.parse(raw);
    const match = releases.find(
        (r) => !r.draft && r.assets.some((a) => a.name === 'debugAdapter.js'),
    );
    if (!match) throw new Error('No release with debugAdapter.js asset found (yet)');
    latestTag = match.tag_name;
} catch (e) {
    console.error(`❌ Could not find a suitable release in ${DEBUGGER_REPO}: ${e.message}`);
    console.error('   Make sure the gh CLI is installed and you are authenticated.');
    console.error('   Hint: for a local build use "npm run update:adapter:local" instead.');
    process.exit(1);
}

console.log(`📥 Downloading debugAdapter.js from ${DEBUGGER_REPO}@${latestTag}...`);

try {
    execSync(
        `gh release download ${latestTag} --repo ${DEBUGGER_REPO} --pattern "debugAdapter.js" --dir resources --clobber`,
        { cwd: repoRoot, stdio: 'inherit' },
    );
} catch {
    console.error(`❌ Failed to download debugAdapter.js from release ${latestTag}`);
    console.error('   The release may not yet have a debugAdapter.js asset.');
    console.error('   Hint: for a local build use "npm run update:adapter:local" instead.');
    process.exit(1);
}

console.log(`✅ resources/debugAdapter.js downloaded from ${latestTag}`);
