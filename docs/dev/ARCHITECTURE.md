# WinCC OA VSCode Debugger — Vollständige Architektur

## 1. Systemübersicht

```mermaid
graph TB
    subgraph "Developer Machine"
        VSCode["VS Code\n(IDE)"]
        subgraph "VS Code Extension\nvscode-winccoa-debugger"
            FACTORY["DebugAdapterDescriptorFactory\nspawnt cli.js --stdio"]
            PROVIDER["WinCCConfigurationProvider\nvalidiert launch.json"]
        end
        subgraph "Debug Adapter Process\ncli.js (Node.js)"
            SESSION["WinCCDebugSession\nextends DebugSession"]
            CLIENT["DatapointClient\nTransport Layer"]
        end
    end

    subgraph "WinCC OA Project (DevEnv3.21)"
        PMON["pmon\nProcess Manager"]
        DM["Data Manager\n:4999"]
        CTRL["WCCOActrl -num 1\nCTRL Manager"]
        DP_CMD["_CtrlDebug_CTRL_1.Command\nDPE: Text"]
        DP_RES["_CtrlDebug_CTRL_1.Result\nDPE: dyn_string"]
    end

    VSCode <-->|"DAP über stdin/stdout"| SESSION
    FACTORY -->|"process.spawn node cli.js --stdio"| SESSION
    SESSION <--> CLIENT
    CLIENT <-->|"dpSet / dpConnect\nwinccoa-manager native addon"| DM
    DM <--> DP_CMD
    DM <--> DP_RES
    CTRL <-->|"WinCC OA intern\n(nicht TCP)"| DP_CMD
    CTRL <-->|"WinCC OA intern\n(nicht TCP)"| DP_RES
    PMON -->|"startet"| CTRL
```

---

## 2. Kommunikations-Protokolle im Detail

### Ebene 1: VS Code ↔ Debug Adapter — DAP über stdio

```mermaid
sequenceDiagram
    participant VS as VS Code
    participant CLI as cli.js (--stdio)
    participant SES as WinCCDebugSession

    Note over VS,CLI: DAP = Debug Adapter Protocol (JSON-RPC over stdin/stdout)
    VS->>CLI: stdin: {"seq":1,"type":"request","command":"initialize",...}
    CLI->>SES: initializeRequest()
    SES-->>CLI: initializeResponse (capabilities)
    CLI-->>VS: stdout: {"seq":1,"type":"response","command":"initialize","body":{...}}

    VS->>CLI: stdin: {"command":"attach","arguments":{"project":"DevEnv3.21","system":"","port":4999,...}}
    CLI->>SES: attachRequest()
    Note over SES: Verbindet sich via DatapointClient
    SES-->>VS: stdout: attachResponse + InitializedEvent
```

**DAP ist KEIN HTTP.** Es ist ein JSON-Newline-delimited Protokoll das **direkt über stdin/stdout** läuft.
VS Code spawnt den Prozess und spricht mit ihm über die Standard-Pipes.

### Ebene 2: Debug Adapter ↔ WinCC OA — native winccoa-manager

```mermaid
sequenceDiagram
    participant CLT as DatapointClient
    participant BIND as ConnectionBinding\n(native .so addon)
    participant DM as Data Manager :4999
    participant CTRL as WCCOActrl -num 1

    Note over CLT,BIND: process.argv wird manuell injiziert:<br/>-proj DevEnv3.21 -host localhost -port 4999 -num 99 -m jscript
    CLT->>BIND: ConnectionBinding.instance.start()
    BIND->>DM: TCP connect :4999 (WinCC OA internes Protokoll)
    DM-->>BIND: Manager registriert als Nr. 99

    CLT->>BIND: dpConnect("_CtrlDebug_CTRL_1.Result", callback)
    BIND->>DM: subscribe DPE
    DM-->>BIND: subscription id > 0

    CLT->>BIND: dpSet("_CtrlDebug_CTRL_1.Command", JSON)
    BIND->>DM: value write
    DM->>CTRL: value change notification
    CTRL->>DM: dpSet("_CtrlDebug_CTRL_1.Result", [...])
    DM->>BIND: callback fired
    BIND-->>CLT: handleResponse(values)
```

**Die winccoa-manager Verbindung ist TCP** zum Data Manager Port 4999 — aber das ist das
**interne WinCC OA Protokoll** (proprietär, Siemens), nicht DAP oder HTTP.

---

## 3. WinCC OA Debugger-Seite — DP-Protokoll

