# WinCC OA Debugger

<div align="center">

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![License](https://img.shields.io/badge/license-proprietary-red.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.118.0-007ACC.svg)

</div>

## Debug WinCC OA CTRL scripts directly from Visual Studio Code

[Features](#-features) • [Configuration](#️-configuration) • [Known Issues](#-known-issues)

---

> **⚠️ Early Access Notice**
> This extension is in active development. While core features are stable, you may encounter:
>
> - **Edge cases** not yet fully covered
> - **Library breakpoint** handling still being refined
>
> **🐛 Found a bug?** Please report it on our [GitHub Issues](https://github.com/winccoa-tools-pack/vscode-winccoa-debugger/issues)!
> Your feedback helps us make this extension better for everyone. 🙏
>
> **Quick Fix:** If something doesn't work, try `Ctrl+Shift+P` → `Reload Window`

---

## ✨ Features

### 🚀 Launch & Attach

- **Launch Mode**: Open a CTRL script and press `F5` — a temporary WCCOActrl manager is started automatically and removed after the session
- **Attach Mode**: Attach to any running WinCC OA manager (CTRL, UI, etc.)
- **Quick Debug**: Debug the currently active CTRL file with zero configuration

### 🔴 Breakpoints

- Set breakpoints in `.ctl` and `.ctc` files
- **Library breakpoints**: Breakpoints in shared library files are resolved across sub-projects
- **Conditional breakpoints**: Break only when a condition is met
- Breakpoints in nested libraries and multi-lib projects

### 🔍 Stepping & Inspection

- **Step In / Step Out / Step Over**: Navigate through your CTRL code
- **Variable Inspection**: View local, script-global, and manager-global variables
- **Call Stack**: Full call stack with source file and line information
- **Expression Evaluation**: Evaluate CTRL expressions in the Debug Console

### 📁 Sub-Project Support

- Automatic project detection from workspace
- Path mappings between local and remote paths
- Sub-project library resolution

---

## ⚙️ Configuration

### Quick Start (Launch Mode)

No configuration required! Open a `.ctl` file and press `F5`. The extension auto-detects your WinCC OA project and starts a temporary manager.

### Launch Configuration

Add to your `.vscode/launch.json`:

```json
{
  "type": "winccoa",
  "request": "launch",
  "name": "Debug CTRL Script",
  "script": "${file}"
}
```

### Attach Configuration

```json
{
  "type": "winccoa",
  "request": "attach",
  "name": "Attach to WinCC OA Manager",
  "host": "localhost",
  "port": 4999,
  "system": "System1",
  "manager": {
    "type": "CTRL",
    "number": 1
  },
  "pathMappings": {
    "/opt/WinCC_OA/3.21/scripts": "${workspaceFolder}/scripts"
  }
}
```

### Configuration Reference

| Property | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `script` | `string` | `${file}` | Path to the CTRL script to debug (launch mode only) |
| `scriptManagerNum` | `number` | `98` | Manager number for the auto-started script manager |
| `host` | `string` | `localhost` | Host where WinCC OA is running |
| `port` | `number` | `4999` | Port for datapoint connection |
| `project` | `string` | — | WinCC OA project name (e.g. `DevEnv3.21`) |
| `system` | `string` | — | WinCC OA system name (e.g. `System1`) |
| `manager.type` | `string` | `CTRL` | Manager type: `CTRL`, `UI`, `EVENT`, `ASCII`, `DEVICE`, `API`, `DRIVER` |
| `manager.number` | `number` | `1` | Manager number |
| `pathMappings` | `object` | `{}` | Path mappings from WinCC OA to local paths |
| `adapterManagerNumber` | `number` | `99` | Manager number for the debug adapter (must not collide) |
| `adapterPort` | `number` | `7474` | TCP port the debug adapter listens on |
| `trace` | `boolean` | `false` | Enable trace logging |

### Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `winccoa.debugger.adapterCliPath` | `""` | Absolute path to the debug adapter cli.js (fallback for development) |
| `winccoa.debugger.bootstrapPath` | (auto-detected) | Absolute path to the WinCC OA bootstrap.js |

---

## 📝 Commands

Access via `Ctrl+Shift+P`:

| Command | Description |
| ------- | ----------- |
| `WinCC OA: Show Debugger Status` | Show current debugger connection status |
| `WinCC OA: Show Debugger Output` | Open the debugger output channel |

---

## 🐛 Known Issues

### Current Limitations

1. **Library Breakpoints**:
   - Breakpoints in deeply nested library chains may not resolve on first hit
   - Workaround: Set the breakpoint and restart the debug session

2. **Stop on Entry**:
   - `stopOnEntry` may report incorrect line numbers in some scenarios
   - Under investigation

3. **Quick Debug**:
   - Stop reason may show "entry" instead of "breakpoint" in some edge cases

4. **Path Mappings**:
   - Required when WinCC OA project paths differ between local and remote systems
   - Windows UNC paths are supported but may need explicit mappings

### Reporting Bugs

Found an issue? Please report it with:

- WinCC OA version
- Extension version (`0.1.0`)
- Steps to reproduce the issue
- Enable `trace: true` in launch.json and attach log output

[Report Issue on GitHub](https://github.com/winccoa-tools-pack/vscode-winccoa-debugger/issues)

---

## 🛠️ Requirements

- **VS Code:** 1.110.0 or higher
- **WinCC OA:** 3.19+ installed on your system
- **Dependency:** [WinCC OA Project Admin](https://marketplace.visualstudio.com/items?itemName=winccoa-tools-pack.winccoa-project-admin) extension

---

## 📄 License

This project is proprietary software. All rights reserved — see the [LICENSE](LICENSE) file for details.

Unauthorized copying, modification, distribution, or use of this software is strictly prohibited.

---

## 🔗 Related Extensions

- [WinCC OA Project Admin](https://marketplace.visualstudio.com/items?itemName=winccoa-tools-pack.winccoa-project-admin) - Project management and PMON control
- [WinCC OA Script Actions](https://marketplace.visualstudio.com/items?itemName=RichardJanisch.winccoa-script-actions) - Execute CTRL scripts
- [WinCC OA Test Explorer](https://marketplace.visualstudio.com/items?itemName=RichardJanisch.winccoa-vscode-tests) - Run unit tests
- [WinCC OA CTRL Language](https://marketplace.visualstudio.com/items?itemName=mPokornyETM.wincc-oa-ctrl-lang) - Language support
- [WinCC OA LogViewer](https://marketplace.visualstudio.com/items?itemName=RichardJanisch.winccoa-logviewer) - View log files

---

## ⚠️ Disclaimer

**WinCC OA** and **Siemens** are trademarks of Siemens AG. This project is not affiliated with, endorsed by, or sponsored by Siemens AG. This is a community-driven project created to enhance the development experience for WinCC OA developers.

---

<center>Made with ❤️ for and by the WinCC OA community</center>

[GitHub](https://github.com/winccoa-tools-pack/vscode-winccoa-debugger) • [Issues](https://github.com/winccoa-tools-pack/vscode-winccoa-debugger/issues) • [WinCC OA Docs](https://www.winccoa.com)
