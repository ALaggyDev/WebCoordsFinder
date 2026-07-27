# WebCoordsFinder

A local-first web editor for turning visible Minecraft block model variants into
validated configuration files for the CUDA CoordsFinder scanner.

## Development

```powershell
npm install
npm run dev
```

The application runs entirely in the browser. Screenshots and project state stay
on the current device and are never uploaded. Vanilla reference textures are
bundled with the application.

## Validation

```powershell
npm test
npm run lint
npm run build
```

## Current scope

- Static screenshots with one global integer lattice, edge extrusion, and
  shared six-point camera calibration
- Partial abstract-to-world axis labeling with a two/three-axis global gizmo
- Modern Java default visuals and all Vanilla/Sodium scanner modes
- Manual variant review plus selected-face automatic proposals using bundled
  face-correct vanilla reference textures
- Exact CoordsFinder `.conf` export
- Unknown compass direction remains intentionally unsupported

WebCoordsFinder is an unofficial community tool and is not affiliated with
Mojang Studios or Microsoft.