```mermaid
graph LR
    subgraph "Node.js Adapter (Num 99)"
        SEND["dpSet Command\nJSON string"]
        RECV["dpConnect Result\ncallback"]
    end

    subgraph "Data Manager"
        CMD["_CtrlDebug_CTRL_1.Command\nType: Text\n← Adapter schreibt"]
        RES["_CtrlDebug_CTRL_1.Result\nType: dyn_string\n← CTRL schreibt"]
    end

    subgraph "CTRL Manager (Num 1)"
        DBG["CTRL Debugger\n(eingebaut in WinCC OA)"]
        SCRIPT["CTL Script\nz.B. debugTest.ctl"]
    end

    SEND -->|"dpSet"| CMD
    CMD -->|"Value Change Event"| DBG
    DBG -->|"Breakpoint hit\ndpSet Result"| RES
    RES -->|"dpConnect Callback"| RECV
    DBG <--> SCRIPT
```

### DP-Nachrichten Format

**Command (Adapter → CTRL):**
```json
{ "id": "1712345678-abc123", "cmd": "break scripts/debugTest.ctl:42" }
```

**Response (CTRL → Adapter) — Solicited:**
```json
["1712345678-abc123", "OK", "Breakpoint 1 at scripts/debugTest.ctl:42"]
```

**Response — Unsolicited (Stop-Event vom CTRL):**
```json
["", "stopped", "breakpoint", "1", "scripts/debugTest.ctl", "42"]
```

### Unterstützte Debugger-Kommandos

| Kommando | Bedeutung |
|---|---|
| `break <file>:<line>` | Breakpoint setzen |
| `clear <file>` | Alle Breakpoints in Datei entfernen |
| `continue` | Ausführung fortsetzen |
| `next` | Step Over |
| `step` | Step Into |
| `finish` | Step Out |
| `interrupt` | Pause / Break |
| `info threads` | Thread-Liste abfragen |
| `bt` | Backtrace / Call Stack |
| `info locals` | Lokale Variablen |
| `print <expr>` | Ausdruck auswerten |

---

## 4. Vollständiger Debug-Flow

```mermaid
sequenceDiagram
    participant DEV as Entwickler
    participant VS as VS Code UI
    participant SES as WinCCDebugSession
    participant CLT as DatapointClient
    participant DM as WinCC OA DM
    participant CTRL as CTRL Manager

    DEV->>VS: F5 → "Attach to WinCC OA CTRL 1"
    VS->>SES: initialize
    SES-->>VS: capabilities
    VS->>SES: attach {project:DevEnv3.21, port:4999, manager:{CTRL,1}}
    SES->>CLT: connect()
    CLT->>DM: TCP connect, register als Manager 99
    CLT->>DM: dpConnect(_CtrlDebug_CTRL_1.Result)
    DM-->>CLT: subscriptionId=5
    CLT-->>SES: emit('connected')
    SES-->>VS: attachResponse + InitializedEvent

    VS->>SES: setBreakpoints [scripts/debugTest.ctl:42]
    SES->>CLT: sendCommand("break scripts/debugTest.ctl:42")
    CLT->>DM: dpSet(.Command, {"id":"x1","cmd":"break..."})
    DM->>CTRL: value change
    CTRL->>DM: dpSet(.Result, ["x1","OK","Breakpoint 1..."])
    DM->>CLT: dpConnect callback
    CLT-->>SES: resolve(["OK","Breakpoint 1..."])
    SES-->>VS: Breakpoint verified ✓

    VS->>SES: configurationDone
    Note over CTRL,DM: Script läuft bis Breakpoint

    CTRL->>DM: dpSet(.Result, ["","stopped","breakpoint","1","scripts/debugTest.ctl","42"])
    DM->>CLT: dpConnect callback (id="" → unsolicited)
    CLT-->>SES: emit('message', ["stopped","breakpoint","1",...])
    SES-->>VS: StoppedEvent(reason=breakpoint, threadId=1)
    VS->>DEV: 🔴 Execution paused at line 42

    DEV->>VS: Variables Panel
    VS->>SES: stackTrace
    SES->>CLT: sendCommand("bt")
    CLT->>DM: dpSet + wait response
    DM->>CTRL: value change
    CTRL->>DM: dpSet(.Result, ["id","OK","#0 testFunc at scripts/debugTest.ctl:42"])
    CLT-->>SES: ["OK","#0 testFunc..."]
    SES-->>VS: StackFrame [testFunc @ debugTest.ctl:42]
```

---

## 5. Path Mappings

WinCC OA kennt Skript-Pfade relativ zum Projekt-Root (z.B. `scripts/debugTest.ctl`).
VS Code arbeitet mit absoluten Dateisystem-Pfaden (`/home/testus/wincc_proj/DevEnv3.21/scripts/debugTest.ctl`).

```
launch.json:
"pathMappings": {
  "/home/testus/wincc_proj/DevEnv3.21/scripts": "${workspaceFolder}/scripts"
}

VS Code Pfad:   /home/testus/wincc_proj/DevEnv3.21/scripts/debugTest.ctl
                            ↕  toWinCCOAPath()
WinCC OA Pfad:  scripts/debugTest.ctl

WinCC OA Pfad:  scripts/debugTest.ctl
                            ↕  toVSCodePath()
VS Code Pfad:   /home/testus/wincc_proj/DevEnv3.21/scripts/debugTest.ctl
```

