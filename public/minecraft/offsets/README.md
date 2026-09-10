# Decoration model assets

These vanilla textures and the resolved model catalog in
`src/domain/offsetModels.json` come from the user-supplied Minecraft Java
1.21.11 extracted resource pack. Minecraft assets belong to Mojang/Microsoft.

Rebuild from a directory containing `models`, `blockstates`, and `textures`:

```sh
node scripts/bundle-offset-models.mjs "path/to/extracted/assets"
```

The importer resolves model parents, texture aliases, blockstate rotations,
and multipart/weighted model choices. Runtime rendering retains element
rotations, UVs, and face tint indices. All textures are bundled locally and
precached by the PWA; no resource requests go to a remote service.

Golden dandelion is absent from the supplied assets and is omitted. The
catalog includes the other 37 requested decorations. Offset rules follow the
supplied `BlockBehaviour.Properties.offsetType` implementation: X/Z use seed
nibbles 0 and 8, Y uses nibble 4, with the dripstone and small-dripleaf limits.

The overlays assist manual alignment. They do not simulate scene occlusion,
biome lighting, water, or animated texture frames. Models use the first frame.
