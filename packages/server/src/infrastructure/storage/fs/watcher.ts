import fs from 'node:fs'
import path from 'node:path'
import { type ParsedFsArtifactPath, parseArtifactPathFromFs, STATE_DIR_NAME } from './index.js'

/** 监听器确认属于外部改动后交出的同步事件：文件路径的解析结果加上当前内容。 */
export interface ExternalArtifactFileEvent extends ParsedFsArtifactPath {
  source: string
}

export interface FsArtifactsWatcherOptions {
  artifactsRoot: string
  // 同一文件连续改动合并的窗口（毫秒），缺省 120
  debounceMs?: number
  // 判定一次落盘是否服务端自己写的；是则忽略，避免自触发
  isOwnWrite?: (filePath: string, content: string) => boolean
  // 确认为外部改动后调用；抛出的错误经 `onError` 上报
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

/**
 * 项目内 `.artifacts/` 的外部文件变更监听器：捕获宿主原生读写工具的改动，同步为版本快照。
 *
 * @remarks 自动忽略 `.state/`、临时文件与服务端自己的写入；同一文件按防抖窗口合并，
 * 全部同步任务串行执行。
 */
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

  /** 为一次文件变更安排防抖同步；不是制品源文件的路径直接忽略。 */
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

  /**
   * 读取文件当前内容并交给同步回调。
   *
   * @returns 是否触发了同步；文件已删除、内容是服务端自写或监听器已关闭时为 false。
   *
   * @remarks `fromWatch` 为 true 且读到空内容时，再等一个短稳定窗口复读一次，
   * 以避开编辑器先截断再写入的窗口。
   */
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

  /**
   * 全量扫描 `.artifacts/` 下的源文件并对齐到索引。
   *
   * @returns 实际触发同步的文件数；单个文件异常不阻断其余文件。
   */
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
