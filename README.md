# WebCoordsFinder

A local-first web editor for turning visible Minecraft block model variants into
validated configuration files for the CUDA CoordsFinder scanner.

## Development

```powershell
npm install
npm run dev
```

The application runs entirely in the browser. Screenshots, project state, and
reference textures are stored on the current device and are never uploaded.

## Validation

```powershell
npm test
npm run lint
npm run build
```

## Current scope

- Static screenshots and connected, axis-aligned block planes
- Modern Java default visuals and all Vanilla/Sodium scanner modes
- Manual variant review plus selected-face automatic proposals when a canonical
  reference texture is available
- Exact CoordsFinder `.conf` export
- Unknown compass direction remains intentionally unsupported

WebCoordsFinder is an unofficial community tool and is not affiliated with
Mojang Studios or Microsoft.
