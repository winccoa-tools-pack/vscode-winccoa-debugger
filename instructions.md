# vscode-winccoa-debugger — Development Instructions

## Was ist dieses Repo?

**Paket**: `vscode-winccoa-debugger` (VS Code Extension ID: `etm-control.vscode-winccoa-debugger`)  
**Branch**: `feature/initial_setup`  
**Zweck**: VS Code Extension für WinCC OA CTRL-Script-Debugging. Registriert einen
Debug-Adapter-Typ `winccoa` und verbindet VS Code mit dem Debug-Adapter aus
`@winccoa-tools-pack/winccoa-debug-adapter` (npm-winccoa-debugger).

---

## Architektur

```
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
    │   └── projects/
    │       └── runnable/                # Fixture WinCC OA Projekt
    │           ├── config/progs         # Manager-Konfiguration
    │           └── scripts/             # CTRL-Testskripte
    ├── unit/                           # Unit-Tests (kein WinCC OA)
    └── integration/                    # E2E-Tests (brauchen WinCC OA)
        ├── debugger-e2e.test.ts
        ├── debugger-bp-cycle-e2e.test.ts
        ├── debugger-stop-on-entry-e2e.test.ts
        ├── debugger-step-commands-e2e.test.ts
        ├── debugger-library-bp-e2e.test.ts
        ├── debugger-race-condition-e2e.test.ts
        └── debugger-spurious-stops-e2e.test.ts
```

---

## Debug-Adapter-Architektur: pmon-only

### Produktions- und Test-Setup
Der Adapter wird **nicht** von der Extension gestartet — er läuft als WinCC OA `node`-Manager:

```
progs:
  node | once | 30 | 1 | 0 | debugAdapter.js
```

`debugAdapterFactory.ts` (DescriptorFactory):
1. Liest `adapterPort` aus `session.configuration`
2. Wartet per TCP-Poll bis Port erreichbar ist (max 15s)
3. Gibt `new DebugAdapterServer(port, '127.0.0.1')` zurück

**Kein Bootstrap-Spawn in der Factory** — das war das alte Design. Ist entfernt.

### Port
- Adapter lauscht immer auf **Port 7474** (Hardcoded in `cli.ts` TCP-Modus)
- `adapterPort: 7474` wird von `WinccoaProjectLifecycle.getBaseLaunchConfig()` gesetzt

---

## E2E-Test-Infrastruktur

### Fixture-Projekt: `runnable`
```
src/test/fixtures/projects/runnable/
├── config/
│   ├── config          # WinCC OA Projektkonfiguration (Host/Port/Version-Platzhalter)
│   └── progs           # Manager-Konfiguration
└── scripts/
    ├── bp_basic_loop.ctl          # -num 1 | Endlosschleife mit delay(1)
    ├── stop_on_entry.ctl          # -num 2 | stopOnEntry via -dbg CTRL_DEBUGBREAK
    ├── call_library_function.ctl  # -num 3 | Ruft debugger_lib.ctl auf (#uses)
    ├── callstack_depth3.ctl       # -num 4 | Tiefe Callstack für step-Tests
    └── libs/
        └── debugger_lib.ctl       # Library-Datei für lib-BP-Tests
```

### progs-Konfiguration
```
WCCOActrl | manual | ... | -num 1 bp_basic_loop.ctl
WCCOActrl | manual | ... | -num 2 stop_on_entry.ctl -dbg CTRL_DEBUGBREAK
WCCOActrl | manual | ... | -num 3 call_library_function.ctl
WCCOActrl | manual | ... | -num 4 callstack_depth3.ctl
node      | once   | ... | debugAdapter.js
```

**Alle CTRL-Manager `manual`** — Tests starten/stoppen sie explizit.  
**Adapter `once`** — WinCC OA startet ihn automatisch beim Projektstart.

### WinccoaProjectLifecycle
- `start()`: Registriert Projekt, startet WinCC OA, wartet auf Port 4999 (Data Manager), dann auf Port 7474 (Adapter)
- `stop()`: Stoppt WinCC OA, deregistriert Projekt
- `startManagerByNum(n)`: Startet den CTRL-Manager mit `-num N` (via pmon SINGLE_MGR:START)
- `stopManagerByNum(n)`: Stoppt den CTRL-Manager mit `-num N`
- `getBaseLaunchConfig()`: Liefert `{ adapterPort: 7474, ... }`

### DebugSessionHelper
- `startSession(folder, config)`: Startet Debug-Session, wartet auf `configurationDone`-Zyklus
  - Intern: `waitForConfigurationDone()` wartet auf `continued` oder `stopped` Event (peek, nicht consume)
- `waitForEvent(name, timeoutMs)`: Wartet auf einen DAP-Event-Namen
- `request(command, args)`: Schickt einen DAP-Request und wartet auf Response
- `dispose()`: Beendet Session sauber

