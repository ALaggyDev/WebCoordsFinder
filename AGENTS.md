# WebCoordsFinder Agent Context

This file is the durable project brief for AI agents working in this repository.
Read it before planning or changing the application.

## Premise

Minecraft selects the visual model variant of certain blocks deterministically
from the block's absolute world position. Depending on the block and visible
face, this can appear as a rotation or mirror of the texture.

Each observed face therefore constrains the possible world coordinates:

- Top and bottom faces normally expose one of four model states.
- Side faces can fold Minecraft's four model states into two visibly distinct
  states.
- A useful screenshot normally needs roughly 24 or more independent
  observations to reduce a large search space effectively.

The separate native **CoordsFinder** project consumes these observations and
uses CUDA to brute-force candidate world positions. WebCoordsFinder does not
perform that brute-force search.

## Goal

WebCoordsFinder makes the screenshot-analysis stage fast and repeatable in a
local web application:

1. Open a Minecraft screenshot and inspect it with pan and zoom controls.
2. Sketch perspective-aware block planes or individual block faces.
3. Assign relative block coordinates and visible world-facing directions.
4. Label blocks and determine their visible texture/model variant manually or
   with a reviewable image-matching proposal, then export an exact CoordsFinder
   configuration file for the user to run with their local CUDA executable.

Screenshots and projects must remain on the user's device. Vanilla reference
textures are bundled with the application, and there is no server-side image
processing.

## Scope Boundary

The current codebase is an MVP of the browser-side evidence editor. It includes
manual perspective geometry and assisted texture comparison. It does not yet
include:

- Automatic discovery of block boundaries or vanishing points from an image.
- A fully automatic block classifier.
- Automatic compass/world-direction inference.
- CUDA cracking or any other world-coordinate brute force.

Automatic matching is deliberately a proposal, not ground truth. A user must
review proposed variants before they can be exported.

## User Workflow

The top navigation follows four stages:

1. **Image** — open a screenshot.
2. **Grid** — create a four-corner perspective plane, set its row and column
   counts, assign its face direction and relative origin, or hinge a connected
   plane from an existing edge. Choose the Anchor tool and click a face to make
   that block the `(0, 0, 0)` coordinate origin.
3. **Faces** — use the Selection tab to assign block profiles, inspect
   perspective-correct crops, choose visible states, and request automatic
   proposals. Use the nested Auto Analyze tab to set the proposal threshold,
   accept proposals, or open individual faces for correction. Only analyzed
   results meeting the current threshold are marked as proposed. Bundled,
   face-correct vanilla reference PNGs enable automatic comparison. The tab
   contains only analyzed faces, ordered from highest to lowest confidence.
   Clearing it discards analysis metadata and unaccepted results while
   preserving confirmed evidence.
4. **Export** — choose the texture algorithm and search bounds,
   validate the evidence, preview the generated configuration, and download
   `coordsfinder.conf`.

## Geometry and Coordinate Model

A `PerspectivePlane` stores:

- Four image-space corners in top-left, top-right, bottom-right, bottom-left
  order.
- A row and column count.
- The visible Minecraft face direction.
- The relative coordinate of its top-left cell.
- Integer `uAxis` and `vAxis` vectors describing how coordinates change across
  columns and rows.

The relative coordinate of cell `(column, row)` is:

```text
origin + column * uAxis + row * vAxis
```

The canvas computes a homography between the logical rectangular plane and its
four image corners. The same projective transform drives both the drawn grid
and the perspective-correct face crop.

World direction matters. Export remains blocked until the user confirms that
the screenshot's X/Z directions have been resolved. Do not silently invent a
compass direction.

## CoordsFinder Export Invariants

The generated scanner file uses:

```text
x y z | variant
x y z | variant side
```

Preserve these behaviors:

- Only confirmed evidence with a selected variant is exported.
- Evidence coordinates are offsets from the explicitly selected anchor block.
- Duplicate relative coordinates are removed. If both two-state and four-state
  evidence exist for a coordinate, the stronger four-state constraint wins.
- Normal faces use variants `0..3`.
- Folded side evidence uses variants `0..1` and the `side` suffix.
- Relative offsets must fit a signed byte (`-128..127`).
- CoordsFinder accepts at most 256 filter rows.
- Search bounds are inclusive.
- Fewer than 24 unique constraints is a warning, not an error.
- Unreviewed automatic proposals never enter the exported filter.

Texture algorithms are selected directly by the user:

- Minecraft through 1.12.2: `Vanilla-1`
- Minecraft 1.13 through 1.21.1: `Vanilla-2`
- Minecraft 1.21.2 and later: `Vanilla-3`
- Sodium through 4.1: `Sodium-1`
- Sodium 4.2 through 4.8: `Sodium-2`
- Sodium 4.9 and later: use the matching Vanilla algorithm

## Current Implementation

The project is a normal React + TypeScript Vite application:

- `src/components/EditorCanvas.tsx` — Konva image viewport, pan/zoom,
  perspective grids, corner handles, cell selection, and plane drafting.
- `src/components/Inspector.tsx` — stage-specific forms, crop/reference
  comparison, review UI, validation, and configuration preview.
- `src/store/editorStore.ts` — Zustand document state, selection, editing,
  undo/redo, and the current demo document.
- `src/domain/geometry.ts` — homography solving, projection, cell geometry, and
  connected-plane construction.
- `src/domain/imageAnalysis.ts` — perspective unwarping, pixel transforms, and
  normalized-gradient comparison.
- `src/workers/analyze.worker.ts` — off-main-thread candidate scoring.
- `src/domain/references.ts` — curated block metadata and supported face/state
  definitions plus mappings to bundled Minecraft 1.21.11 reference textures.
- `src/domain/exportConfig.ts` — selected texture algorithm output, evidence
  deduplication, validation, strength estimates, and exact config generation.
- `src/storage/db.ts` — local Dexie/IndexedDB persistence.
- `src/domain/projectBundle.ts` — portable zipped `.wcf` project import/export
  with schema validation.
- `src/domain/types.ts` — schema version 1 document and geometry types.

The PWA service worker provides local offline support. The current demo is
`public/demo/demo.png` at 2560 by 1494 pixels.

## Product and Privacy Constraints

- Do not deploy the application unless the user explicitly asks.
- Keep image processing local. Do not upload screenshots.
- Do not add analytics or telemetry without explicit approval.
- The dark, desktop-first interface is intended to feel like a precise forensic
  workbench rather than a generic dashboard.

## Development and Verification

```
npm install
npm run dev
```

Before handing off a code change, run the checks appropriate to its risk:

```
npm test
npm run lint
npm run build
```

The production build currently reports a non-blocking large-chunk warning
because the canvas/editor dependencies are bundled together. The demo PNG also
requires the configured 4 MiB Workbox precache limit.
