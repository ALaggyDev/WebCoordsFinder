# WebCoordsFinder

WebCoordsFinder is an online web editor for Minecraft texture rotation cracking! It allows users to easily label visible block texture variants in a screenshot to find the coordinates. Then, users can either run the scanner directly on the website or export a search config for native CPU, Nvidia CUDA, or Apple-silicon Metal scanning.

With WebCoordsFinder, you can trivally find the coordinates of any screenshot in under 10 minutes.

Check out my video on YouTube!

Links:
- [Youtube Video](https://www.youtube.com/watch?v=gXTN9DD_Cp0)
- [CoordsFinder](https://github.com/ALaggyDev/CoordsFinder)
- [CoordsFinder Metal for Apple silicon](native/macos-metal/README.md)
- [Colab Notebook](https://colab.research.google.com/drive/17qih1n6VpQx_77C2spIF-JOJp17y9Jt6?usp=sharing)

If you like this project, please star it on Github and share it with your friends!

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
- Linear scan order is the default; on a compatible exact, single-direction M4 Metal search it benchmarked about 3x faster than spiral.
- Run a compatible parallel CoordsFinder search locally in a WebAssembly worker pool, with pause, stop, exact shard checkpoints, and resumable results.
- Download or copy an exact `coordsfinder.conf` for the native CoordsFinder CPU/CUDA scanner or the bundled Apple-silicon Metal scanner.
- Manage multiple local projects, import/export portable `.wcf` bundles, and start from bundled example projects.
- Installable offline PWA with bundled reference textures and scanner assets.

## Contributing

TLDR: The project creator (which is me, Laggy) is a person who **learns to code** well before the era of AIs. As such, he cares about code quality and code elegance well more than the "new-gen AI coders".

AI-generated PRs are allowed, with the following requirements:
- Please review the code and write the PR description yourself (as a **human**). You should understand your code and are responsible for your code.
- Keep the code change minimal and scoped as much as possible.
- Avoid optimizations that make the code hard or impossible to read.
- "Premature optimization is the root of all evil." I hope you understand what this phrase means.
- Please don't flood the repos with meaningless PRs.
