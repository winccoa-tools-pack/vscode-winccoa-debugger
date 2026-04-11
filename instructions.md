# vscode-winccoa-debugger — Development Instructions

## Was ist dieses Repo?

**Paket**: `vscode-winccoa-debugger` (VS Code Extension ID: `etm-control.vscode-winccoa-debugger`)  
**Branch**: `feature/initial_setup`  
**Zweck**: VS Code Extension für WinCC OA CTRL-Script-Debugging. Registriert einen
Debug-Adapter-Typ `winccoa` und verbindet VS Code mit dem Debug-Adapter aus
`@winccoa-tools-pack/winccoa-debug-adapter` (npm-winccoa-debugger).

> **Stand: April 2026**  
> E2E-Tests: ✅ Setup, BP-Cycle, StopOnEntry, Step-Commands, Spurious-Stops, Variables, Library-BP, Multi-Lib-BP, Class-Debugging  
> Library-BP Test 2 + Multi-Lib Test 2: ⏸️ skipped (Adapter-Timing)  
> Aktiv offen: siehe **Offene Features / Findings**

---

## Architektur

```text
src/
├── extension.ts                # Aktivierungspunkt — registriert Factory + Provider
├── debugAdapterFactory.ts      # DebugAdapterDescriptorFactory — verbindet VS Code mit Adapter-TCP
├── configurationProvider.ts    # DebugConfigurationProvider — ergänzt launch.json defaults
├── projectDetector.ts          # Erkennt aktives WinCC OA Projekt (via Project Admin Extension)
├── otherExtensions.ts          # Hilfsfunktionen für Extension-Interop
├── const.ts                    # Konstanten (Debug-Typ "winccoa")
└── test/
    ├── debugSessionHelper.ts            # VS Code API Wrapper für E2E-Tests
    ├── helpers/
    │   ├── WinccoaProjectLifecycle.ts   # Startet/Stoppt das Fixture-Projekt
    │   └── test-project-helpers.ts      # Hilfsfunktionen für Projektregistrierung
    ├── fixtures/
    │   └── projects/runnable/           # Fixture WinCC OA Projekt
    ├── unit/                            # Unit-Tests (kein WinCC OA)
    └── integration/                     # E2E-Tests (brauchen WinCC OA)
```

---

## Debug-Adapter-Architektur: pmon-only

Der Adapter wird **nicht** von der Extension gestartet — er läuft als WinCC OA
`node`-Manager in der `progs`-Datei (`once`).

`debugAdapterFactory.ts`:
1. Liest `adapterPort` aus `session.configuration`
2. Wartet per TCP-Poll bis Port erreichbar (max 15s)
3. Gibt `new DebugAdapterServer(port, '127.0.0.1')` zurück

**Kein Bootstrap-Spawn** — die Factory startet keinen Prozess.  
**Port**: Adapter lauscht immer auf **Port 7474** (hardcoded in `cli.ts`).

---

## E2E-Test-Infrastruktur

### Fixture-Projekt: `runnable`

```
src/test/fixtures/projects/runnable/
├── config/
│   ├── config          # WinCC OA Projektkonfiguration (Platzhalter)
│   └── progs           # Manager-Konfiguration (siehe unten)
└── scripts/
    ├── bp_basic_loop.ctl          # Endlosschleife mit delay(1)
    ├── stop_on_entry.ctl          # DebugBreak() am Start
    ├── call_library_function.ctl  # Ruft debugger_lib.ctl auf (#uses)
    ├── call_multi_libs.ctl        # Ruft math_utils + string_helpers auf (#uses)
    ├── callstack_depth3.ctl       # Tiefe Callstack — compute_outer → compute_inner → multiply_and_add
    ├── all_types.ctl              # Alle WinCC OA Basistypen
    ├── pause_loop.ctl             # DebugBreak() am Start + Endlosschleife (für pause-Test)
    ├── debug_classes.ctl          # Klassen-Debugging: Shape + Circle Instanzen
    ├── HelloWorld.ctl             # Minimales Beispielskript
    └── libs/
        ├── debugger_lib.ctl       # Library für lib-BP-Tests
        ├── math_utils.ctl         # Multi-lib Test: add_two_integers
        ├── string_helpers.ctl     # Multi-lib Test: repeat_string
        ├── nested/
        │   └── deep_math.ctl      # Nested-lib Test: multiply_numbers
        └── classes/
            ├── Shape.ctl          # Base-Klasse (protected m_name, m_sides)
            └── Circle.ctl         # Derived-Klasse : Shape (m_radius, area())
```

