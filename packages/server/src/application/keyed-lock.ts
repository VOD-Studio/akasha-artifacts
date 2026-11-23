/** 按键串行化的异步互斥锁：同一 key 的任务严格先后执行，不同 key 互不阻塞。 */
export class KeyedAsyncLock {
  private readonly chains = new Map<string, Promise<void>>()

  /**
   * 在 `key` 对应的队尾执行 `fn`，前一个任务结束后才开始。
   *
   * @returns `fn` 的结果；`fn` 抛错时锁照常释放。
   */
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
      // 只有队列排空才删除，避免误删后来者登记的新链
      if (this.chains.get(key) === tail) {
        this.chains.delete(key)
      }
    }
  }
}
