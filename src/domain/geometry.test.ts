import { describe, expect, it } from 'vitest'
import {
  chooseEdgeExtrusion,
  computeHomography,
  createEdgeExtrusionFaces,
  faceForLocalNormal,
  faceQuad,
  faceVertex,
  fitCameraProjection,
  isAxisMappingComplete,
  mappedVector,
  projectCamera,
  projectPoint,
  worldAlignedFaceCorners,
} from './geometry'
import type {
  CalibrationObservation,
  Matrix3x4,
  MeshFace,
  Point2,
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
const planeU = { x: 1, y: 0, z: 0 }
const planeV = { x: 0, y: 1, z: 0 }

describe('global perspective geometry', () => {
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
    const homography = computeHomography(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
      [{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 90, y: 80 }, { x: 20, y: 70 }],
    )
    const scene: SceneGeometry = {
      faces: [face, right],
      observations: [],
      projection: {
        kind: 'planar',
        origin: { x: 0, y: 0, z: 0 },
        uAxis: planeU,
        vAxis: planeV,
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 3, z: 0 },
          { x: 0, y: 3, z: 0 },
        ],
        homography,
      },
      axisMapping: { a: 'x+', b: 'z+', c: 'y+' },
    }
    const leftQuad = faceQuad(scene, face)!
    const rightQuad = faceQuad(scene, right)!
    expectPointClose(leftQuad[1], rightQuad[0])
    expectPointClose(leftQuad[2], rightQuad[3])
    expect(faceVertex(face, 1, 1)).toEqual({ x: 1, y: 1, z: 0 })
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

  it('keeps a first extrusion in the plane when the pointer is near it', () => {
    const homography = computeHomography(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
      [{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 90, y: 80 }, { x: 20, y: 70 }],
    )
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'planar',
        origin: face.blockCoordinate,
        uAxis: planeU,
        vAxis: planeV,
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 3, z: 0 },
          { x: 0, y: 3, z: 0 },
        ],
        homography,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const pointer = projectPoint(homography, { x: 0.5, y: -3 })

    expect(
      chooseEdgeExtrusion(
        scene,
        [{ faceId: face.id, edge: 'top' }],
        pointer,
      ),
    ).toEqual({
      axis: { x: 0, y: -1, z: 0 },
      blocks: 3,
      createsAxis: false,
    })
  })

  it('uses the face normal when a first extrusion leaves the plane', () => {
    const homography = computeHomography(
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
      [{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 90, y: 80 }, { x: 20, y: 70 }],
    )
    const scene: SceneGeometry = {
      faces: [face],
      observations: [],
      projection: {
        kind: 'planar',
        origin: face.blockCoordinate,
        uAxis: planeU,
        vAxis: planeV,
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 3, z: 0 },
          { x: 0, y: 3, z: 0 },
        ],
        homography,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    expect(
      chooseEdgeExtrusion(
        scene,
        [{ faceId: face.id, edge: 'top' }],
        { x: 250, y: 250 },
      ),
    ).toEqual({
      axis: face.normal,
      blocks: 1,
      createsAxis: true,
    })
  })

  it('uses the most recently selected edge for pointer distance', () => {
    const laterFace: MeshFace = {
      ...face,
      id: 'later',
      blockCoordinate: { x: 0, y: 5, z: 0 },
    }
    const homography = computeHomography(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
    )
    const scene: SceneGeometry = {
      faces: [face, laterFace],
      observations: [],
      projection: {
        kind: 'planar',
        origin: face.blockCoordinate,
        uAxis: planeU,
        vAxis: planeV,
        cornerLattice: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 },
          { x: 0, y: 10, z: 0 },
        ],
        homography,
      },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }

    expect(
      chooseEdgeExtrusion(
        scene,
        [
          { faceId: face.id, edge: 'top' },
          { faceId: laterFace.id, edge: 'top' },
        ],
        { x: 50, y: 800 },
      ),
    ).toEqual({
      axis: { x: 0, y: 1, z: 0 },
      blocks: 3,
      createsAxis: false,
    })
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
      normal: { x: 0, y: 0, z: -1 },
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

  it('keeps partial and complete world-axis mappings distinct', () => {
    const partial = { a: 'x+' as const, b: 'unknown' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(partial)).toBe(false)
    expect(faceForLocalNormal(partial, { x: 0, y: 0, z: 1 })).toBe('up')

    const complete = { a: 'x+' as const, b: 'z-' as const, c: 'y+' as const }
    expect(isAxisMappingComplete(complete)).toBe(true)
    expect(mappedVector(complete, { x: 2, y: 3, z: 4 })).toEqual({
      x: 2,
      y: 4,
      z: -3,
    })
  })
})
