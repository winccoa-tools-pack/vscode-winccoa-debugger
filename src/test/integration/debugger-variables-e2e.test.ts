/**
 * debugger-variables-e2e.test.ts
 *
 * VS Code E2E tests for variable display of all WinCC OA CTRL data types.
 *
 * Uses `all_types.ctl` (manager -num 6, once).
 * The script initialises variables of every WinCC OA type to known values,
 * then loops with a 1-second delay.  Tests set a BP at line 55
 * (the DebugN "inspect here"), let the adapter connect, and verify the
 * variable list in the Locals scope shows correct values and, for
 * composite types, enables drill-down (variablesReference > 0).
 *
 * TDD — these tests are the RED baseline.  They will pass after
 * parseVariables() is updated to handle dyn_*, mapping, and anytype.
 *
 * Running locally:
 *   npm run test:e2e:variables
 *
 * all_types.ctl known values at BP_LINE:
 *   int    vi   = 42
 *   uint   vui  = 100
 *   float  vf   = 3.14
 *   double vd   = 2.718
 *   bool   vb   = true
 *   string vs   = "hello"
 *   dyn_int       vdi  = [10, 20, 30]
 *   dyn_string    vds  = ["alpha", "beta", "gamma"]
 *   dyn_float     vdf  = [1.1, 2.2, 3.3]
 *   dyn_bool      vdb  = [true, false, true]
 *   dyn_dyn_int   vddi = [[1,2],[3,4]]
 *   dyn_dyn_string vdds = [["aa","bb"],["cc","dd"]]
 *   mapping vm   = {key1:"value1", num:99}
 *   anytype vany = 42
 */

import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DebugSessionHelper } from '../debugSessionHelper';
import { WinccoaProjectLifecycle } from '../helpers/WinccoaProjectLifecycle';
import { waitForCoreApi } from '../../otherExtensions';

/** Minimal DAP Variable shape returned by helper.request('variables'). */
type DapVariable = {
    name: string;
    value: string;
    variablesReference: number;
    indexedVariables?: number;
    namedVariables?: number;
};

type CoreApi = {
    getRunningProjects?: () => Promise<unknown[]>;
    setCurrentProject?: (id: string) => void | Promise<void>;
};

// ─── constants ───────────────────────────────────────────────────────────────

/** Line of DebugN("all_types: inspect here") — all vars are initialised here */
const BP_LINE = 69;
/** CTRL manager number for all_types.ctl */
const TYPES_MANAGER = 6;

const lifecycle = new WinccoaProjectLifecycle();

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildLaunchConfig(name: string): vscode.DebugConfiguration {
    const base = lifecycle.getBaseLaunchConfig();
    return {
        type: 'winccoa',
        request: 'launch',
        name,
        ...base,
        manager: { type: 'CTRL', number: TYPES_MANAGER },
    };
}

// ─── suite ───────────────────────────────────────────────────────────────────

