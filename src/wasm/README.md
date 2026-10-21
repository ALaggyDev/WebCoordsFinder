# Unified coordinate search

`coords_search.c` is one freestanding WASM engine for texture-only, offset-only,
and combined searches. Java overflow, seed generation, and texture model
sampling remain compatible with native CoordsFinder's reference vectors.

Texture-only searches use the configured linear, spiral, or reverse-spiral
traversal. Active offsets enable an exact low-bit X/Z lifting traversal instead.
Both constraint families are compiled for the same anchor and compass rotation.
Offsets are strict; mismatch tolerance applies only to texture constraints.
Offset seeds use world Y=0; XYZ offset Y is a displacement seed nibble, not a
constraint on absolute world Y. With no texture evidence, Y is unconstrained.

The lifting traversal visits low X/Z bits first. Its base-four ordinal describes
a path through a signed lattice containing the inclusive bounds. At the supported
world border of +/-30,000,000, this needs at most 26 coordinate bits. Low seed
bits prune impossible prefixes; a final full seed check includes remaining bits.
Clipped observations accept every seed nibble producing the measured endpoint.

Offset nibbles begin at raw seed bit 16, so wide bounds still require billions
of low-bit prefixes before the evidence can prune them. The engine caches
validated shared prefixes and exact X/Z checks across Y. Nibble projections are
precomputed bit masks rather than per-candidate loops. At depth 16 it also
intersects the two possible seed-bit toggles across observations before expanding
four children: the next X/Z bits toggle seed bit 16 by their XOR. This rejects
inconsistent parents one level earlier without changing results or their order.

Failed prefixes advance the ordinal past their entire subtree, including Y.
Every batch has a bounded number of traversal operations. A worker's ordinal,
final match count, and intermediate offset count suffice to restore it, even
when a shard boundary splits a subtree or a surviving candidate's Y loop.
The intermediate count measures X/Z-and-direction pairs passing all offsets,
including those with no texture match at any Y. The shard owning the first Y
ordinal counts that pair once. Traversal coverage includes pruned branches and
is not a count of evaluated coordinates or a linear estimate of time remaining.

Each worker owns its own instance. The coordinator retains the global first
1,000 final matches by traversal ordinal while counts remain exact. Checkpoints
use decimal strings for all 64-bit counters, and engine version 7 invalidates
older search checkpoints. Project schema remains 1.

Build in WSL with Clang:

```sh
clang --target=wasm32-unknown-unknown -O3 -nostdlib \
  -Wl,--no-entry -Wl,--strip-all -o coords_search.wasm coords_search.c
```

`src/domain/offsetSearch.test.ts` compares combined results against exhaustive
texture scans intersected with an independent BigInt offset oracle. Native
texture compatibility remains covered by `src/domain/webSearch.test.ts`.

Reproduce offset performance with fixed synthetic evidence:

```sh
node scripts/benchmark-offset-search.mjs
node scripts/benchmark-offset-search.mjs --full --workers=8
```

The default run samples wide searches; `--full` covers inclusive +/-30,000,000
bounds with seven XZ offsets, one direction, and no textures. An optional WASM
path before the flags allows comparison with a saved engine. Full timings use
Node worker threads and omit browser/UI overhead; evidence and hardware affect
runtime. The engine ABI, traversal ordinals, and checkpoint version are unchanged.
