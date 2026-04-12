/**
 * AdapterDeployer
 *
 * Copies the bundled debug adapter (resources/debugAdapter.js) from the extension
 * into the active WinCC OA project's javascript/debugAdapter/ directory so that
 * pmon can start it as a `node` manager with startOptions `debugAdapter/debugAdapter.js`.
 *
 * The deployed file is <projectDir>/javascript/debugAdapter/debugAdapter.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** File name of the bundled adapter */
const ADAPTER_FILENAME = 'debugAdapter.js';
/** Subdirectory inside the project's javascript/ folder */
const ADAPTER_SUBDIR = 'debugAdapter';

export class AdapterDeployer {
    private readonly bundlePath: string;

    constructor(extensionContextOrPath: vscode.ExtensionContext | string) {
        const extensionPath = typeof extensionContextOrPath === 'string'
            ? extensionContextOrPath
            : extensionContextOrPath.extensionPath;
        this.bundlePath = path.join(extensionPath, 'resources', ADAPTER_FILENAME);
    }

    /**
     * Ensure the adapter JS file exists in the project's javascript/ directory.
     * Copies or overwrites only when the source is newer or the target is missing.
     *
     * @returns Absolute path to the deployed debugAdapter.js
     */
    async deploy(projectDir: string): Promise<string> {
        const targetDir = path.join(projectDir, 'javascript', ADAPTER_SUBDIR);
        const targetPath = path.join(targetDir, ADAPTER_FILENAME);

        if (!fs.existsSync(this.bundlePath)) {
            throw new Error(
                `Bundled debug adapter not found at ${this.bundlePath}. ` +
                    'Rebuild the extension with "npm run compile".',
            );
        }

        // Ensure the javascript/debugAdapter/ directory exists
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Never overwrite symlinks (used by test fixtures pointing to un-bundled sources)
        try {
            const isSymlink = fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink();
            if (isSymlink) {
                return targetPath;
            }
        } catch {
            // lstatSync can fail on some platforms with restricted permissions — treat as non-symlink
        }

        // Copy if target missing or source is newer
        const needsCopy = !fs.existsSync(targetPath) || this.isSourceNewer(targetPath);
        if (needsCopy) {
            fs.copyFileSync(this.bundlePath, targetPath);
        }

        return targetPath;
    }

    /**
     * Check if the adapter is already deployed in the project.
     */
    isDeployed(projectDir: string): boolean {
        return fs.existsSync(path.join(projectDir, 'javascript', ADAPTER_SUBDIR, ADAPTER_FILENAME));
    }

    private isSourceNewer(targetPath: string): boolean {
        try {
            const srcStat = fs.statSync(this.bundlePath);
            const dstStat = fs.statSync(targetPath);
            return srcStat.mtimeMs > dstStat.mtimeMs;
        } catch {
            return true;
        }
    }
}
