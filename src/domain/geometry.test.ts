import { describe, expect, it } from 'vitest'
import {
  computeHomography,
  chooseEdgeExtrusionAxis,
  createExtrudedPatch,
  faceForLocalNormal,
  fitCameraProjection,
  isAxisMappingComplete,
  mappedVector,
  patchCellQuad,
  patchVertex,
  projectCamera,
  projectPoint,
} from './geometry'
import type {
  CalibrationObservation,
  Matrix3x4,
  Point2,
  SceneGeometry,
  SurfacePatch,
} from './types'

const expectPointClose = (actual: Point2, expected: Point2, precision = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

const patch: SurfacePatch = {
  id: 'base',
  name: 'Base',
  origin: { x: 0, y: 0, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  columns: 4,
  rows: 3,
  inactiveCells: [],
}

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

  it('subdivides the base patch without losing shared edges', () => {
    const homography = computeHomography(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 10, y: 10 },
        { x: 110, y: 20 },
        { x: 90, y: 80 },
        { x: 20, y: 70 },
      ],
    )
    const scene: SceneGeometry = {
      patches: [patch],
      observations: [],
      projection: { kind: 'planar', patchId: patch.id, homography },
      axisMapping: { a: 'x+', b: 'z+', c: 'y+' },
    }
    const left = patchCellQuad(scene, patch, 0, 0)!
    const right = patchCellQuad(scene, patch, 1, 0)!
    expectPointClose(left[1], right[0])
    expectPointClose(left[2], right[3])
    expect(patchVertex(patch, 1, 1)).toEqual({ x: 1, y: 1, z: 0 })
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

  it('extrudes exact lattice geometry without sequential screen-space drift', () => {
    const wall = createExtrudedPatch(patch, 'top', 1, 10, 'wall')
    expect(wall.columns).toBe(4)
    expect(wall.rows).toBe(10)
    expect(patchVertex(wall, 4, 10)).toEqual({ x: 4, y: 0, z: 10 })
  })

  it('chooses an extrusion axis from the pointer position', () => {
    const matrix: Matrix3x4 = [
      800, 0, 320, 100,
      0, 700, -100, 200,
      0.1, 0.05, 1, 5,
    ]
    const scene: SceneGeometry = {
      patches: [patch],
      observations: [],
      projection: { kind: 'camera', matrix, rmsError: 0, maxError: 0 },
      axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    }
    const selection = [{ patchId: patch.id, column: 0, row: 0, edge: 'top' as const }]
    const pointer = projectCamera(matrix, { x: 0.5, y: 0, z: 4 })

    expect(chooseEdgeExtrusionAxis(scene, selection, 4, pointer)).toEqual({
      x: 0,
      y: 0,
      z: 1,
    })
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
