// Geometry tests use explicit lattice/image fixtures to pin projective fitting,
// mesh construction, crop orientation, and right-handed axis completion.
import { describe, expect, it } from 'vitest'
import {
  automaticAxisMappingForUp,
  availableExtrusionBlocks,
  axisMappingParity,
  axisMappingFromUpAndHorizontal,
  axisMappingFromReferences,
  blockCoordinateForFace,
  cameraFitDiagnostics,
  cameraCenter,
  cameraFacingNormal,
  cameraLatticeParity,
  cameraInfoMetrics,
  chooseEdgeExtrusion,
  computeHomography,
  createEdgeExtrusionFaces,
  cross3,
  defaultAxesForFace,
  faceForLocalNormal,
  faceNormalIndicator,
  faceQuad,
  faceVertex,
  fitCameraProjection,
  fitHomography,
  isAxisMappingComplete,
  isWorldUpResolved,
  localVectorForWorld,
  mappedVector,
  negate3,
  orientationEdgeGeometry,
  planarLatticeParity,
  possibleFacesForLocalNormal,
  projectCamera,
  projectPoint,
  sceneLatticeParity,
  validAxisMappingCompletions,
  worldAlignedFaceCorners,
} from './geometry'
import type {
  CalibrationObservation,
  Matrix3x4,
  MeshFace,
  PlanarProjection,
  Point2,
  Point3,
  SceneGeometry,
} from './types'

