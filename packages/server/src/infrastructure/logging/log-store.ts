export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  projectId?: string
  message: string
}

// 环形日志缓冲区，支撑外壳顶栏运维胶囊与 akasha logs 按项目过滤查看。
export class LogStore {
  private readonly entries: LogEntry[] = []

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

  list(projectId?: string, limit = 100): readonly LogEntry[] {
    const filtered = projectId
      ? this.entries.filter((e) => e.projectId === projectId)
      : this.entries
    return filtered.slice(-limit)
  }
}