### progs-Konfiguration (aktueller Stand)

```
WCCILpmon        | manual  | 30 | 3 | 1 |
WCCILdataSQLite  | always  | 30 | 3 | 1 |
WCCILevent       | always  | 30 | 3 | 1 |
WCCOActrl        | once    | 30 | 3 | 1 | -num 2 bp_basic_loop.ctl
WCCOActrl        | once    | 30 | 3 | 1 | -num 3 stop_on_entry.ctl -dbg CTRL_DEBUGBREAK
WCCOActrl        | manual  | 30 | 3 | 1 | -num 4 call_library_function.ctl -dbg CTRL_DEBUGBREAK
WCCOActrl        | once    | 30 | 3 | 1 | -num 5 callstack_depth3.ctl
WCCOActrl        | once    | 30 | 3 | 1 | -num 6 all_types.ctl
WCCOActrl        | manual  | 30 | 3 | 1 | -num 7 pause_loop.ctl -dbg CTRL_DEBUGBREAK
WCCOActrl        | manual  | 30 | 3 | 1 | -num 8 call_multi_libs.ctl -dbg CTRL_DEBUGBREAK
WCCOActrl        | manual  | 30 | 3 | 1 | -num 9 debug_classes.ctl -dbg CTRL_DEBUGBREAK
node             | once    | 30 | 1 | 0 | debugAdapter.js
```

**Manager-Nummern**: `-num 2` bis `-num 9` für CTRL-Skripte; `node`-Adapter = `once`.  
**`manual`-Manager** (`-num 4, 7, 8, 9`): werden nur im jeweiligen E2E-Test gestartet.  
**`once`-Manager** (`-num 2, 3, 5, 6`): WinCC OA startet sie beim Projektstart.

### WinccoaProjectLifecycle

- `start()`: Registriert Projekt, startet WinCC OA, wartet auf Port 4999 (Data Manager) und
  Port 7474 (Adapter)
- `stop()`: Stoppt WinCC OA, deregistriert Projekt
- `startManagerByNum(n)`: Startet CTRL-Manager `-num N` via pmon `SINGLE_MGR:START`
- `stopManagerByNum(n)`: Stoppt CTRL-Manager `-num N`
- `getBaseLaunchConfig()`: Liefert `{ adapterPort: 7474, ... }`

### DebugSessionHelper

- `startSession(folder, config)`: Startet Debug-Session, wartet auf `configurationDone`-Zyklus
- `waitForEvent(name, timeoutMs)`: Wartet auf einen DAP-Event-Namen
- `request(command, args)`: Schickt einen DAP-Request, wartet auf Response
- `dispose()`: Beendet Session sauber

### E2E-Test-Pattern

```typescript
const lifecycle = new WinccoaProjectLifecycle();
const helper = new DebugSessionHelper('winccoa');

before(async () => { await lifecycle.start(); });
after(async () => { await lifecycle.stop(); });

it('BP fires', async () => {
    try {
        await lifecycle.startManagerByNum(2);    // VOR startSession!
        await helper.startSession(folder, config);
        const stopped = await helper.waitForEvent('stopped', 20_000);
        assert.strictEqual(stopped.body.reason, 'breakpoint');
    } finally {
        await lifecycle.stopManagerByNum(2).catch(() => {});
        await helper.dispose();
    }
});
```

