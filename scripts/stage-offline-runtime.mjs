import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { devCacheDir, devPublicDir } from './dev-endpoints.ts'

const dev = process.argv[2] === '--dev'
const sourceDir = dev
  ? new URL('offline/', devCacheDir)
  : new URL('../apps/sandbox/dist/offline/', import.meta.url)
const output = new URL(
  'assets/akasha-offline.bundle.txt',
  dev ? devPublicDir : new URL('../apps/web/dist/', import.meta.url),
)

const [script, style] = await Promise.all(
  ['js', 'css'].map((ext) => readFile(new URL(`akasha-offline.${ext}`, sourceDir), 'utf8')),
)
await mkdir(new URL('.', output), { recursive: true })
await writeFile(output, gzipSync(JSON.stringify({ script, style })).toString('base64'))