const expectPointClose = (actual: Point2, expected: Point2, precision = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

const face: MeshFace = {
  id: 'base-0-0',
  blockCoordinate: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
}
const cameraMatrix: Matrix3x4 = [
  800, 0, 320, 100,
  0, 700, -100, 200,
  0.1, 0.05, 1, 5,
]

describe('camera image metrics', () => {
  const projection: Matrix3x4 = [
    800, 0, 800, 0,
    0, 900, 450, 0,
    0, 0, 1, 0,
  ]
  const scene: SceneGeometry = {
    faces: [face],
    observations: [
      {
        id: 'in-front-of-camera',
        lattice: { x: 0, y: 0, z: 10 },
        image: { x: 800, y: 450 },
        weight: 1,
      },
    ],
    projection: { kind: 'camera', matrix: projection, rmsError: 0, maxError: 0 },
    axisMapping: { a: 'x+', b: 'y+', c: 'z+' },
  }

  it('derives FOV, focal lengths, and a forward centre ray', () => {
    const metrics = cameraInfoMetrics(scene, { width: 1600, height: 900 }, null)

    expect(metrics?.cameraCenter).toMatchObject({ x: expect.any(Number), y: 0, z: 0 })
    expect(metrics?.cameraCenter.x).toBeCloseTo(0, 6)
    expect(metrics?.horizontalFovDegrees).toBeCloseTo(90, 6)
    expect(metrics?.verticalFovDegrees).toBeCloseTo(53.130102, 6)
    expect(metrics?.focalLengthX).toBeCloseTo(800, 6)
    expect(metrics?.focalLengthY).toBeCloseTo(900, 6)
    expect(metrics?.centerRay).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('keeps camera metrics stable when the projection scale is negated', () => {
    const scaled: SceneGeometry = {
      ...scene,
      projection: {
        kind: 'camera',
        matrix: projection.map((value) => -2 * value) as Matrix3x4,
        rmsError: 0,
        maxError: 0,
      },
    }

    const metrics = cameraInfoMetrics(scaled, { width: 1600, height: 900 }, null)
    expect(metrics?.horizontalFovDegrees).toBeCloseTo(90, 6)
    expect(metrics?.verticalFovDegrees).toBeCloseTo(53.130102, 6)
    expect(metrics?.centerRay).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('maps eye, feet, yaw, and pitch into the anchored world frame', () => {
    const anchorFace: MeshFace = {
      ...face,
      id: 'anchor',
      normal: { x: 0, y: 0, z: -1 },
    }
    const metrics = cameraInfoMetrics(
      { ...scene, faces: [anchorFace] },
      { width: 1600, height: 900 },
      anchorFace.id,
    )

    expect(metrics?.eyePosition).toEqual({ x: 0, y: 0, z: 0 })
    expect(metrics?.feetPosition).toEqual({ x: 0, y: -1.62, z: 0 })
    expect(metrics?.yawDegrees).toBeCloseTo(180, 6)
    expect(metrics?.pitchDegrees).toBeCloseTo(0, 6)
  })

  it('does not invent metrics for a planar or singular camera solve', () => {
    expect(
      cameraInfoMetrics(
        { ...scene, projection: null },
        { width: 1600, height: 900 },
        null,
      ),
    ).toBeUndefined()
    expect(
      cameraInfoMetrics(
        {
          ...scene,
          projection: {
            kind: 'camera',
            matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
            rmsError: 0,
            maxError: 0,
          },
        },
        { width: 1600, height: 900 },
        null,
      ),
    ).toBeUndefined()
  })
})

describe('global perspective geometry', () => {
  it('directs orientation arrows around all four sides of a face', () => {
    expect(
      (['top', 'right', 'bottom', 'left'] as const).map(
        (edge) => orientationEdgeGeometry(face, edge).direction,
      ),
    ).toEqual([
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: -1, y: 0, z: 0 },
    ])
  })

  it('preselects a parity-consistent horizontal frame for a planar UP reference', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'planar',
        origin: { x: 0, y: 0, z: 0 },
        uAxis: { x: 1, y: 0, z: 0 },
        vAxis: { x: 0, y: 1, z: 0 },
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
      worldUpIntent: {
        faceId: face.id,
        surfaceKind: 'top',
        edge: null,
      },
    }

    const mapping = automaticAxisMappingForUp(
      scene,
      face,
      { x: 0, y: 0, z: 1 },
    )!
    expect(mapping).toEqual({ a: 'x+', b: 'z+', c: 'y+' })
    scene.axisMapping = mapping
    expect(sceneLatticeParity(scene)).toBe(-1)
    expect(isAxisMappingComplete(mapping, sceneLatticeParity(scene))).toBe(true)
    expect(worldAlignedFaceCorners(scene, face)).toBeDefined()
    expect(isWorldUpResolved(mapping)).toBe(true)
    expect(localVectorForWorld(mapping, { x: 0, y: 1, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    })
  })

  it('completes horizontal orientation using the fitted camera parity', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: cameraMatrix,
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'y+' },
    }
    expect(
      axisMappingFromUpAndHorizontal(
        scene,
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        'west',
      ),
    ).toEqual({ a: 'x-', b: 'z+', c: 'y+' })
  })

  it.each([
    [{ x: 1, y: 0, z: 0 }, { x: 2, y: 4, z: 5 }],
    [{ x: -1, y: 0, z: 0 }, { x: 3, y: 4, z: 5 }],
    [{ x: 0, y: 1, z: 0 }, { x: 3, y: 3, z: 5 }],
    [{ x: 0, y: -1, z: 0 }, { x: 3, y: 4, z: 5 }],
    [{ x: 0, y: 0, z: 1 }, { x: 3, y: 4, z: 4 }],
    [{ x: 0, y: 0, z: -1 }, { x: 3, y: 4, z: 5 }],
  ] satisfies [Point3, Point3][])(
    'derives the owning block coordinate for face normal %o',
    (normal, expected) => {
      expect(
        blockCoordinateForFace({
          id: 'coordinate',
          blockCoordinate: { x: 3, y: 4, z: 5 },
          normal,
        }),
      ).toEqual(expected)
    },
  )

  it('assigns perpendicular faces of one block the same coordinate', () => {
    const blockCoordinate = { x: 7, y: -2, z: 11 }
    const side: MeshFace = {
      id: 'side',
      blockCoordinate: { ...blockCoordinate, x: blockCoordinate.x + 1 },
      normal: { x: 1, y: 0, z: 0 },
    }
    const top: MeshFace = {
      id: 'top',
      blockCoordinate: { ...blockCoordinate, z: blockCoordinate.z + 1 },
      normal: { x: 0, y: 0, z: 1 },
    }

    expect(blockCoordinateForFace(side)).toEqual(blockCoordinate)
    expect(blockCoordinateForFace(top)).toEqual(blockCoordinate)
  })

  it('maps all four planar corners through a homography', () => {
    const source: [Point2, Point2, Point2, Point2] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ]
    const destination: [Point2, Point2, Point2, Point2] = [
      { x: 12, y: 8 },
      { x: 94, y: 14 },
      { x: 76, y: 82 },
      { x: 20, y: 68 },
    ]
    const transform = computeHomography(source, destination)
    source.forEach((point, index) => {
      expectPointClose(projectPoint(transform, point), destination[index])
    })
  })

  it('projects adjacent unit faces with a shared edge', () => {
    const right: MeshFace = {
      ...face,
      id: 'base-1-0',
      blockCoordinate: { x: 1, y: 0, z: 0 },
    }
    const scene: SceneGeometry = {
      faces: [face, right],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: cameraMatrix,
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'x+', b: 'z-', c: 'y+' },
    }
    const leftQuad = faceQuad(scene, face)!
    const rightQuad = faceQuad(scene, right)!
    expectPointClose(leftQuad[1], rightQuad[0])
    expectPointClose(leftQuad[2], rightQuad[3])
    expect(faceVertex(face, 1, 1)).toEqual({ x: 1, y: 1, z: 0 })
  })

  it('projects visible-side normals from the fitted camera', () => {
    const cameraScene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: [100, 0, 20, 0, 0, 100, -10, 0, 0, 0, 0, 1],
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const front = faceNormalIndicator(cameraScene, face)!
    const back = faceNormalIndicator(cameraScene, {
      ...face,
      normal: { x: 0, y: 0, z: -1 },
    })!

    expectPointClose(back.direction, {
      x: -front.direction.x,
      y: -front.direction.y,
    })
    expectPointClose(front.direction, {
      x: 2 / Math.sqrt(5),
      y: -1 / Math.sqrt(5),
    })
  })

  // Homography remains a draft-grid primitive; committed calibration requires
  // non-coplanar camera observations.
  it('fits a homography from more than four planar observations', () => {
    const expected = computeHomography(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
      [
        { x: 100, y: 100 },
        { x: 500, y: 120 },
        { x: 480, y: 500 },
        { x: 120, y: 470 },
      ],
    )
    const source = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
    ]
    const fitted = fitHomography(
      source,
      source.map((point) => projectPoint(expected, point)),
    )

    source.forEach((point) => {
      expectPointClose(projectPoint(fitted, point), projectPoint(expected, point), 4)
    })
  })

  it('fits a camera from six non-coplanar observations', () => {
    const expected: Matrix3x4 = [
      800, 0, 320, 100,
      0, 700, -100, 200,
      0.1, 0.05, 1, 5,
    ]
    const latticePoints = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
    ]
    const observations: CalibrationObservation[] = latticePoints.map(
      (lattice, index) => ({
        id: String(index),
        lattice,
        image: projectCamera(expected, lattice),
        weight: 1,
      }),
    )
    const fitted = fitCameraProjection(observations)
    expect(fitted.rmsError).toBeLessThan(0.05)
    expect(cameraFitDiagnostics(fitted, { x: 2, y: 1, z: 0 })).toMatchObject({
      finite: true,
    })
    expect(
      cameraFitDiagnostics(fitted, { x: 2, y: 1, z: 0 }).minAxisLength,
    ).toBeGreaterThan(0.25)
    expectPointClose(
      projectCamera(fitted.matrix, { x: 2, y: 1, z: 4 }),
      projectCamera(expected, { x: 2, y: 1, z: 4 }),
      1,
    )
  })

  it.each([4, 16, 64])(
    'refits an exact camera without lattice-scale bias at size %i',
    (gridSize) => {
      const latticePoints = [
        { x: 0, y: 0, z: 0 },
        { x: gridSize, y: 0, z: 0 },
        { x: gridSize, y: gridSize, z: 0 },
        { x: 0, y: gridSize, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ]
      const observations: CalibrationObservation[] = latticePoints.map(
        (lattice, index) => ({
          id: String(index),
          lattice,
          image: projectCamera(cameraMatrix, lattice),
          weight: 1,
        }),
      )

      const fitted = fitCameraProjection(observations)

      expect(fitted.rmsError).toBeLessThan(1e-4)
      observations.forEach((observation) => {
        expectPointClose(
          projectCamera(fitted.matrix, observation.lattice),
          observation.image,
          4,
        )
      })
    },
  )

  it('creates one stored face per selected edge and depth block', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: [800, 0, 320, 100, 0, 700, -100, 200, 0.1, 0.05, 1, 5],
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const created = createEdgeExtrusionFaces(
      scene,
      [{ faceId: face.id, edge: 'top' }],
      { x: 0, y: 0, z: 1 },
      3,
      () => crypto.randomUUID(),
    )
    expect(created).toHaveLength(3)
    expect(created.map((entry) => entry.blockCoordinate.z)).toEqual([0, 1, 2])
  })

  it.each([
    ['top', { x: 0, y: -1, z: 0 }],
    ['right', { x: 1, y: 0, z: 0 }],
    ['bottom', { x: 0, y: 1, z: 0 }],
    ['left', { x: -1, y: 0, z: 0 }],
  ] as const)(
    'inherits the source normal for a coplanar %s-edge extension',
    (edge, axis) => {
      const scene: SceneGeometry = {
        faces: [face],
        observations: [],
        projection: { kind: 'camera', matrix: cameraMatrix, rmsError: 0, maxError: 0 },
        axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
      }

      const [created] = createEdgeExtrusionFaces(
        scene,
        [{ faceId: face.id, edge }],
        axis,
        1,
        () => edge,
      )

      expect(created.normal).toEqual(face.normal)
    },
  )

  // Extrusion selection covers camera snapping, negative normalization, and
  // preservation of the source face's visible side.
  it('preserves a manually flipped source normal during coplanar extension', () => {
    const flipped = { ...face, normal: { x: 0, y: 0, z: -1 } }
    const scene: SceneGeometry = {
      faces: [flipped],
      observations: [],
      projection: { kind: 'camera', matrix: cameraMatrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    const [created] = createEdgeExtrusionFaces(
      scene,
      [{ faceId: face.id, edge: 'top' }],
      { x: 0, y: -1, z: 0 },
      1,
      () => 'flipped-extension',
    )

    expect(created.normal).toEqual(flipped.normal)
  })

  it('orients a hinged face toward the fitted camera', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: [
          100, 0, 0, -50,
          0, 100, 0, -500,
          0, 0, 1, -5,
        ],
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    expect(cameraCenter(scene)).toEqual({ x: 0.5, y: 5, z: 5 })
    const [created] = createEdgeExtrusionFaces(
      scene,
      [{ faceId: face.id, edge: 'top' }],
      { x: 0, y: 0, z: 1 },
      1,
      () => 'hinged',
    )

    expect(created.normal).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('chooses extrusion direction and block count from the pointer', () => {
    const matrix: Matrix3x4 = [
      800, 0, 320, 100,
      0, 700, -100, 200,
      0.1, 0.05, 1, 5,
    ]
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: { kind: 'camera', matrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const selection = [{ faceId: face.id, edge: 'top' as const }]
    expect(
      chooseEdgeExtrusion(
        scene,
        selection,
        projectCamera(matrix, { x: 0.5, y: 0, z: 4 }),
      ),
    ).toEqual({
      axis: { x: 0, y: 0, z: 1 },
      blocks: 4,
      createsAxis: false,
    })
  })

  it('rejects an extrusion direction that would recreate the selected face', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: { kind: 'camera', matrix: cameraMatrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    // The top edge's +Y side is inside this Z-facing source square.
    expect(
      availableExtrusionBlocks(
        scene,
        [{ faceId: face.id, edge: 'top' }],
        { x: 0, y: 1, z: 0 },
      ),
    ).toBe(0)
  })

  it('stops an extrusion before it overlaps a distant existing face', () => {
    const blockingFace: MeshFace = {
      id: 'distant-face',
      // This is the fifth unit square that a +Z extrusion from the top edge
      // would create. Its opposite visible normal still occupies the surface.
      blockCoordinate: { x: 0, y: 0, z: 4 },
      normal: { x: 0, y: 1, z: 0 },
    }
    const scene: SceneGeometry = {
      faces: [face, blockingFace],
      observations: [],
      projection: { kind: 'camera', matrix: cameraMatrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    expect(
      availableExtrusionBlocks(
        scene,
        [{ faceId: face.id, edge: 'top' }],
        { x: 0, y: 0, z: 1 },
      ),
    ).toBe(4)
  })

  it('normalizes a negative extrusion to the adjacent block coordinate', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: [800, 0, 320, 100, 0, 700, -100, 200, 0.1, 0.05, 1, 5],
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const [created] = createEdgeExtrusionFaces(
      scene,
      [{ faceId: face.id, edge: 'top' }],
      { x: 0, y: -1, z: 0 },
      1,
      () => 'negative',
    )

    expect(created).toEqual({
      id: 'negative',
      blockCoordinate: { x: 0, y: -1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    })
  })

  it('world-aligns top crops independently of extrusion direction and visible-side flips', () => {
    const scene: SceneGeometry = {
      faces: [],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: [800, 0, 320, 100, 0, 700, -100, 200, 0.1, 0.05, 1, 5],
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'x+', b: 'z-', c: 'y+' },
    }
    const topFromPositiveExtrusion: MeshFace = {
      id: 'positive',
      blockCoordinate: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    }
    const topAfterNegativeExtrusionAndFlip: MeshFace = {
      id: 'negative-flipped',
      blockCoordinate: { x: 0, y: -1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    }

    expect(worldAlignedFaceCorners(scene, topFromPositiveExtrusion)).toEqual([
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ])
    expect(worldAlignedFaceCorners(scene, topAfterNegativeExtrusionAndFlip)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 0, y: -1, z: 0 },
    ])
  })

  it.each([
    ['north', { x: 0, y: 0, z: -1 }, { x: -1, y: 0, z: 0 }],
    ['south', { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }],
    ['east', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }],
    ['west', { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
  ] as const)(
    'uses a non-reflected right/down crop basis for the %s face',
    (direction, normal, expectedUAxis) => {
      const axes = defaultAxesForFace(direction)

      expect(axes).toEqual({
        uAxis: expectedUAxis,
        vAxis: { x: 0, y: -1, z: 0 },
      })
      // Screen-right crossed with screen-down points into the block.
      const inward = cross3(axes.uAxis, axes.vAxis)
      const expectedInward = negate3(normal)
      expect(inward.x).toBeCloseTo(expectedInward.x)
      expect(inward.y).toBeCloseTo(expectedInward.y)
      expect(inward.z).toBeCloseTo(expectedInward.z)
    },
  )

  // Partial mappings remain useful for UI hints, but projected parity is
  // required before a complete mapping is considered physically resolved.
  it('keeps partial and complete world-axis mappings distinct', () => {
    const partial = { a: 'x+' as const, b: 'unknown' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(partial, -1)).toBe(false)
    expect(faceForLocalNormal(partial, { x: 0, y: 0, z: 1 })).toBe('up')

    const complete = { a: 'x+' as const, b: 'z+' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(complete, -1)).toBe(true)
    expect(isAxisMappingComplete(complete, 1)).toBe(false)
    expect(mappedVector(complete, { x: 2, y: 3, z: 4 })).toEqual({
      x: 2,
      y: 4,
      z: 3,
    })
  })

  it('uses camera parity to determine C after A and B are known', () => {
    const partial = {
      a: 'x+' as const,
      b: 'z+' as const,
      c: 'unknown' as const,
    }
    const negativeParity = { a: 'x+' as const, b: 'z+' as const, c: 'y+' as const }
    const positiveParity = { a: 'x+' as const, b: 'z+' as const, c: 'y-' as const }

    expect(validAxisMappingCompletions(partial)).toEqual([
      negativeParity,
      positiveParity,
    ])
    expect(validAxisMappingCompletions(partial, -1)).toEqual([negativeParity])
    expect(validAxisMappingCompletions(partial, 1)).toEqual([positiveParity])
    expect(axisMappingParity(negativeParity)).toBe(-1)
    expect(axisMappingParity(positiveParity)).toBe(1)
  })

  it('keeps the same horizontal axes across top and bottom camera views', () => {
    expect(
      validAxisMappingCompletions(
        { a: 'x+', b: 'unknown', c: 'y+' },
        -1,
      ),
    ).toContainEqual({ a: 'x+', b: 'z+', c: 'y+' })
    expect(
      validAxisMappingCompletions(
        { a: 'x+', b: 'unknown', c: 'y-' },
        1,
      ),
    ).toContainEqual({ a: 'x+', b: 'z+', c: 'y-' })
  })

  it('derives a projective-scale-invariant parity from the camera', () => {
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: { kind: 'camera', matrix: cameraMatrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const negated: SceneGeometry = {
      ...scene,
      projection: {
        kind: 'camera',
        matrix: cameraMatrix.map((value) => -value) as Matrix3x4,
        rmsError: 0,
        maxError: 0,
      },
    }

    expect(cameraLatticeParity(scene)).toBe(1)
    expect(cameraLatticeParity(negated)).toBe(1)
  })

  it('derives scale-invariant planar parity from winding and visible side', () => {
    const projection: PlanarProjection = {
      kind: 'planar',
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
      cornerLattice: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection,
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
      worldUpIntent: { faceId: face.id, surfaceKind: 'top', edge: null },
    }
    const negated: SceneGeometry = {
      ...scene,
      projection: {
        ...projection,
        homography: [-1, 0, 0, 0, -1, 0, 0, 0, -1],
      },
    }
    const mirrored: SceneGeometry = {
      ...scene,
      projection: {
        ...projection,
        homography: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    }
    const oppositeSide: SceneGeometry = {
      ...scene,
      faces: [{ ...face, normal: negate3(face.normal) }],
    }

    expect(planarLatticeParity(scene)).toBe(-1)
    expect(planarLatticeParity(negated)).toBe(-1)
    expect(planarLatticeParity(mirrored)).toBe(1)
    expect(planarLatticeParity(oppositeSide)).toBe(1)
  })

  it('matches planar winding parity to the full camera on the same plane', () => {
    const cameraScene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'camera',
        matrix: cameraMatrix,
        rmsError: 0,
        maxError: 0,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const visibleFace = {
      ...face,
      normal: cameraFacingNormal(cameraScene, face),
    }
    const planarScene: SceneGeometry = {
      faces: [visibleFace],
      observations: [],
      projection: {
        kind: 'planar',
        origin: { x: 0, y: 0, z: 0 },
        uAxis: { x: 1, y: 0, z: 0 },
        vAxis: { x: 0, y: 1, z: 0 },
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        homography: [800, 0, 100, 0, 700, 200, 0.1, 0.05, 5],
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
      worldUpIntent: {
        faceId: visibleFace.id,
        surfaceKind: 'top',
        edge: null,
      },
    }

    expect(planarLatticeParity(planarScene)).toBe(
      cameraLatticeParity(cameraScene),
    )
  })

  it('keeps horizontal axes consistent across planar top and bottom views', () => {
    const projection: PlanarProjection = {
      kind: 'planar',
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
      cornerLattice: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }
    const top: SceneGeometry = {
      faces: [face],
      observations: [],
      projection,
      axisMapping: { a: 'unknown', b: 'unknown', c: 'y+' },
      worldUpIntent: { faceId: face.id, surfaceKind: 'top', edge: null },
    }
    const bottom: SceneGeometry = {
      ...top,
      projection: {
        ...projection,
        homography: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'y-' },
      worldUpIntent: { faceId: face.id, surfaceKind: 'bottom', edge: null },
    }

    expect(
      axisMappingFromUpAndHorizontal(
        top,
        face.normal,
        { x: 1, y: 0, z: 0 },
        'east',
      ),
    ).toEqual({ a: 'x+', b: 'z+', c: 'y+' })
    expect(
      axisMappingFromUpAndHorizontal(
        bottom,
        negate3(face.normal),
        { x: 1, y: 0, z: 0 },
        'east',
      ),
    ).toEqual({ a: 'x+', b: 'z+', c: 'y-' })
  })

  it('derives the remaining axis from references and camera parity', () => {
    expect(
      axisMappingFromReferences(
        { x: 0, y: 0, z: 1 },
        'up',
        { x: 1, y: 0, z: 0 },
        'east',
        -1,
      ),
    ).toEqual({ a: 'x+', b: 'z+', c: 'y+' })

    expect(
      axisMappingFromReferences(
        { x: 0, y: 0, z: 1 },
        'up',
        { x: 1, y: 0, z: 0 },
        'east',
        1,
      ),
    ).toEqual({ a: 'x+', b: 'z-', c: 'y+' })

    expect(
      axisMappingFromReferences(
        { x: 0, y: 0, z: 1 },
        'up',
        { x: 1, y: 0, z: 0 },
        'down',
        1,
      ),
    ).toBeUndefined()
  })

  it('reports every face still possible under a partial mapping', () => {
    const mapping = {
      a: 'unknown' as const,
      b: 'unknown' as const,
      c: 'y+' as const,
    }

    expect(possibleFacesForLocalNormal(mapping, { x: 0, y: 0, z: 1 })).toEqual([
      'up',
    ])
    expect(
      new Set(possibleFacesForLocalNormal(mapping, { x: 1, y: 0, z: 0 })),
    ).toEqual(new Set(['north', 'south', 'east', 'west']))
  })
})