**Reihenfolge kritisch**: `startManagerByNum` muss vor `startSession` kommen.

---

## E2E-Test-Status (aktuell)

| Test-Datei | Status | Beschreibung |
|---|---|---|
| `debugger-setup-e2e.test.ts` | ✅ passing | Adapter-Verbindung, Attach/Detach |
| `debugger-bp-cycle-e2e.test.ts` | ✅ passing | BP setzen, feuern, löschen Zyklen |
| `debugger-stop-on-entry-e2e.test.ts` | ✅ passing | stopOnEntry / DebugBreak()-Modus |
| `debugger-step-commands-e2e.test.ts` | ✅ 4/4 passing | step-next, step-into, step-out, pause |
| `debugger-spurious-stops-e2e.test.ts` | ✅ passing | Spurious-Stop-Unterdrückung |
| `debugger-library-bp-e2e.test.ts` | ✅ 1/2 (1 skipped) | Library-BP in `#uses`-Datei; Test 2 skipped (Adapter-Timing) |
| `debugger-multi-lib-bp-e2e.test.ts` | ✅ 1/2 (1 skipped) | Multi-Lib + nested lib BPs; Test 2 skipped (depth-2 Timing) |
| `debugger-race-condition-e2e.test.ts` | ✅ passing | Concurrent-BP-Set |
| `debugger-variables-e2e.test.ts` | ✅ 6/6 passing | Alle WinCC OA Basistypen + dyn/mapping |
| `debugger-class-e2e.test.ts` | ✅ 3/3 passing | Class-Instanzen, Base/Derived Method BPs |

---

## Step-Command Verhalten (WinCC OA 3.21, verifiziert)

| Command | WinCC OA Befehl | Verhalten |
|---|---|---|
| Step Over | `step over` | Stoppt an **nächster Zeile** (auch ohne BP) |
| Step Into | `step in` | Läuft bis zum **nächsten gesetzten BP** (nicht Zeile für Zeile!) |
| Step Out | `step out` | Kehrt aus Funktion zurück, stoppt an **nächster Zeile** im Caller |
| Continue | `cont` | Weiter bis nächsten BP |
| Pause | `b` | Benötigt vorher `script N` + `thread N` Kontext (via `attachToStopContext`) |

> `step in` verhält sich wie `continue` mit Function-Entry-Tracking — nur nach einem BP
> oder DebugBreak()-Stop. Im Test: `reason === 'step'` + `stoppedLine > 0` prüfen.

### Pause-Test-Pattern (pause_loop.ctl, `-num 7`)

```typescript
// pause_loop.ctl: DebugBreak() at line 22 + infinite loop
// Manager: -num 7 | manual | -dbg CTRL_DEBUGBREAK

await lifecycle.startManagerByNum(7);           // Manual-Manager starten
await new Promise(r => setTimeout(r, 2000));    // 2s warten bis DebugBreak() getriggert

await helper.startSession(folder, {
    ...baseConfig,
    stopOnEntry: true    // Fängt den DebugBreak()-Stop — stopState wird befüllt
});

const entry = await helper.waitForEvent('stopped', 15_000);
// entry.body.reason === 'entry' | 'breakpoint'

await helper.request('continue', { threadId: 1 });
await new Promise(r => setTimeout(r, 300));

await helper.request('pause', { threadId: 1 });
const paused = await helper.waitForEvent('stopped', 10_000);
assert.strictEqual(paused.body.reason, 'pause');
```

---

## NPM Scripts & Build

```bash
npm run compile:tsc          # TypeScript kompilieren + Fixtures kopieren
npm run compile              # Webpack + TSC
npm run setup:e2e-links      # Symlink: dist/adapter → npm-winccoa-debugger/dist/cjs

npm run test:e2e:setup       # Setup E2E-Tests
npm run test:e2e:bpcycle     # BP-Cycle E2E-Tests
npm run test:e2e:stopentry   # stopOnEntry E2E-Tests
npm run test:e2e:step        # Step-Command E2E-Tests (step-next, into, out, pause)
npm run test:e2e:spurious    # Spurious-Stops E2E-Tests
npm run test:e2e:libbp       # Library-BP E2E-Tests
npm run test:e2e:race        # Race-Condition E2E-Tests
npm run test:e2e:variables   # Variablen-Inspektion E2E-Tests
npm run test:e2e:full        # Alle E2E-Tests
```