suite('WinCC OA Debugger — E2E variable display (all_types)', function () {
    this.timeout(90_000);

    let canRun = false;
    let addedBreakpoints: vscode.Breakpoint[] = [];

    suiteSetup(async function () {
        this.timeout(180_000);

        if (!lifecycle.isWinccoaAvailable()) {
            console.log('[variables-e2e] WinCC OA not available — skipping suite');
            return;
        }

        console.log('[variables-e2e] Step 1: Registering and starting fixture project…');
        try {
            await lifecycle.start();
        } catch (err) {
            console.error(`[variables-e2e] Project startup failed: ${(err as Error).message}`);
            return;
        }
        console.log('[variables-e2e] Project started');

        console.log('[variables-e2e] Step 2: Waiting for services to stabilize…');
        await new Promise((r) => setTimeout(r, 3_000));

        console.log('[variables-e2e] Step 3: Opening all_types.ctl in editor…');
        const scriptUri = vscode.Uri.file(lifecycle.getScriptPath('all_types.ctl'));
        const doc = await vscode.workspace.openTextDocument(scriptUri);
        await vscode.window.showTextDocument(doc, { preview: false });

        console.log('[variables-e2e] Step 4: Setting active project in Core extension…');
        try {
            const coreApi = (await waitForCoreApi(15_000)) as CoreApi | null;
            if (coreApi && typeof coreApi.setCurrentProject === 'function') {
                await Promise.resolve(coreApi.setCurrentProject(lifecycle.getProjectName()));
                console.log('[variables-e2e] Active project set to "runnable"');
            }
        } catch (err) {
            console.warn(
                `[variables-e2e] setCurrentProject failed (non-fatal): ${(err as Error).message}`,
            );
        }

        console.log('[variables-e2e] ✓ Setup complete');
        canRun = true;
    });

    suiteTeardown(async function () {
        this.timeout(60_000);
        if (addedBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
        }
        await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
        if (lifecycle.isWinccoaAvailable()) {
            await lifecycle
                .stop()
                .catch((e: Error) => console.error(`[variables-e2e] stop failed: ${e.message}`));
        }
    });

    function addBreakpoint(scriptPath: string, line: number): vscode.Breakpoint {
        const uri = vscode.Uri.file(scriptPath);
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(uri, new vscode.Position(line - 1, 0)),
        );
        addedBreakpoints.push(bp);
        vscode.debug.addBreakpoints([bp]);
        return bp;
    }

    /**
     * Hit the BP in all_types.ctl and return the complete locals variable list.
     * Also logs the raw variable list for discovery/debugging.
     */
    async function hitBpAndGetLocals(helper: DebugSessionHelper): Promise<DapVariable[]> {
        await helper.startSession(undefined, buildLaunchConfig('E2E: variables'), 25_000);

        const stopped = await helper.waitForEvent('stopped', 20_000);
        const body = stopped.body as { threadId?: number };
        assert.ok(typeof body?.threadId === 'number', 'threadId must be a number');

        const st = await helper.request<{ stackFrames: Array<{ id: number; line: number }> }>(
            'stackTrace',
            { threadId: body.threadId, levels: 1 },
        );
        assert.ok(st.stackFrames.length > 0, 'stackTrace must have at least one frame');
        assert.strictEqual(
            st.stackFrames[0].line,
            BP_LINE,
            `top frame must be at BP_LINE ${BP_LINE}, got ${st.stackFrames[0].line}`,
        );

        const frameId = st.stackFrames[0].id;
        const scopes = await helper.request<{
            scopes: Array<{ name: string; variablesReference: number }>;
        }>('scopes', { frameId });
        assert.ok(scopes.scopes.length > 0, 'scopes must not be empty');

        const localsScope = scopes.scopes.find((s) => s.name === 'Locals') ?? scopes.scopes[0];
        const vars = await helper.request<{ variables: DapVariable[] }>('variables', {
            variablesReference: localsScope.variablesReference,
        });

        // ── Discovery: log raw variable list so we know what WinCC OA actually sends ──
        console.log('[variables-e2e] === RAW LOCALS ===');
        for (const v of vars.variables) {
            console.log(
                `  ${v.name}: ${JSON.stringify(v.value)}  (varRef=${v.variablesReference})`,
            );
        }
        console.log('[variables-e2e] === END RAW ===');

        return vars.variables;
    }

    // ── test 1: primitive types ───────────────────────────────────────────────

    test('primitive types — int, uint, float, double, bool, string', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            const vars = await hitBpAndGetLocals(helper);

            const find = (name: string) => {
                const v = vars.find((v) => v.name === name);
                assert.ok(
                    v,
                    `variable "${name}" must be present in Locals scope (got: ${vars.map((x) => x.name).join(', ')})`,
                );
                return v!;
            };

            // int
            const vi = find('vi');
            assert.strictEqual(vi.value, '42', 'int vi must be "42"');
            assert.strictEqual(vi.variablesReference, 0, 'int must not be expandable');

            // uint
            const vui = find('vui');
            assert.strictEqual(vui.value, '100');
            assert.strictEqual(vui.variablesReference, 0);

            // float — allow minor representation variance (3.14 vs 3.14000...)
            const vf = find('vf');
            assert.ok(
                vf.value.startsWith('3.14'),
                `float vf must start with "3.14", got: ${vf.value}`,
            );
            assert.strictEqual(vf.variablesReference, 0);

            // double
            const vd = find('vd');
            assert.ok(
                vd.value.startsWith('2.718'),
                `double vd must start with "2.718", got: ${vd.value}`,
            );
            assert.strictEqual(vd.variablesReference, 0);

            // bool
            const vb = find('vb');
            assert.strictEqual(vb.value, 'true');
            assert.strictEqual(vb.variablesReference, 0);

            // string — must be quoted
            const vs = find('vs');
            assert.strictEqual(vs.value, '"hello"', 'string must be displayed with double quotes');
            assert.strictEqual(vs.variablesReference, 0);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 2: dyn (1-D dynamic array) types ────────────────────────────────

    test('dyn types — show length, are expandable, children are correct', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            // Restart manager for fresh state
            await lifecycle.startManagerByNum(TYPES_MANAGER);
            const vars = await hitBpAndGetLocals(helper);

            const find = (name: string) => {
                const v = vars.find((v) => v.name === name);
                assert.ok(v, `variable "${name}" must be present`);
                return v!;
            };

            // ── dyn_int ──────────────────────────────────────────────────────
            const vdi = find('vdi');
            assert.strictEqual(vdi.value, '[3]', 'dyn_int must show "[3]"');
            assert.ok(vdi.variablesReference > 0, 'dyn_int must be expandable');

            const diChildren = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vdi.variablesReference,
            });
            assert.strictEqual(diChildren.variables.length, 3);
            assert.strictEqual(diChildren.variables[0].name, '[0]');
            assert.strictEqual(diChildren.variables[0].value, '10');
            assert.strictEqual(diChildren.variables[1].value, '20');
            assert.strictEqual(diChildren.variables[2].value, '30');

            // ── dyn_string ───────────────────────────────────────────────────
            const vds = find('vds');
            assert.strictEqual(vds.value, '[3]', 'dyn_string must show "[3]"');
            assert.ok(vds.variablesReference > 0);

            const dsChildren = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vds.variablesReference,
            });
            assert.strictEqual(dsChildren.variables[0].value, '"alpha"');
            assert.strictEqual(dsChildren.variables[1].value, '"beta"');
            assert.strictEqual(dsChildren.variables[2].value, '"gamma"');

            // ── dyn_bool ─────────────────────────────────────────────────────
            const vdb = find('vdb');
            assert.strictEqual(vdb.value, '[3]');
            assert.ok(vdb.variablesReference > 0);

            const dbChildren = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vdb.variablesReference,
            });
            assert.strictEqual(dbChildren.variables[0].value, 'true');
            assert.strictEqual(dbChildren.variables[1].value, 'false');
            assert.strictEqual(dbChildren.variables[2].value, 'true');

            // ── dyn_float ────────────────────────────────────────────────────
            const vdf = find('vdf');
            assert.strictEqual(vdf.value, '[3]');
            assert.ok(vdf.variablesReference > 0);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 3: dyn_dyn (2-D dynamic array) types ────────────────────────────

    test('dyn_dyn types — outer and inner both expandable', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(TYPES_MANAGER);
            const vars = await hitBpAndGetLocals(helper);

            const find = (name: string) => {
                const v = vars.find((v) => v.name === name);
                assert.ok(v, `variable "${name}" must be present`);
                return v!;
            };

            // ── dyn_dyn_int ──────────────────────────────────────────────────
            const vddi = find('vddi');
            assert.strictEqual(vddi.value, '[2]', 'dyn_dyn_int outer shows "[2]"');
            assert.ok(vddi.variablesReference > 0);

            const outerRows = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vddi.variablesReference,
            });
            assert.strictEqual(outerRows.variables.length, 2);
            assert.strictEqual(outerRows.variables[0].value, '[2]');
            assert.ok(
                outerRows.variables[0].variablesReference > 0,
                'inner row must be expandable',
            );

            const row0 = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: outerRows.variables[0].variablesReference,
            });
            assert.strictEqual(row0.variables[0].value, '1');
            assert.strictEqual(row0.variables[1].value, '2');

            // ── dyn_dyn_string ───────────────────────────────────────────────
            const vdds = find('vdds');
            assert.strictEqual(vdds.value, '[2]');
            assert.ok(vdds.variablesReference > 0);

            const dsOuter = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vdds.variablesReference,
            });
            assert.ok(dsOuter.variables[0].variablesReference > 0);

            const dsRow0 = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: dsOuter.variables[0].variablesReference,
            });
            assert.strictEqual(dsRow0.variables[0].value, '"aa"');
            assert.strictEqual(dsRow0.variables[1].value, '"bb"');
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 4: mapping ───────────────────────────────────────────────────────

    test('mapping — shows key count, children are key-value pairs', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(TYPES_MANAGER);
            const vars = await hitBpAndGetLocals(helper);

            const vm = vars.find((v) => v.name === 'vm');
            assert.ok(vm, '"vm" (mapping) must be present in Locals');
            assert.strictEqual(vm!.value, '{2}', 'mapping with 2 keys must show "{2}"');
            assert.ok(vm!.variablesReference > 0, 'mapping must be expandable');

            const children = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vm!.variablesReference,
            });
            assert.strictEqual(children.variables.length, 2);

            const key1 = children.variables.find((c) => c.name === 'key1');
            const num = children.variables.find((c) => c.name === 'num');

            assert.ok(key1, '"key1" child must exist in mapping');
            assert.strictEqual(key1!.value, '"value1"', 'string mapping values must be quoted');
            assert.strictEqual(key1!.variablesReference, 0);

            assert.ok(num, '"num" child must exist in mapping');
            assert.strictEqual(num!.value, '99');
            assert.strictEqual(num!.variablesReference, 0);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 5: anytype ───────────────────────────────────────────────────────

    test('anytype — shows contained value, not expandable for scalar', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(TYPES_MANAGER);
            const vars = await hitBpAndGetLocals(helper);

            const vany = vars.find((v) => v.name === 'vany');
            assert.ok(vany, '"vany" (anytype) must be present');
            assert.strictEqual(vany!.value, '42', 'anytype containing int 42 must display "42"');
            assert.strictEqual(
                vany!.variablesReference,
                0,
                'scalar anytype must not be expandable',
            );
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });

    // ── test 6: struct (user-defined type) ────────────────────────────────────

    test('struct — shows field count, children are named fields with correct values', async function () {
        if (!canRun) {
            this.skip();
            return;
        }
        this.timeout(60_000);

        const scriptPath = lifecycle.getScriptPath('all_types.ctl');
        const helper = new DebugSessionHelper('winccoa');

        addBreakpoint(scriptPath, BP_LINE);

        try {
            await lifecycle.startManagerByNum(TYPES_MANAGER);
            const vars = await hitBpAndGetLocals(helper);

            const vst = vars.find((v) => v.name === 'vst');
            assert.ok(vst, '"vst" (MyStruct) must be present in Locals');
            assert.strictEqual(vst!.value, '{3}', 'struct with 3 fields must show "{3}"');
            assert.ok(vst!.variablesReference > 0, 'struct must be expandable');

            const children = await helper.request<{ variables: DapVariable[] }>('variables', {
                variablesReference: vst!.variablesReference,
            });
            assert.strictEqual(children.variables.length, 3);

            const x = children.variables.find((c) => c.name === 'x');
            const label = children.variables.find((c) => c.name === 'label');
            const active = children.variables.find((c) => c.name === 'active');

            assert.ok(x, '"x" field must be present');
            assert.strictEqual(x!.value, '10', 'int field x must display "10"');
            assert.strictEqual(x!.variablesReference, 0);

            assert.ok(label, '"label" field must be present');
            assert.strictEqual(label!.value, '"test"', 'string field label must be quoted');
            assert.strictEqual(label!.variablesReference, 0);

            assert.ok(active, '"active" field must be present');
            assert.strictEqual(active!.value, 'true', 'bool field active must display "true"');
            assert.strictEqual(active!.variablesReference, 0);
        } finally {
            vscode.debug.removeBreakpoints(addedBreakpoints);
            addedBreakpoints = [];
            await lifecycle.stopManagerByNum(TYPES_MANAGER).catch(() => {});
            await helper.dispose();
        }
    });
});
