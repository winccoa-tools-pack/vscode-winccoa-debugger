import * as assert from 'assert';
import * as vscode from 'vscode';

import {
    cleanupCoreExtensionIntegration,
    getCoreApi,
    getCoreExtension,
    isCoreExtensionAvailable,
    setupCoreExtensionIntegration,
    waitForExtensionActive,
    waitForCoreApi,
} from '../../otherExtensions';
import { CORE_EXTENSION_ID } from '../../const';

suite('otherExtensions Unit Tests', () => {
    suiteTeardown(() => {
        // Ensure test isolation even if setupCoreExtensionIntegration ran.
        cleanupCoreExtensionIntegration();
    });

    test('getCoreExtension returns same value as vscode.extensions.getExtension', () => {
        const expected = vscode.extensions.getExtension(CORE_EXTENSION_ID);
        const actual = getCoreExtension();
        // VS Code may return a new wrapper object per call, so don't assert reference equality.
        assert.strictEqual(actual?.id, expected?.id);
    });

    test('getCoreApi is null whenever core extension is not available+active', () => {
        if (!isCoreExtensionAvailable()) {
            assert.strictEqual(getCoreApi(), null);
        } else {
            assert.notStrictEqual(getCoreApi(), null);
        }
    });

    test('cleanupCoreExtensionIntegration is safe to call repeatedly', () => {
        cleanupCoreExtensionIntegration();
        cleanupCoreExtensionIntegration();
        assert.ok(true);
    });

    test('setupCoreExtensionIntegration does not throw with a minimal context', async () => {
        const context = {
            subscriptions: [] as vscode.Disposable[],
        } as unknown as vscode.ExtensionContext;
        await setupCoreExtensionIntegration(context);
        assert.ok(true);
    });

    test('waitForExtensionActive returns true when already active', async () => {
        const fakeExt = { isActive: true } as unknown as vscode.Extension<unknown>;
        const becameActive = await waitForExtensionActive(fakeExt, 10);
        assert.strictEqual(becameActive, true);
    });

    test('waitForExtensionActive returns true when it becomes active within timeout', async () => {
        const fakeExt = { isActive: false } as unknown as vscode.Extension<unknown>;

        setTimeout(() => {
            (fakeExt as unknown as { isActive: boolean }).isActive = true;
        }, 150);

        const becameActive = await waitForExtensionActive(fakeExt, 1500);
        assert.strictEqual(becameActive, true);
    });

    test('waitForExtensionActive returns false when it does not become active within timeout', async () => {
        const fakeExt = { isActive: false } as unknown as vscode.Extension<unknown>;
        const becameActive = await waitForExtensionActive(fakeExt, 250);
        assert.strictEqual(becameActive, false);
    });

    test('waitForCoreApi returns null when core extension is missing (override)', async () => {
        const api = await waitForCoreApi(50, null);
        assert.strictEqual(api, null);
    });

    test('waitForCoreApi returns exports immediately when already active (override)', async () => {
        const fakeApi = { hello: 'world' };
        const fakeExt = {
            isActive: true,
            exports: fakeApi,
        } as unknown as vscode.Extension<unknown>;

        const api = await waitForCoreApi(50, fakeExt);
        assert.strictEqual(api, fakeApi);
    });

    test('waitForCoreApi returns exports when it becomes active within timeout (override)', async () => {
        const fakeApi = { ok: true };
        const fakeExtObj = {
            isActive: false,
            exports: fakeApi,
        };
        const fakeExt = fakeExtObj as unknown as vscode.Extension<unknown>;

        setTimeout(() => {
            fakeExtObj.isActive = true;
        }, 150);

        const api = await waitForCoreApi(1500, fakeExt);
        assert.strictEqual(api, fakeApi);
    });

    test('waitForCoreApi returns null when it does not become active within timeout (override)', async () => {
        const fakeExt = {
            isActive: false,
            exports: { shouldNot: 'matter' },
        } as unknown as vscode.Extension<unknown>;

        const api = await waitForCoreApi(250, fakeExt);
        assert.strictEqual(api, null);
    });
});
