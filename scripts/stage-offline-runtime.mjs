import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const [script, style] = await Promise.all(
  ['js', 'css'].map((ext) =>
    readFile(
      new URL(`../apps/sandbox/dist/offline/akasha-offline.${ext}`, import.meta.url),
      'utf8',
    ),
  ),
)
await writeFile(
  new URL('../apps/web/dist/assets/akasha-offline.bundle.txt', import.meta.url),
  gzipSync(JSON.stringify({ script, style })).toString('base64'),
)
