#!/usr/bin/env node
/**
 * register-project.js
 *
 * Registers the "runnable" fixture project in pvssInst.conf so it appears in
 * the WinCC OA Project Admin and can be launched manually via VS Code (F5).
 *
 * Usage (via Makefile):
 *   node scripts/register-project.js
 *
 * The project config is read from out/test/fixtures/projects/runnable/config/config
 * which is populated by `npm run compile` (via scripts/copy-fixtures.mjs).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const {
    PmonComponent,
    getAvailableWinCCOAVersions,
} = require('@winccoa-tools-pack/npm-winccoa-core');

async function main() {
    const projectRoot = path.resolve(__dirname, '..');
    const projPath = path.join(projectRoot, 'out', 'test', 'fixtures', 'projects', 'runnable');
    const configFile = path.join(projPath, 'config', 'config');

    if (!fs.existsSync(configFile)) {
        console.error(
            `Project config not found: ${configFile}\n` +
            `Run 'npm run compile' first to populate out/test/fixtures/.`,
        );
        process.exit(1);
    }

    const versions = getAvailableWinCCOAVersions();
    if (versions.length === 0) {
        console.error('No WinCC OA installation found. Cannot register project.');
        process.exit(1);
    }

    const version = versions[versions.length - 1]; // use latest
    const pmon = new PmonComponent();
    pmon.setVersion(version);

    console.log(`Registering project 'runnable' (WinCC OA ${version})…`);
    console.log(`  Config: ${configFile}`);

    try {
        await pmon.registerProject(configFile, version);
        console.log(`Done. Project 'runnable' is now registered in pvssInst.conf.`);
    } catch (err) {
        if (err.message && err.message.includes('already registered')) {
            console.log(`Project 'runnable' is already registered.`);
        } else {
            console.error(`Registration failed: ${err.message}`);
            process.exit(1);
        }
    }
}

main();
