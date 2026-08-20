# WebCoordsFinder

WebCoordsFinder is an online web editor for Minecraft texture rotation cracking! It allows users to easily label visible block texture variants in a screenshot to find the coordinates. Then, users can either run the scanner directly on the website or export a search config file for [CoordsFinder](https://github.com/ALaggyDev/CoordsFinder) to run on Nvidia GPU.

With WebCoordsFinder, you can trivally find the coordinates of any screenshot in under 10 minutes.

Check my video on YouTube: [HERE](TODO)!

Link:
- TODO...

If you want to include WebCoordsFinder in your own video/project, please credit me and my project as a gesture of kindness. Thank you!

## Development

```sh
npm install
npm run dev
```

## Validation

```sh
npm test
npm run lint
npm run build
```

## Features

- Local-first screenshot analysis: images and projects stay in the browser's IndexedDB and are never uploaded.
- Perspective-aware 3D mesh editor: draw a base grid, extrude connected faces, calibrate a shared camera view, and pan or zoom to inspect evidence.
- Explicit world orientation and anchor controls for reliable X/Y/Z offsets.
- Manual and batch face labeling with perspective-correct crops, bundled vanilla reference textures, and grass-tint controls for supported blocks.
- Reviewable automatic variant proposals, scored in a background worker; only confirmed evidence is used for searching or export.
- Search configuration for Vanilla and Sodium texture algorithms, inclusive bounds, quarter-turn directions, error tolerance, and scanner tile settings.
- Run a compatible single-threaded CoordsFinder search locally in a background WebAssembly worker, with pause, stop, saved progress, and resumable results.
- Download or copy an exact `coordsfinder.conf` for the native CoordsFinder CPU/CUDA scanner.
- Manage multiple local projects, import/export portable `.wcf` bundles, and start from bundled example projects.
- Installable offline PWA with bundled reference textures and scanner assets.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests!