### E2E-Test-Pattern
```typescript
const lifecycle = new WinccoaProjectLifecycle();
const helper = new DebugSessionHelper('winccoa');

before(async () => { await lifecycle.start(); });
after(async () => { await lifecycle.stop(); });

it('BP fires', async () => {
    try {
        await lifecycle.startManagerByNum(1);   // CTRL-Manager starten VOR Session
        await helper.startSession(folder, config);
        const stopped = await helper.waitForEvent('stopped', 20_000);
        // assert ...
    } finally {
        await lifecycle.stopManagerByNum(1).catch(() => {});
        await helper.dispose();
    }
});
```

**Reihenfolge kritisch**: `startManagerByNum` MUSS vor `startSession` kommen, damit der
CTRL-Prozess läuft wenn die Session die Breakpoints setzt.

---

## NPM-Scripts & Build

```bash
npm run compile:tsc          # TypeScript kompilieren + Fixtures kopieren
npm run compile              # Webpack + TSC
npm run test:e2e:bpcycle     # BP-Cycle E2E-Tests
npm run test:e2e:libbp       # Library-BP E2E-Tests
npm run test:e2e:step        # Step-Command E2E-Tests
npm run test:e2e:stopentry   # stopOnEntry E2E-Tests
npm run test:e2e:race        # Race-Condition E2E-Tests
npm run test:e2e:spurious    # Spurious-Stops E2E-Tests
```

---

## Bekannte Probleme / Offene Punkte

### 1. Library-BP feuert nicht (AKTIV)
**Betroffene Tests**: `debugger-library-bp-e2e.test.ts` Test 1 ("BP in library file fires")  
**Symptom**: Events: `initialized, continued, breakpoint` — aber kein `stopped` innerhalb 20s  
**Was passiert**: `retryPendingBreakpoints()` via 500ms-Timer findet `scriptId/libIndex` via
Probe und erhält `breakpoint set` → `breakpoint`-Event wird gesendet. Der BP feuert aber
in WinCC OA nicht.  
**Vermutung**: Falscher `libIndex` (Probe findet `lib:0` aber die Library ist bei `lib:1`?),
oder die Probe-Antwort `breakpoint set` ist ein False-Positive.  
**Nächster Schritt**: Adapter-Logs beim Retry analysieren — welchen `scriptId/lib`-Wert
findet die Probe genau, und was meldet WinCC OA?

### 2. Test 2 (libbp): kein stopped, kein breakpoint (AKTIV)  
**Betroffene Tests**: `debugger-library-bp-e2e.test.ts` Test 2 ("main BP fires correctly")  
**Symptom**: Events: `initialized, continued` — kein `stopped`, kein `breakpoint`  
**Was passiert**: Keine der registrierten BPs (main + lib) wird verified  
**Vermutung**: `info scripts` liefert noch kein Ergebnis obwohl Timer läuft, oder
Timing-Problem beim zweiten Testlauf (Manager wurde in Test 1 gestoppt/neu gestartet).

### 3. Race Condition bei sehr frischem Manager-Start (AKTIV)
Zwischen `pmon startManager → return` und `CTRL-Script erscheint in info scripts`
liegen typischerweise 0.5–3s.  
→ Der `pendingBpRetryTimer` (500ms) löst das meistens, aber 2s nach `configurationDone`
kann die erste Retry-Welle immer noch ein leeres `info scripts` bekommen.

---

## Abhängigkeiten

| Paket | Verwendung |
|---|---|
| `@winccoa-tools-pack/winccoa-debug-adapter` | Debug-Adapter-Lib (npm-winccoa-debugger) |
| `@winccoa-tools-pack/npm-winccoa-core` | PmonComponent, WinCC OA Versionsdetection |
| `@vscode/debugadapter` | DAP-Protokoll-Basisklassen |

### Symlink für Tests
```bash
npm run setup:e2e-links
# Erstellt: vscode-winccoa-debugger/dist/adapter → npm-winccoa-debugger/dist/cjs
```

---

## Nächste Schritte (Priorisiert)

1. **Adapter-Logs debuggen**: Beim `lib-bp`-Test die genauen `info scripts`-Antworten und
   Probe-Ergebnisse loggen. Herausfinden welcher `scriptId/libIndex` gefunden wird.
2. **call_library_function.ctl prüfen**: Stellt sicher, dass die Lib-Funktion wirklich
   regelmäßig aufgerufen wird (Endlosschleife mit `delay(1)` wird erwartet).
3. **Alle E2E-Tests grün bekommen**: Reihenfolge: bpcycle → stopentry → step → libbp → race → spurious
4. **Webpack-Bundle**: Sicherstellen dass das produzierte VSIX den Adapter korrekt einbindet.
