import fs from 'node:fs'
import path from 'node:path'
import { type ParsedFsArtifactPath, parseArtifactPathFromFs, STATE_DIR_NAME } from './index.js'

export interface ExternalArtifactFileEvent extends ParsedFsArtifactPath {
  source: string
}

export interface FsArtifactsWatcherOptions {
  artifactsRoot: string
  debounceMs?: number
  isOwnWrite?: (filePath: string, content: string) => boolean
  onExternalFileChange: (event: ExternalArtifactFileEvent) => Promise<void>
  onError?: (err: unknown) => void
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === STATE_DIR_NAME || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSourceFiles(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

// 项目内 .artifacts/ 外部文件变更监听器：捕获宿主原生 Read/Edit/Write 变更，
// 自动过滤 .state/、临时文件与服务端自写事件，并按文件粒度防抖触发版本快照同步。
export class FsArtifactsWatcher {
  private watcher: fs.FSWatcher | null = null
  private closed = false
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  // 串行化外部文件同步队列，防止同一文件的突发保存事件并发读到相同 baseVersion 触发 409
  private syncQueue: Promise<void> = Promise.resolve()
  private readonly artifactsRoot: string
  private readonly debounceMs: number
  private readonly isOwnWrite?: (filePath: string, content: string) => boolean
  private readonly onExternalFileChange: (event: ExternalArtifactFileEvent) => Promise<void>
  private readonly onError?: (err: unknown) => void

  constructor(options: FsArtifactsWatcherOptions) {
    this.artifactsRoot = path.resolve(options.artifactsRoot)
    this.debounceMs = options.debounceMs ?? 120
    this.isOwnWrite = options.isOwnWrite
    this.onExternalFileChange = options.onExternalFileChange
    this.onError = options.onError
  }

  start(): void {
    if (this.watcher || this.closed) return
    fs.mkdirSync(this.artifactsRoot, { recursive: true })
    try {
      this.watcher = fs.watch(this.artifactsRoot, { recursive: true }, (_eventType, filename) => {
        if (this.closed || !filename) return
        const fullPath = path.resolve(this.artifactsRoot, String(filename))
        this.scheduleSync(fullPath)
      })
      this.watcher.on('error', (err) => {
        this.onError?.(err)
      })
    } catch (err) {
      this.onError?.(err)
    }
  }

  scheduleSync(filePath: string): void {
    const resolved = path.resolve(filePath)
    if (!parseArtifactPathFromFs(this.artifactsRoot, resolved)) return

    const existing = this.timers.get(resolved)
    if (existing !== undefined) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.timers.delete(resolved)
      void this.syncFile(resolved, { fromWatch: true }).catch((err) => this.onError?.(err))
    }, this.debounceMs)
    this.timers.set(resolved, timer)
  }

  async syncFile(filePath: string, options: { fromWatch?: boolean } = {}): Promise<boolean> {
    let result = false
    const run = async () => {
      if (this.closed) return
      const resolved = path.resolve(filePath)
      const parsed = parseArtifactPathFromFs(this.artifactsRoot, resolved)
      if (!parsed) return
      if (!fs.existsSync(resolved)) return

      const readCurrent = (): string | null => {
        try {
          const stat = fs.statSync(resolved)
          if (!stat.isFile()) return null
          return fs.readFileSync(resolved, 'utf8')
        } catch {
          return null
        }
      }

      let source = readCurrent()
      if (source === null) return

      // 实时监听偶遇编辑器非原子截断窗口时，额外等待短稳定窗口复读一次；
      // 若文件持续为空（如用户主动清空源码或停机后对账），则如实同步空内容，防止历史非空版本反写覆盖。
      if (options.fromWatch && source.length === 0) {
        await new Promise((r) => setTimeout(r, Math.min(this.debounceMs, 50)))
        if (this.closed || !fs.existsSync(resolved)) return
        source = readCurrent()
        if (source === null) return
      }

      if (this.isOwnWrite?.(resolved, source)) return

      await this.onExternalFileChange({ ...parsed, source })
      result = true
    }
    const next = this.syncQueue.then(run, run)
    this.syncQueue = next.catch(() => {})
    await next
    return result
  }

  // 启动时或手工全量扫描 .artifacts/ 下全部原生源文件并对齐到索引；单个文件异常不阻断其余文件对账
  async scanAll(): Promise<number> {
    const files = walkSourceFiles(this.artifactsRoot)
    let synced = 0
    for (const file of files) {
      if (this.closed) break
      try {
        if (await this.syncFile(file)) {
          synced++
        }
      } catch (err) {
        this.onError?.(err)
      }
    }
    return synced
  }

  close(): void {
    this.closed = true
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
