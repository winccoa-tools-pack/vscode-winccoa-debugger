#!/usr/bin/env node
/**
 * unregister-project.js
 *
 * Removes the "runnable" and "sub-proj" fixture projects from pvssInst.conf.
 *
 * Usage (via Makefile):
 *   node scripts/unregister-project.js
 *
 * Only needed if you want to clean up the registration added by register-project.js.
 * Integration tests keep the projects registered by default so they stay visible
 * in the VS Code Project Admin extension after test runs.
 */

'use strict';

const {
    PmonComponent,
    getAvailableWinCCOAVersions,
} = require('@winccoa-tools-pack/npm-winccoa-core');

async function main() {
    const versions = getAvailableWinCCOAVersions();
    if (versions.length === 0) {
        console.error('No WinCC OA installation found. Cannot unregister project.');
        process.exit(1);
    }

    const version = versions[versions.length - 1];
    const pmon = new PmonComponent();
    pmon.setVersion(version);

    const projectNames = process.argv.length > 2
        ? process.argv.slice(2)
        : ['runnable', 'sub-proj'];

    for (const projName of projectNames) {
        console.log(`Unregistering project '${projName}' from pvssInst.conf…`);

        try {
            await pmon.unregisterProject(projName);
            console.log(`  Done. Project '${projName}' removed from pvssInst.conf.`);
        } catch (err) {
            if (err.message && err.message.includes('not registered')) {
                console.log(`  Project '${projName}' was not registered — nothing to do.`);
            } else {
                console.error(`  Unregister failed for '${projName}': ${err.message}`);
                process.exit(1);
            }
        }
    }
}

main();
