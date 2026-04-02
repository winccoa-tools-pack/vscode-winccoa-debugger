# WinCC OA Debugger Extension

Debug WinCC OA CTRL scripts directly from VS Code.

## Status

🚧 **Initial Setup** - Feature branch `feature/initial_setup`

## Features

- Debug CTRL scripts running in WinCC OA managers
- Set breakpoints with conditions
- Step through code (step in, step out, step over)
- Inspect variables (local, script-global, manager-global)
- View call stack
- Evaluate CTRL expressions

## Configuration

Add a debug configuration to your `.vscode/launch.json`:

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

## Architecture

- **Extension**: Registers debug adapter and configuration provider
- **Debug Adapter**: [@winccoa-tools-pack/winccoa-debug-adapter](../../npm-winccoa-repos/npm-winccoa-debugger)
- **Communication**: Datapoint API via `_CtrlDebug_<Manager>_<Num>`

## Development

```bash
# Install dependencies
npm install

# Compile extension
npm run compile

# Watch mode
npm run watch

# Run extension (F5 in VS Code)
npm run start
```

## Next Steps

1. ✅ Extension structure initialized
2. 🔲 Implement debug adapter integration
3. 🔲 Add configuration validation
4. 🔲 Test with real WinCC OA system
5. 🔲 Add syntax highlighting for CTRL

## License

MIT
