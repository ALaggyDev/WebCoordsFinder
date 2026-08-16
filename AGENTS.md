# WebCoordsFinder Agent Context

This file is the durable project brief for AI agents working in this repository.
Read it before planning or changing the application.

## Premise

Minecraft selects the visual model variant of certain blocks deterministically
from an absolute world position. Depending on the block and visible face, this
can appear as a rotation or mirror of the texture.

Each observed face constrains the possible world coordinates:

- Top and bottom faces normally expose one of four model states.
- Side faces can fold those four states into two visibly distinct states.
- A useful screenshot normally needs roughly 24 or more independent
  observations to reduce a large search space effectively.

WebCoordsFinder is a local-first browser workbench for collecting and checking
that evidence. It can either export a native CoordsFinder configuration or run
the compatible single-threaded WebAssembly scanner locally in the browser.

## Goal

The application makes the screenshot-analysis and coordinate-search workflow
repeatable without uploading a screenshot or project:

1. Open a screenshot and inspect it with pan and zoom controls.
2. Mark a block-aligned base surface, then build a connected 3D mesh by
   selecting edges and extruding faces.
3. Calibrate the shared perspective and explicitly establish the world-up and
   horizontal axis mapping.
4. Anchor one block, label visible faces, manually confirm their variants or
   review automatic proposals, and configure the search.
5. Run a local background WASM search or download an exact
   `coordsfinder.conf` for the native CPU/CUDA CoordsFinder executable.

Screenshots, project documents, reference comparisons, and browser searches
remain on the current device. Vanilla reference textures and the scanner WASM
are bundled with the application.

## Scope Boundary

The editor deliberately assists a human analyst; it does not infer facts that
require user judgment. It does not currently include:

- Automatic discovery of block boundaries, vanishing points, or geometry from
  an image.
- A fully automatic block classifier.
- Automatic world-up or compass inference.
- GPU/CUDA execution in the browser.

Automatic texture matching is a proposal only. A user must confirm a proposed
variant before it becomes search evidence or is exported.

## User Workflow

The top navigation has three stages:

1. **Geometry** — draw four corners around the first block-aligned surface and
   set its dimensions. The editor saves a planar solve. Select one or more
   exposed edges and use **Extrude** to add connected block faces; sufficient
   non-coplanar observations promote the solve to a shared 3D camera
   projection. Use **Orient** to establish world UP and a horizontal direction,
   and **Anchor** to choose the block represented by `(0, 0, 0)`.
2. **Faces** — select one or more mesh faces; assign a bundled block profile,
   adjust per-block grass tint where supported, inspect a perspective-correct
   crop, and choose a visible variant. The Auto Analyze tab compares eligible
   selected faces with the bundled reference texture off the main thread. Its
   confidence threshold controls which suggestions are proposed; they can be
   reviewed, bulk-confirmed, corrected, or cleared.
3. **Export** — choose the texture algorithm, scan order, optional quarter-turn
   directions, inclusive bounds, error tolerance, and native CPU/CUDA tile
   settings. Review readiness and estimates, run the browser search, or export
   / copy the generated configuration.

Projects are autosaved in IndexedDB. The project library supports multiple
local projects, bundled examples, deletion, and portable `.wcf` project
import/export. Search progress, exact counters, and the first 1,000 browser
search matches are checkpointed with the project and can be resumed when the
search setup is unchanged.

## Geometry and Coordinate Model

The scene is a global integer lattice, not a collection of independent planes.
It stores:

- `MeshFace` entries as a canonical lattice corner plus an abstract local
  normal.
- Weighted `CalibrationObservation` entries mapping lattice corners to image
  points.
- A `PlanarProjection` (base-surface homography) or a fitted `CameraProjection`
  (row-major 3×4 projective matrix), both shared by every face.
- An explicit signed mapping from screenshot-local axes `a`, `b`, and `c` to
  world X/Y/Z labels.

The initial base grid is a resumable planar homography. Extruding from selected
edges adds connected faces and calibration observations. Once the evidence is
well-conditioned, the geometry code fits a camera projection; otherwise it
retains the stable planar solve. Do not reintroduce per-face independent
coordinate systems.

