# Programmer's Art

These 35 PNG overrides come from Mojang's bundled `programmer_art.zip` in the
local Minecraft Java asset cache (asset hash
`b84572b0d91367c41ff73b22edd5a2e9c02eab13`, index 26).
Minecraft assets belong to Mojang/Microsoft. Only textures used by the workbench
are retained. Missing textures inherit the existing vanilla bundle, as in Minecraft.

Rebuild from the local ZIP or its asset-cache object:

```sh
node scripts/bundle-programmer-art.mjs path/to/programmer_art.zip
```

This also updates `src/domain/programmerArt.json`. The PWA precaches these PNGs
alongside the existing references, so Programmer's Art works offline.
