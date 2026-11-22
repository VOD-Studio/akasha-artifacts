// 按键串行化的轻量异步互斥锁：保证同一 Artifact 的版本校验/写入与状态补丁应用严格原子串行。
export class KeyedAsyncLock {
  private readonly chains = new Map<string, Promise<void>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = prev.then(() => current)
    this.chains.set(key, tail)

    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.chains.get(key) === tail) {
        this.chains.delete(key)
      }
    }
  }
}