World orientation is intentionally explicit. Establishing UP constrains the
mapping first. The app may preselect one of the four remaining compass
rotations, while choosing a horizontal direction confirms it. Export,
canonical crops, and search require a complete parity-consistent mapping.

### Projected Parity and Right-Handedness

Do not impose a universal cross-product identity on the screenshot-local
`a/b/c` lattice. In particular, neither `A × B = C` nor `A × C = B` is valid
for every screenshot. The lattice was constructed from image observations and
may be reflected relative to the right-handed Minecraft world basis. Its
parity must be recovered from the projection under the assumption that the
source image has not been horizontally or vertically mirrored.

For a complete `AxisMapping`, let `mA`, `mB`, and `mC` be the signed world
vectors assigned to local `+A`, `+B`, and `+C`. Its mapping parity is:

```text
pMapping = sign((mA × mB) · mC)        // either -1 or +1
```

This is implemented by `axisMappingParity`. A complete mapping is physically
valid only when `pMapping` equals the parity recovered from the current scene
projection. `validAxisMappingCompletions` must retain all 48 signed
permutations before this parity filter is applied. Never restore a fixed set of
24 "right-handed" local mappings.

For a camera projection `P = [M | t]`, where `M` is the leading 3×3 matrix and
`q(r)` is the homogeneous depth of a visible reference lattice point `r`, the
scene parity is:

```text
pCamera = sign(det(M) * q(r))
```

All relevant reference depths must be finite, nonzero, and have the same sign.
The depth factor is essential: projective matrices are defined only up to a
nonzero scale. Replacing `P` with `sP` multiplies `det(M) * q(r)` by `s^4`, so
the reported sign is scale invariant. Using `sign(det(M))` alone is wrong.
This calculation is implemented by `cameraLatticeParity`.

A planar homography does not contain the missing out-of-plane camera column,
but the signed camera-facing side supplies the one sign needed for parity. Let
`u` and `v` be the stored lattice basis of the solved plane, `n` the
camera-facing normal of the user-referenced visible face, `H` the homography,
and `q(s,t)` its homogeneous denominator at a point on that face. Then:

```text
k        = sign((u × v) · n)
pPlanar  = -k * sign(det(H) * q(s,t))
         = sign(-((u × v) · n) * det(H) * q(s,t))
```

The minus sign follows from `n` pointing from the plane toward the camera,
using the app's unmirrored camera convention of pixel X right, pixel Y down,
and depth forward. As with the camera matrix, scaling `H` by `s` multiplies
`det(H) * q` by `s^4` and cannot change the result. Flipping the visible-side
normal or mirroring one image axis flips the recovered parity. This calculation
is implemented by `planarLatticeParity`.

`sceneLatticeParity` is the production entry point: it uses camera parity for a
`CameraProjection` and planar parity for a `PlanarProjection`. Planar parity
requires the camera-facing reference face persisted in `worldUpIntent` (or the
face currently being used to establish UP). Degenerate homographies, faces not
on the solved plane, points on/crossing the projective horizon, or a missing
visible-side reference must leave parity unresolved. Do not silently select a
fallback parity in those cases.

The orientation workflow follows these consequences:

- Identifying UP maps one signed local direction to world `+Y`.
- UP plus scene parity leaves four valid mappings, corresponding to the four
  possible compass rotations around Y. The app may choose a stable working
  default, preferring projected north toward the top of the screenshot, but it
  must keep `compassResolved` false and retain search directions
  `[0, 90, 180, 270]` until the user confirms one.
- Once the user maps one directed horizontal arrow to north, east, south, or
  west, scene parity determines the final local axis uniquely.
- A complete mapping whose determinant disagrees with scene parity is invalid,
  even if all three axis labels are populated.

Planar face normals are provisional visible-side choices. On the first
successful promotion to a 3D camera, reorient every face normal toward the
fitted camera, re-derive local UP from `worldUpIntent`, and rebuild the mapping
against camera parity. If either normals or mapping change, invalidate affected
variant evidence rather than preserving a silently mirrored interpretation.

## Evidence, Analysis, and Search Invariants

The generated scanner file uses:

```text
x y z | variant
x y z | variant side
```

Preserve these behaviors:

- Only confirmed evidence with a selected variant is searched or exported.
- Export coordinates are offsets from the explicitly selected anchor and are
  mapped from the local lattice into the confirmed world basis.
