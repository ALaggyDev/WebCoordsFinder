import { afterEach, expect, it, vi } from 'vitest'
import { rasterizeOffsetModels, rasterizeOffsetModelPatch } from './offsetRendering'

afterEach(() => vi.restoreAllMocks())

it('includes off-image geometry, respects zoom, and bounds raster memory', () => {
  const ctx = {
    setTransform: vi.fn(), save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, clip() {}, transform() {},
    drawImage: vi.fn(), imageSmoothingEnabled: true,
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const polygon = {
    points: [{ x: -20, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 40 }],
    uv: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }],
    texture: document.createElement('canvas'), depth: 1,
  }
  const raster = rasterizeOffsetModels([polygon], 2)!
  expect(raster.x).toBe(-21)
  expect(raster.y).toBe(-11)
  expect(raster.width).toBe(52)
  expect(raster.height).toBe(52)
  expect(raster.canvas.width).toBe(104)
  expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 42, 22)
  expect(ctx.drawImage).toHaveBeenCalledTimes(1)

  const large = rasterizeOffsetModels([{
    ...polygon, points: polygon.points.map(({ x, y }) => ({ x: x * 1000, y: y * 1000 })),
  }], 16)!
  expect(large.canvas.width).toBeLessThanOrEqual(4096)
  expect(large.canvas.height).toBeLessThanOrEqual(4096)
  expect(large.canvas.width * large.canvas.height).toBeLessThanOrEqual(4_194_304)
  expect(rasterizeOffsetModels([], 1)).toBeUndefined()
  expect(rasterizeOffsetModels([{
    ...polygon, points: [{ x: Infinity, y: 0 }],
  }], 1)).toBeUndefined()
})

it('redraws only overlapping patches in depth order within the moving bounds', () => {
  const draws: CanvasImageSource[] = []
  const ctx = {
    setTransform: vi.fn(), save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, clip() {}, transform() {},
    drawImage(texture: CanvasImageSource) { draws.push(texture) },
    imageSmoothingEnabled: true,
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const polygon = (x: number, depth: number) => ({
    points: [{ x, y: 0 }, { x: x + 20, y: 0 }, { x, y: 20 }],
    uv: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 0, y: 16 }],
    texture: document.createElement('canvas'), depth,
  })
  const behind = polygon(0, 3), moving = polygon(5, 2), front = polygon(10, 1)
  const farAway = polygon(1000, 4)
  const patch = rasterizeOffsetModelPatch([behind, front, farAway], [moving], 1)!
  expect(draws).toEqual([behind.texture, moving.texture, front.texture])
  expect(patch.x).toBe(4)
  expect(patch.width).toBe(22)
  expect(patch.height).toBe(22)
  expect(rasterizeOffsetModelPatch([behind], [], 1)).toBeUndefined()
})
