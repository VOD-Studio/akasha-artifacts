export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  // 归属项目；与项目无关的日志省略
  projectId?: string
  message: string
}

/** 内存中的环形日志缓冲区，供外壳顶栏的运维胶囊与 `akasha logs` 按项目查看。 */
export class LogStore {
  private readonly entries: LogEntry[] = []

  // `maxEntries` 是保留上限，超出后丢弃最旧的条目
  constructor(private readonly maxEntries = 300) {}

  append(entry: Omit<LogEntry, 'timestamp'>): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      ...entry,
    })
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
  }

  /** 返回最近的 `limit` 条，按时间升序；省略 `projectId` 时不按项目过滤。 */
  list(projectId?: string, limit = 100): readonly LogEntry[] {
    const filtered = projectId
      ? this.entries.filter((e) => e.projectId === projectId)
      : this.entries
    return filtered.slice(-limit)
  }
}
