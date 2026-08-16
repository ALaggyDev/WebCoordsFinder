import {
  cameraFacingNormal,
  cross3,
  fitCameraProjection,
  scale3,
  subtract3,
} from '../domain/geometry'
import type { EditorDocument, MeshFace, Point2, Point3 } from '../domain/types'
import { createEmptyDocument } from '../store/editorStore'

// A populated document for tests only. Production starts from an empty project
// and bundled examples are loaded from .wcf archives.
export function createTestDocument(): EditorDocument {
  const document = createEmptyDocument()
  const baseCorners: [Point2, Point2, Point2, Point2] = [
    { x: 0, y: 644 },
    { x: 1058, y: 574 },
    { x: 1450, y: 1000 },
    { x: 0, y: 1102 },
  ]
  const baseLattice: [Point3, Point3, Point3, Point3] = [
    { x: 0, y: 0, z: 0 },
    { x: 6, y: 0, z: 0 },
    { x: 6, y: 4, z: 0 },
    { x: 0, y: 4, z: 0 },
  ]
  const depthEdge = {
    start: { x: 0, y: 0, z: 0 },
    end: { x: 6, y: 0, z: 0 },
  }
  const depth = 2
  const outerCorners: [Point2, Point2] = [
    { x: 210, y: 310 },
    { x: 970, y: 300 },
  ]
  const outerLattice: [Point3, Point3] = [depthEdge.start, depthEdge.end].map(
    (point) => ({ ...point, z: depth }),
  ) as [Point3, Point3]
  const observations = [
    ...baseLattice.map((lattice, index) => ({
      id: crypto.randomUUID(),
      lattice,
      image: baseCorners[index],
      weight: 1,
    })),
    ...outerLattice.map((lattice, index) => ({
      id: crypto.randomUUID(),
      lattice,
      image: outerCorners[index],
      weight: 1,
    })),
  ]
  const baseFaces: MeshFace[] = Array.from({ length: 4 }).flatMap((_, row) =>
    Array.from({ length: 6 }, (__, column) => ({
      id: `test-base-${column}-${row}`,
      blockCoordinate: { x: column, y: row, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    })),
  )
  const direction = subtract3(depthEdge.end, depthEdge.start)
  const step = scale3(direction, 1 / Math.abs(direction.x))
  const depthFaces: MeshFace[] = Array.from({ length: depth }).flatMap(
    (_, depthIndex) =>
      Array.from({ length: 6 }, (__, column) => ({
        id: `test-depth-${depthIndex}-${column}`,
        blockCoordinate: { x: column, y: 0, z: depthIndex },
        normal: cross3(step, { x: 0, y: 0, z: 1 }),
      })),
  )

  document.projectName = 'Test project'
  document.image = {
    key: 'test-image',
    name: 'test-image.png',
    src: 'blob:test-image',
    width: 2560,
    height: 1494,
    mime: 'image/png',
  }
  document.scene = {
    faces: [...baseFaces, ...depthFaces],
    observations,
    projection: fitCameraProjection(observations),
    axisMapping: { a: 'unknown', b: 'unknown', c: 'unknown' },
    worldUpIntent: null,
  }
  document.scene.faces.forEach((face) => {
    face.normal = cameraFacingNormal(document.scene, face)
  })
  document.anchorFaceId = baseFaces[0].id
  return document
}
