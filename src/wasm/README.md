# CoordsFinder web search module

`coords_search.c` is a freestanding WebAssembly port of the texture samplers
and brute-force loop in the native CUDA CoordsFinder project. Each local search
worker owns one independent scanner instance; the pool assigns each instance a
disjoint half-open range of the global scan ordinal space.

The worker calls the scanner in short batches and queues the next batch through
`MessageChannel`, avoiding nested-timer clamping while still cooperatively
processing pause and stop messages without WebAssembly threads or shared
memory.

`search_restore` reconstructs the next X/Y/Z cursor from a saved 64-bit
absolute ordinal, including the active compass-direction pass. Each direction
uses precompiled 16-model acceptance masks. Top variants advance by one per
quarter-turn, bottom variants decrease, folded side variants remain unchanged,
and netherrack observations are combined per block. Every captured match
includes its absolute ordinal. The coordinator merges
worker results by that ordinal, so the retained first 1,000 are deterministic
and identical to a monolithic scan even when later shards report first. The
project stores ordinals, counters, and cursors as decimal strings, so a reload
can resume exactly without losing integer precision in JSON.

The current binary was built with Zig 0.15.1's Clang driver:

```sh
zig cc -target wasm32-freestanding -O3 -nostdlib \
  -Wl,--no-entry -Wl,--strip-all \
  -o coords_search.wasm coords_search.c
```
