import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { createHubContainer } from '../../src/app/create-hub-container.js'
import { RealtimeEventHub } from '../../src/infrastructure/realtime/event-hub.js'
import { createSqliteHubStorage } from '../../src/infrastructure/storage/sqlite/hub-storage.js'
import { browserClient, origin, sandboxOrigin } from './browser-client.js'
import { githubProvider } from './github-provider.js'

/** 同一用例中的各个 Hub 只共享 SQLite 文件、签名密钥及外部身份提供方。 */
export async function sqliteHub() {
  const directory = await mkdtemp(join(tmpdir(), 'akasha-invitation-'))
  const provider = githubProvider()
  let now = Date.parse('2026-11-25T10:00:00.000Z')
  const clock = { now: () => new Date(now).toISOString() }
  const cleanups: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    for (const close of cleanups.reverse()) await close()
    await rm(directory, { recursive: true, force: true })
  })
  const open = async () => {
    const storage = createSqliteHubStorage(join(directory, 'hub.sqlite'))
    const realtime = new RealtimeEventHub({ clock })
    cleanups.push(async () => {
      await realtime.waitForPendingPublishes()
      storage.close()
    })
    await storage.ready
    const hub = createHubContainer({
      repositories: storage,
      artifactStorage: storage.artifactStorage,
      realtime,
      clock,
      origin,
      sandboxOrigin,
      oauth: provider.oauth,
    })
    return browserClient(hub.app.fetch)
  }
  return {
    ...(await open()),
    open,
    provider,
    advance: (seconds: number) => {
      now += seconds * 1000
    },
  }
}
