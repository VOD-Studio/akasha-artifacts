import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'

type Close = () => void | Promise<void>

export function createFsTestScope() {
  const closers = new Set<Close>()
  const dirs: string[] = []
  onTestFinished(async () => {
    try {
      for (const close of [...closers].reverse()) await close()
    } finally {
      for (const dir of dirs.reverse()) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  const tempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    dirs.push(dir)
    return dir
  }
  const trackClose = (close: Close) => {
    closers.add(close)
    return () => {
      if (closers.delete(close)) return close()
    }
  }
  return { tempDir, trackClose }
}
