# CoordsFinder web search module

`coords_search.c` is a freestanding, single-threaded WebAssembly port of the
texture samplers and brute-force loop in the native CUDA CoordsFinder project.
The checked-in `coords_search.wasm` is loaded only by the local search worker.

The worker calls the scanner in short batches. That batching is what lets it
cooperatively process pause and stop messages without WebAssembly threads or
shared memory.

`search_restore` reconstructs the next X/Y/Z cursor from the saved 64-bit
processed-position count, including the active compass-direction pass. Each
direction rotates the filter's X/Z offsets and advances four-state variants by
one per quarter-turn; folded two-state side variants remain unchanged. The
project stores that count, the total match count, and the first 1,000 matches as
decimal strings, so a reload can resume exactly without losing integer
precision in JSON.

The current binary was built with Clang 19:

```sh
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry -Wl,--strip-all \
  -o coords_search.wasm coords_search.c
```
