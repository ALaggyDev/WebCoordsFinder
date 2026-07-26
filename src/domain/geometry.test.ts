import { describe, expect, it } from 'vitest'
import {
  axesForFaceRotation,
  canonicalCropTransform,
  cellCoordinate,
  cellQuad,
  computeHomography,
  planeAxisRotation,
  projectPoint,
  projectedWorldAxes,
} from './geometry'
import type { PerspectivePlane, Point2 } from './types'

const expectPointClose = (actual: Point2, expected: Point2) => {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
}

describe('perspective geometry', () => {
  it('maps all four corners through a projective transform', () => {
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

  it('subdivides a skewed plane without losing shared cell edges', () => {
    const plane: PerspectivePlane = {
      id: 'plane',
      name: 'Test plane',
      corners: [
        { x: 10, y: 10 },
        { x: 110, y: 20 },
        { x: 90, y: 80 },
        { x: 20, y: 70 },
      ],
      columns: 2,
      rows: 1,
      face: 'north',
      origin: { x: -3, y: 6, z: 2 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: -1, z: 0 },
      inactiveCells: [],
    }
    const left = cellQuad(plane, 0, 0)
    const right = cellQuad(plane, 1, 0)

    expectPointClose(left[1], right[0])
    expectPointClose(left[2], right[3])
    expect(cellCoordinate(plane, 1, 1)).toEqual({ x: -2, y: 5, z: 2 })
  })

  it('offers four valid image-to-world rotations for a top face', () => {
    expect(axesForFaceRotation('up', 0)).toEqual({
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 0, z: 1 },
    })
    expect(axesForFaceRotation('up', 1)).toEqual({
      uAxis: { x: 0, y: 0, z: -1 },
      vAxis: { x: 1, y: 0, z: 0 },
    })
    expect(axesForFaceRotation('up', 2)).toEqual({
      uAxis: { x: -1, y: 0, z: 0 },
      vAxis: { x: 0, y: 0, z: -1 },
    })
    expect(axesForFaceRotation('up', 3)).toEqual({
      uAxis: { x: 0, y: 0, z: 1 },
      vAxis: { x: -1, y: 0, z: 0 },
    })
  })

  it('selects the inverse crop rotation needed for canonical north-up output', () => {
    const plane: PerspectivePlane = {
      id: 'rotated',
      name: 'Rotated floor',
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      columns: 1,
      rows: 1,
      face: 'up',
      origin: { x: 0, y: 0, z: 0 },
      ...axesForFaceRotation('up', 1),
      inactiveCells: [],
    }

    expect(planeAxisRotation(plane)).toBe(1)
    expect(canonicalCropTransform(plane)).toBe('rotate270')

    plane.face = 'down'
    Object.assign(plane, axesForFaceRotation('down', 0))
    expect(canonicalCropTransform(plane)).toBe('rotate180')
  })

  it('projects positive world axes into a selected plane gizmo', () => {
    const plane: PerspectivePlane = {
      id: 'gizmo',
      name: 'Gizmo floor',
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      columns: 1,
      rows: 1,
      face: 'up',
      origin: { x: 0, y: 0, z: 0 },
      ...axesForFaceRotation('up', 0),
      inactiveCells: [],
    }
    const axes = projectedWorldAxes(plane)

    expect(axes.x.x).toBeCloseTo(1)
    expect(axes.x.y).toBeCloseTo(0)
    expect(axes.z.x).toBeCloseTo(0)
    expect(axes.z.y).toBeCloseTo(1)
    expect(axes.y.y).toBeLessThan(0)
  })
})