- Duplicate block coordinates are removed. When a two-state side observation
  and four-state observation collide, the four-state constraint wins.
- Normal faces use variants `0..3`; folded side evidence uses `0..1` plus the
  `side` suffix.
- Every direct and requested quarter-turn-rotated offset must fit a signed byte
  (`-128..127`), and native CoordsFinder accepts at most 256 filter rows.
- Bounds are inclusive. The selected search-direction list must be non-empty
  and contain unique 0°, 90°, 180°, or 270° entries.
- Unreviewed automatic proposals never enter the filter. Warnings do not block
  a search; validation errors do.

Texture algorithms are chosen directly by the user:

- Minecraft through 1.12.2: `Vanilla-1`
- Minecraft 1.13 through 1.21.1: `Vanilla-2`
- Minecraft 1.21.2 and later: `Vanilla-3`
- Sodium through 4.1: `Sodium-1`
- Sodium 4.2 through 4.8: `Sodium-2`
- Sodium 4.9 and later: use the matching Vanilla algorithm

The local web scanner is a freestanding C-to-WASM port of CoordsFinder's
texture sampling and brute-force loop. `src/workers/search.worker.ts` owns one
scanner instance and runs short adaptive batches so pause and stop commands
remain responsive. It is single-threaded and caps retained result rows at
1,000; total match counts remain exact. Treat the native scanner parity tests
as the compatibility contract when changing this code.

## Current Implementation

This is a React 19 + TypeScript + Vite application:

- `src/App.tsx` — project hydration/autosave, object URLs, keyboard shortcuts,
  project/image import-export, and analysis orchestration.
- `src/components/EditorCanvas.tsx` — Konva image viewport, geometry drafting,
  face/edge selection, extrusion, orientation interactions, and calibration
  handles.
- `src/components/Inspector.tsx` — geometry orientation, face-labeling and
  review controls, scanner settings, and export entry point.
- `src/components/ExportRunDialog.tsx` — readiness/estimate UI, native config
  handoff, and the resumable in-browser search UI.
- `src/store/editorStore.ts` — Zustand document mutations, selection, undo/redo,
  orientation and evidence state. Frequent search-progress updates intentionally
  bypass the undo history.
- `src/domain/geometry.ts` — lattice-face geometry, homographies, camera
  fitting, calibration, axis mapping, and extrusion helpers.
- `src/domain/imageAnalysis.ts` and `src/workers/analyze.worker.ts` —
  perspective unwarping, reference transforms, grass tinting, and normalized
  gradient-based candidate scoring.
- `src/domain/references.ts` — curated supported block profiles and mappings to
  bundled face-correct Minecraft reference PNGs in `public/minecraft`.
- `src/domain/exportConfig.ts` — evidence deduplication, validation, and exact
  native configuration generation.
- `src/domain/webSearch.ts`, `src/workers/search.worker.ts`, and `src/wasm/` —
  browser-search request/checkpoint contracts, worker control, and WASM source.
- `src/storage/db.ts` — Dexie/IndexedDB project and image persistence.
- `src/domain/projectBundle.ts` — zipped `.wcf` bundles with schema validation.
- `src/domain/examples.ts` and `public/examples/` — bundled portable example
  projects.

The PWA service worker precaches the local shell, textures, examples, and WASM
for offline use. Its 4 MiB Workbox precache limit intentionally accommodates
the bundled examples/assets. The production build may still report a
non-blocking large-chunk warning from the canvas/editor dependencies.

## Product and Privacy Constraints

- Do not deploy the application unless the user explicitly asks.
- Keep all screenshot processing, projects, and searches local; do not add any
  server upload path, analytics, or telemetry without explicit approval.
- Preserve the dark, desktop-first forensic-workbench feel.
- Preserve project-bundle compatibility with schema version 1 unless a
  deliberate migration is implemented and tested.

## Development and Verification

```sh
npm install
npm run dev
```

Before handing off a code change, run the checks appropriate to its risk:

```sh
npm test
npm run lint
npm run build
```

For scanner changes, also run the native-reference parity coverage in
`src/domain/webSearch.test.ts`. For persistence or bundle changes, cover
reload/import behavior and validate schema assumptions. For geometry changes,
protect both planar and camera-projection cases.
