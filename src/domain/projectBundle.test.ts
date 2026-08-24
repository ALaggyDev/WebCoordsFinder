import { describe, expect, it } from 'vitest'
import { createTestDocument } from '../test/createTestDocument'
import { buildProjectBundle, readProjectBundle } from './projectBundle'

describe('project bundle web-search checkpoints', () => {
  it('round-trips version 5 shard cursors and result ordinals without changing schema version 1', async () => {
    const document = createTestDocument()
    document.scanner.webSearch = {
      engineVersion: 5,
      requestKey: '[5,"fixed-request"]',
      phase: 'paused',
      processed: '7',
      total: '20',
      matchCount: '2',
      checksPerSecond: 123,
      results: [
        {
          x: 4,
          y: 0,
          z: 0,
          badBlocks: 0,
          direction: 0,
          scanOrdinal: '3',
        },
      ],
      shards: [
        { start: '0', end: '10', next: '4', matchCount: '1' },
        { start: '10', end: '20', next: '13', matchCount: '1' },
      ],
      updatedAt: 1234,
    }

    const imported = await readProjectBundle(await buildProjectBundle(document))

    expect(imported.document.schemaVersion).toBe(1)
    expect(imported.document.scanner.webSearch).toEqual(
      document.scanner.webSearch,
    )
  })
})
