# CoordsFinder Metal for Apple silicon

`coordsfinder-metal` is a native command-line scanner for M-series Macs. It
accepts the same `coordsfinder.conf` exported by WebCoordsFinder and runs all
five supported texture algorithms in a Metal compute kernel.

## Requirements

- Apple-silicon Mac (M1 or newer)
- macOS 13 or newer
- Swift 6 toolchain to build (Xcode or the Xcode command-line tools)

The release executable is arm64 and self-contained. It compiles its embedded
Metal kernel for the current GPU at startup, so the copied binary does not need
a separate `.metallib` or resource bundle.

## Build

From the WebCoordsFinder repository root:

```sh
./scripts/build_macos_metal.sh
```

The optimized executable is written to:

```text
native/macos-metal/dist/coordsfinder-metal
```

You can also build and test the package directly:

```sh
swift build --package-path native/macos-metal --configuration release --arch arm64
swift test --package-path native/macos-metal
```

## Run

Export a config from WebCoordsFinder, then pass it to the scanner:

```sh
./native/macos-metal/dist/coordsfinder-metal ./coordsfinder.conf
```

Useful options:

```text
-e, --validate              Validate and summarize without scanning
    --batch-work-items N    Override the initial GPU batch size
    --quiet-progress        Print only matches and the final summary
    --no-lattice-gate       Disable the exact 2x2 Metal prefilter
```

The checked-in example scans about 244 million positions:

```sh
./native/macos-metal/dist/coordsfinder-metal native/macos-metal/example.conf
```

Ranges are inclusive, matching WebCoordsFinder's export and in-browser search
contract.

## Scan order and performance

Use `scanOrder = linear` unless you specifically need a center-out search. It
is the WebCoordsFinder default and enables the lattice-gate optimization for
compatible exact, single-direction searches. On the tested M4 MacBook Air and
configuration, linear reached 18.5 Gpos/s versus 6.7 Gpos/s for spiral: about
2.8x, or roughly 3x, the throughput. Other chips and filters will vary.

Spiral can still be useful when the expected coordinate is near the center of
the selected bounds, because it may encounter that coordinate earlier even
though its overall throughput is lower.

## Implementation notes

- A Metal thread owns up to 128 adjacent Y candidates. Typical Minecraft
  height ranges therefore share one X/Z and direction setup across the entire
  vertical column, while the enormous X/Z grid still provides ample GPU
  parallelism.
- The selected texture mode is a Metal function constant. Pipeline creation
  specializes away the algorithm switch in the search hot loop.
- Exact searches use a separately specialized hot path. Its first constraint
  reuses the X/Z coordinate seed across the thread's adjacent Y candidates;
  tolerant searches retain the mismatch-counting kernel.
- Directional filters are transformed once on the CPU and uploaded to Metal's
  constant address space.
- Exact, linear, single-direction searches automatically look for four
  four-state constraints with the same variant that cover every X/Z parity
  class. When found, the Metal lattice-gate path hashes one shared coordinate
  for four candidate origins, rejects the group together on a mismatch, and
  compacts the surviving Y positions before full verification. Unsupported
  configs use the baseline kernel without changing their results.
- Result buffers use Apple silicon's shared memory. If a batch produces more
  matches than the buffer can hold, the host halves and retries the batch so
  matches are never silently lost.
- Threadgroup width is selected from the compiled pipeline's
  `threadExecutionWidth` and `maxTotalThreadsPerThreadgroup` values.

The parity tests execute the Metal kernel for Vanilla-1/2/3 and Sodium-1/2
against the same native CoordsFinder reference vectors used by the browser WASM
scanner. They also pin spiral and multi-direction traversal order.
