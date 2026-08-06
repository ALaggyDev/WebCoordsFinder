// Geometry tests use explicit lattice/image fixtures to pin projective fitting,
// mesh construction, crop orientation, and right-handed axis completion.
import { describe, expect, it } from 'vitest'
import {
  automaticAxisMappingForUp,
  availableExtrusionBlocks,
  axisMappingFromUpAndHorizontal,
  axisMappingFromReferences,
  blockCoordinateForFace,
  cameraFitDiagnostics,
  cameraCenter,
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
  possibleFacesForLocalNormal,
  projectCamera,
  projectPoint,
  validAxisMappingCompletions,
  worldAlignedFaceCorners,
} from './geometry'
import type {
  CalibrationObservation,
  Matrix3x4,
  MeshFace,
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

  it('chooses one stable screen-forward horizontal completion after UP is known', () => {
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
    }

    const mapping = automaticAxisMappingForUp(
      scene,
      face,
      { x: 0, y: 0, z: 1 },
    )!
    expect(mapping).toEqual({ a: 'x+', b: 'z+', c: 'y+' })
    expect(isWorldUpResolved(mapping)).toBe(true)
    expect(localVectorForWorld(mapping, { x: 0, y: 1, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    })
  })

  it('completes horizontal orientation from UP and one horizontal arrow', () => {
    expect(
      axisMappingFromUpAndHorizontal(
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        'west',
      ),
    ).toEqual({ a: 'x-', b: 'z-', c: 'y+' })
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
      axisMapping: { a: 'x+', b: 'z+', c: 'y+' },
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
      axisMapping: { a: 'x+', b: 'z+', c: 'y+' },
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
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ])
    expect(worldAlignedFaceCorners(scene, topAfterNegativeExtrusionAndFlip)).toEqual([
      { x: 0, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
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

  // Partial mappings remain useful for UI hints, but only one right-handed
  // completion is considered a resolved world orientation.
  it('keeps partial and complete world-axis mappings distinct', () => {
    const partial = { a: 'x+' as const, b: 'unknown' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(partial)).toBe(false)
    expect(faceForLocalNormal(partial, { x: 0, y: 0, z: 1 })).toBe('up')

    const complete = { a: 'x+' as const, b: 'z+' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(complete)).toBe(true)
    expect(mappedVector(complete, { x: 2, y: 3, z: 4 })).toEqual({
      x: 2,
      y: 4,
      z: 3,
    })
  })

  it('completes a partial mapping using A cross C equals B', () => {
    const partial = {
      a: 'x+' as const,
      b: 'unknown' as const,
      c: 'y+' as const,
    }
    const opposite = { a: 'x+' as const, b: 'z-' as const, c: 'y+' as const }
    const proper = { a: 'x+' as const, b: 'z+' as const, c: 'y+' as const }

    expect(validAxisMappingCompletions(partial)).toEqual([proper])
    expect(isAxisMappingComplete(opposite)).toBe(false)
    expect(isAxisMappingComplete(proper)).toBe(true)
  })

  it('infers negative X to the right of positive Z when C is up', () => {
    const partial = {
      a: 'z+' as const,
      b: 'unknown' as const,
      c: 'y+' as const,
    }

    expect(validAxisMappingCompletions(partial)).toEqual([
      { a: 'z+', b: 'x-', c: 'y+' },
    ])
  })

  it('derives a complete right-handed mapping from a face and directed edge', () => {
    expect(
      axisMappingFromReferences(
        { x: 0, y: 0, z: 1 },
        'up',
        { x: 1, y: 0, z: 0 },
        'east',
      ),
    ).toEqual({ a: 'x+', b: 'z+', c: 'y+' })

    expect(
      axisMappingFromReferences(
        { x: 0, y: 0, z: 1 },
        'up',
        { x: 1, y: 0, z: 0 },
        'down',
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