---

## Bekannte Probleme / Offene Punkte

### ✅ 1. Library-BP (gelöst)

`toVSCodePath` prüft `libIndexCache` für bare Filenames. Library-BP Test 1 passt.  
Test 2 (non-stopOnEntry attach) skipped — Adapter-Timing-Problem bei `configurationDone`.

### ✅ 2. Step-Commands (gelöst)

Korrekte WinCC OA 3.21 Commands: `step over` / `step in` / `step out`.

### ✅ 3. Two-Phase-Response (gelöst)

Phase 1 "OK" resolvet Pending nicht; erst Phase 2 "line: N" löst StoppedEvent aus.

### ✅ 4. Pause ohne stopState (gelöst)

`attachToStopContext()` setzt Script/Thread-Kontext vor `b`.

### ✅ 5. Spurious-Stop-Filter (gelöst)

Automatisches `cont` bei BPs die nicht in `bpRegistry` registriert sind.

### ✅ 6. Race Condition bei concurrent setBreakpoints (gelöst)

`bpOperationQueue` serialisiert alle BP-Set-Operationen.

### ✅ 7. Class-Debugging (gelöst)

Klassen in `libs/classes/`, importiert via `#uses "classes/ClassName"`.  
Variablen-Name darf NICHT gleich dem Klassennamen sein (case-insensitive Kollision).  
`next` (step-over) nach DebugBreak nötig um while(true) zu passieren.

---

## Offene Features / Findings

### Nicht implementiert (Adapter)

- **Conditional Breakpoints** — Interface-Stubs vorhanden, `WinCCDebugSession` ignoriert Conditions
- **Hit-Count / Logpoint / Function / Exception / Data Breakpoints** — nicht implementiert
- **Globals Scope** — `info globals` Command existiert im Encoder, nicht in `scopesRequest` verdrahtet
- **Set Variable** — `supportsSetVariable = false`
- **Watch/Evaluate E2E** — `evaluateRequest` implementiert, aber kein E2E-Test
- **Modules / Loaded Sources** — nicht implementiert
- **Completions (REPL)** — nicht implementiert
- **Multi-Thread Debugging** — Adapter nimmt Single-Thread an
- **Reverse Stepping / Step-In-Targets** — nicht implementiert

### Adapter-Refactoring

- `BreakpointManager.ts`, `ThreadManager.ts`, `VariableManager.ts` sind leere Skelette
- Gesamte Logik lebt in `WinCCDebugSession.ts` — sollte in Manager-Klassen aufgeteilt werden
- `ResponseParser.ts` hat viele TODO-Stubs

### Skipped Tests (Timing-Probleme)

- `debugger-library-bp-e2e.test.ts` Test 2: non-stopOnEntry attach — `configurationDone` sendet `cont` bevor BPs gesetzt
- `debugger-multi-lib-bp-e2e.test.ts` Test 2: depth-2 nested lib BP — Adapter-Timing bei verschachtelten Libraries

---

## Abhängigkeiten

| Paket | Verwendung |
|---|---|
| `@winccoa-tools-pack/winccoa-debug-adapter` | Debug-Adapter-Lib (npm-winccoa-debugger) |
| `@winccoa-tools-pack/npm-winccoa-core` | PmonComponent, WinCC OA Versionsdetection |
| `@vscode/debugadapter` | DAP-Protokoll-Basisklassen |

### Symlink für E2E-Tests

```bash
npm run setup:e2e-links
# Erstellt: dist/adapter → ../../npm-winccoa-repos/npm-winccoa-debugger/dist/cjs
```