---

## 6. Aktuelles Problem — Warum stdin/stdout versagt

```mermaid
graph TB
    subgraph "PROBLEM: spawn --stdio (aktuell)"
        VS2["VS Code"]
        CLI2["cli.js --stdio\n(Child Process)"]
        ADDON["native .so addon\n(ConnectionBinding)"]

        VS2 -->|"stdin: DAP JSON"| CLI2
        CLI2 -->|"stdout: DAP JSON"| VS2
        ADDON -->|"⚠️ stdout: log output!\nkorrumpiert DAP stream"| CLI2
        ADDON -->|"⚠️ process.argv injection\nnach erstem import = zu spät"| CLI2
    end

    subgraph "LÖSUNG: TCP Server Mode (geplant)"
        PMON2["pmon\n(startet korrekt)"]
        CLI3["cli.js --tcp-port 4998\n(echter pmon Manager)"]
        VS3["VS Code"]
        ADDON3["native .so addon\n(sauber via pmon bootstrap.js)"]

        PMON2 -->|"node cli.js --tcp-port 4998\n-proj DevEnv3.21 -num 99 -m jscript"| CLI3
        ADDON3 -->|"stdout → WinCC OA Logviewer ✓"| CLI3
        VS3 -->|"TCP connect :4998\nDAP über Socket"| CLI3
    end
```

### Ursachen im Detail

1. **argv-Injection kommt zu spät** — `winccoa-manager` lädt die native `.so` beim ersten `import`,
   liest `process.argv` einmalig. Da der Prozess von VS Code gespawnt wird (nicht pmon),
   fehlen die WinCC OA Args zum richtigen Zeitpunkt.

2. **stdout ist belegt** — DAP und native Addon schreiben beide auf stdout → korrupter DAP-Stream,
   VS Code kann die Antworten nicht parsen.

3. **Keine pmon-Umgebung** — pmon setzt bestimmte Umgebungsvariablen und startet `bootstrap.js`,
   das die Verbindung korrekt initialisiert (`managerStart()`, `ConnectionBinding.instance.start()`).

### Geplante Lösung: TCP-Server Mode

| | Aktuell (stdio) | Geplant (TCP) |
|---|---|---|
| Adapter wird gestartet von | VS Code (`spawn`) | pmon |
| DAP-Transport | stdin/stdout | TCP Socket :4998 |
| WinCC OA Verbindung | argv-Injection (fragil) | pmon-Args (korrekt) |
| Logs sichtbar in | nirgendwo | WinCC OA Logviewer |
| `factory.ts` nutzt | `DebugAdapterExecutable` | `DebugAdapterServer(4998)` |

---

## 7. Datei-Übersicht

| Datei | Repo | Rolle |
|---|---|---|
| `src/extension.ts` | vscode-winccoa-debugger | VS Code Extension Entry Point, registriert Factory + Provider |
| `src/debugAdapterFactory.ts` | vscode-winccoa-debugger | Erstellt den Debug Adapter Descriptor (spawn oder TCP) |
| `src/configurationProvider.ts` | vscode-winccoa-debugger | Validiert und vervollständigt `launch.json` Konfigurationen |
| `src/projectDetector.ts` | vscode-winccoa-debugger | Erkennt WinCC OA Projektverzeichnis |
| `src/cli.ts` | npm-winccoa-debugger | Entry Point des Adapter-Prozesses, parst CLI-Args |
| `src/adapter/WinCCDebugSession.ts` | npm-winccoa-debugger | DAP ↔ WinCC OA Übersetzung (alle DAP-Handler) |
| `src/connection/DatapointClient.ts` | npm-winccoa-debugger | Transport: dpSet/dpConnect via winccoa-manager native addon |

---

## 8. launch.json Referenz

```json
{
  "type": "winccoa",
  "request": "attach",
  "name": "Attach to WinCC OA CTRL 1",
  "host": "localhost",
  "port": 4999,
  "project": "DevEnv3.21",
  "system": "",
  "manager": {
    "type": "CTRL",
    "number": 1
  },
  "adapterManagerNumber": 99,
  "pathMappings": {
    "/home/testus/wincc_proj/DevEnv3.21/scripts": "${workspaceFolder}/scripts"
  },
  "trace": true
}
```

| Feld | Bedeutung |
|---|---|
| `project` | WinCC OA Projektname für `-proj` Argument (z.B. `DevEnv3.21`) |
| `system` | DP-Prefix vor Datapunktnamen (`System1:` oder `""` für Single-System) |
| `port` | Data Manager Port (Standard: 4999) |
| `manager.type` + `manager.number` | Welcher CTRL Manager debuggt werden soll |
| `adapterManagerNumber` | Manager-Nummer des Adapters selbst (darf nicht kollidieren) |
| `pathMappings` | Lokaler Pfad → WinCC OA relativer Pfad |
