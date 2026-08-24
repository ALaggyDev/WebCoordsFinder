# CoordsFinder web search module

`coords_search.c` is a freestanding WebAssembly port of the texture samplers
and brute-force loop in the native CUDA CoordsFinder project. Each local search
worker owns one independent scanner instance; the pool assigns each instance a
disjoint half-open range of the global scan ordinal space.

Zero-error searches load one of the five algorithm-specific `*_exact.wasm`
modules. Their texture mode and tolerance are compile-time constants, allowing
Clang to remove the per-filter mode switch and mismatch counter. Searches with
a nonzero error tolerance use the generic `coords_search.wasm` module. Every
module processes the innermost Y run with cursor and counter state in locals,
then commits the resumable cursor at a run or batch boundary.

The worker calls the scanner in short batches and queues the next batch through
`MessageChannel`, avoiding nested-timer clamping while still cooperatively
processing pause and stop messages without WebAssembly threads or shared
memory.

`search_restore` reconstructs the next X/Y/Z cursor from a saved 64-bit
absolute ordinal, including the active compass-direction pass. Each
direction rotates the filter's X/Z offsets and advances four-state variants by
one per quarter-turn; folded two-state side variants remain unchanged. The
Every captured match includes its absolute ordinal. The coordinator merges
worker results by that ordinal, so the retained first 1,000 are deterministic
and identical to a monolithic scan even when later shards report first. The
project stores ordinals, counters, and cursors as decimal strings, so a reload
can resume exactly without losing integer precision in JSON.

Vanilla-3 zero-error searches can go one step further. The coordinator
generates a request-specific kernel locally (`src/domain/searchKernel.ts`),
compiles it once, and structured-clones the `WebAssembly.Module` to every shard
worker. `coords_search_vanilla_3_host.wasm` imports that kernel as
`wcf.scan_run` and keeps this file's traversal, cursor, ordinal, capture, and
checkpoint bookkeeping, so the exported scanner ABI is identical. The kernel
evaluates up to `GENERATED_RUN_CHUNK` contiguous Y positions at a fixed
X/Z/direction and returns a match bitmask; its filter offsets, expected
rotations, visible masks, and filter count are emitted as constants inside an
unrolled early-rejection chain. Generation, validation, compilation, transfer,
signature verification, or instantiation failing all fall back silently to
`coords_search_vanilla_3_exact.wasm`.

All seven checked-in binaries are built with Zig 0.15.1's Clang driver:

```sh
npm run build:wasm
```

If Zig is not on `PATH`, set `WCF_ZIG` to the Zig 0.15.1 executable. The build
script rejects other compiler versions so regenerated binaries remain
reproducible.
