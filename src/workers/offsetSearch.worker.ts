import wasmUrl from '../wasm/offset_search.wasm?url'
import type { OffsetSearchRequest } from '../domain/offsetSearch'

interface OffsetExports extends WebAssembly.Exports {
  offset_configure: (start: number, end: number, minX: number, maxX: number, minZ: number, maxZ: number, count: number) => number
  offset_set_constraint: (index: number, dx: number, dz: number, x: number, y: number, z: number, xMask: number, zMask: number, full: number) => number
  offset_scan_batch: (count: number) => number
  offset_get_next_x: () => number
  offset_get_matches: () => bigint
  offset_get_result_count: () => number
  offset_get_result_x: (index: number) => number
  offset_get_result_z: (index: number) => number
}

type Command =
  | { type: 'start'; request: OffsetSearchRequest; start: number; end: number }
  | { type: 'stop' }

let stopped = false
let module: OffsetExports | undefined
let start = 0
let end = 0
let lastResultCount = 0
const channel = new MessageChannel()
channel.port1.onmessage = runBatch

function publish(phase: 'running' | 'completed' | 'stopped') {
  if (!module) return
  const count = module.offset_get_result_count()
  const results = Array.from({ length: count - lastResultCount }, (_, index) => ({
    x: module!.offset_get_result_x(lastResultCount + index),
    z: module!.offset_get_result_z(lastResultCount + index),
  }))
  lastResultCount = count
  postMessage({
    phase,
    start,
    end,
    next: module.offset_get_next_x(),
    matches: module.offset_get_matches(),
    results,
  })
}

function runBatch() {
  if (!module) return
  if (stopped) {
    publish('stopped')
    return
  }
  module.offset_scan_batch(1)
  const done = module.offset_get_next_x() === end
  // Coalesce progress messages while still yielding for Stop after each prefix.
  if (done || (module.offset_get_next_x() - start) % 8 === 0) {
    publish(done ? 'completed' : 'running')
  }
  if (!done) channel.port2.postMessage(null)
}

self.onmessage = async (event: MessageEvent<Command>) => {
  if (event.data.type === 'stop') {
    stopped = true
    return
  }
  stopped = false
  start = event.data.start
  end = event.data.end
  lastResultCount = 0
  try {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`Unable to load offset scanner (${response.status}).`)
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer())
    module = instance.exports as OffsetExports
    const { bounds, constraints } = event.data.request
    if (module.offset_configure(start, end, bounds.xStart, bounds.xEnd,
      bounds.zStart, bounds.zEnd, constraints.length) !== 0) {
      throw new Error('Invalid offset scanner configuration.')
    }
    constraints.forEach((constraint, index) => {
      if (module!.offset_set_constraint(index, constraint.dx, constraint.dz,
        constraint.x, constraint.y, constraint.z,
        constraint.xMask, constraint.zMask, +constraint.full) !== 0) {
        throw new Error('Invalid offset constraint.')
      }
    })
    channel.port2.postMessage(null)
  } catch (error) {
    postMessage({ phase: 'error', start, error: String(error) })
  }
}
