import type { ArtboardContent } from '@akasha/protocol'

const REQUEST_LIMIT = 4
const SAVED_CONTENT_LIMIT = 40
const SAVED_CONTENT_BYTES = 8 * 1024 * 1024
const THUMBNAIL_LIMIT = 40
const THUMBNAIL_BYTES = 4 * 1024 * 1024
const CAPTURE_IDLE_MS = 600

type Load = (id: string, signal: AbortSignal) => Promise<ArtboardContent>
type Capture = (signal: AbortSignal) => Promise<Blob>

type Entry =
  | { type: 'ready'; data: ArtboardContent; bytes: number }
  | { type: 'error'; message?: string; bytes: 0 }

interface Thumbnail {
  url: string
  bytes: number
}

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function contentSize(content: ArtboardContent) {
  let bytes = 2 * ((content.html?.length ?? 0) + (content.description?.length ?? 0))
  for (const layer of content.designLayers ?? []) {
    bytes += 256
    if (layer.kind === 'text' || layer.kind === 'note') bytes += layer.text.length * 2
    else if (layer.kind === 'stroke') bytes += layer.points.length * 40
  }
  return bytes
}

/** 绑定单一制品、版本与访问范围；检查器与视口共用正文，只有视口安排截图。 */
export class BoardResources {
  private wanted: readonly string[] = []
  private inspectorBoard: string | undefined
  private readonly loading = new Map<string, AbortController>()
  private readonly entries = new Map<string, Entry>()
  private readonly observers = new Set<() => void>()
  private readonly thumbnails = new Map<string, Thumbnail>()
  private readonly eligible = new Map<string, Capture>()
  private captureEnabled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private capture: { id: string; controller: AbortController } | undefined

  constructor(private readonly load: Load) {}

  subscribe = (listener: () => void) => {
    this.observers.add(listener)
    return () => this.observers.delete(listener)
  }

  private publish() {
    for (const observer of this.observers) observer()
  }

  get(id: string) {
    return this.entries.get(id)
  }

  thumbnail(id: string) {
    return this.thumbnails.get(id)?.url
  }

  setDemand(ordered: readonly string[], captureEnabled: boolean) {
    const change = !sameOrder(this.wanted, ordered)
    if (!change && this.captureEnabled === captureEnabled) return
    this.captureEnabled = captureEnabled
    if (change) {
      this.wanted = ordered
      for (const id of ordered) {
        this.touchEntry(id)
        const thumbnail = this.thumbnails.get(id)
        if (thumbnail) {
          this.thumbnails.delete(id)
          this.thumbnails.set(id, thumbnail)
        }
      }
      this.reconcileReads()
    }
    const capture = this.capture
    if (capture && (!captureEnabled || !ordered.includes(capture.id))) {
      capture.controller.abort()
    }
    this.scheduleCapture()
  }

  /** 为源码检查暂留正文；不占用画布的运行时和截图名额。 */
  setInspectorBoard(id: string | undefined) {
    if (id === this.inspectorBoard) return
    this.inspectorBoard = id
    if (id !== undefined) this.touchEntry(id)
    this.reconcileReads()
  }

  private wantsRead(id: string) {
    return id === this.inspectorBoard || this.wanted.includes(id)
  }

  private touchEntry(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.entries.set(id, entry)
  }

  private reconcileReads() {
    for (const id of this.loading.keys()) {
      if (!this.wantsRead(id)) this.cancelRead(id)
    }
    this.pruneEntries()
    this.pump()
  }

  private cancelRead(id: string) {
    const controller = this.loading.get(id)
    if (!controller) return false
    this.loading.delete(id)
    controller.abort()
    return true
  }

  retry(id: string) {
    if (this.entries.get(id)?.type !== 'error' || !this.wantsRead(id)) return
    this.entries.delete(id)
    this.publish()
    this.pump()
    if (this.wanted.includes(id)) this.scheduleCapture()
  }

  private pump() {
    const inspector = this.inspectorBoard
    for (const id of this.wanted) {
      if (this.loading.has(id) || this.entries.has(id)) continue
      if (this.loading.size === REQUEST_LIMIT) {
        // 只供检查器的请求不能挡住新进入视口的板。
        if (
          inspector === undefined ||
          this.wanted.includes(inspector) ||
          !this.cancelRead(inspector)
        )
          return
      }
      this.startRead(id)
    }
    if (
      inspector !== undefined &&
      this.loading.size < REQUEST_LIMIT &&
      !this.loading.has(inspector) &&
      !this.entries.has(inspector)
    ) {
      this.startRead(inspector)
    }
  }

  private startRead(id: string) {
    const controller = new AbortController()
    this.loading.set(id, controller)
    void this.read(id, controller)
  }

  private async read(id: string, controller: AbortController) {
    let entry: Entry
    try {
      const data = await this.load(id, controller.signal)
      if (controller.signal.aborted) return
      entry = { type: 'ready', data, bytes: contentSize(data) }
    } catch (error) {
      if (controller.signal.aborted) return
      entry = {
        type: 'error',
        message: error instanceof Error ? error.message : undefined,
        bytes: 0,
      }
    }
    if (this.loading.get(id) !== controller) return
    this.loading.delete(id)
    this.entries.set(id, entry)
    this.publish()
    this.pump()
    if (this.wanted.includes(id)) this.scheduleCapture()
  }

  private pruneEntries() {
    let count = 0
    let bytes = 0
    for (const [id, entry] of this.entries) {
      if (this.wantsRead(id)) continue
      count++
      bytes += entry.bytes
    }
    let removed = false
    for (const [id, entry] of this.entries) {
      if (count <= SAVED_CONTENT_LIMIT && bytes <= SAVED_CONTENT_BYTES) break
      if (this.wantsRead(id)) continue
      this.entries.delete(id)
      count--
      bytes -= entry.bytes
      removed = true
    }
    if (removed) this.publish()
  }

  /** 只安排已经显示的帧；退出视口不会另外启动沙盒来补缩略图。 */
  previewReady(id: string, capture: Capture) {
    if (this.thumbnails.has(id)) return
    this.eligible.set(id, capture)
    this.scheduleCapture()
  }

  previewClosed(id: string) {
    this.eligible.delete(id)
    if (this.capture?.id === id) this.capture.controller.abort()
  }

  private scheduleCapture() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (
      !this.captureEnabled ||
      this.capture ||
      !this.eligible.size ||
      this.wanted.some((id) => this.loading.has(id))
    )
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const id = this.wanted.find((id) => this.eligible.has(id))
      if (id === undefined) return
      const capture = this.eligible.get(id)
      if (capture) void this.saveThumbnail(id, capture)
    }, CAPTURE_IDLE_MS)
  }

  private async saveThumbnail(id: string, capture: Capture) {
    const controller = new AbortController()
    this.capture = { id, controller }
    try {
      const blob = await capture(controller.signal)
      if (controller.signal.aborted || blob.size === 0 || blob.size > THUMBNAIL_BYTES) return
      this.thumbnails.set(id, { url: URL.createObjectURL(blob), bytes: blob.size })
      this.eligible.delete(id)
      let bytes = 0
      for (const thumbnail of this.thumbnails.values()) bytes += thumbnail.bytes
      for (const [key, thumbnail] of this.thumbnails) {
        if (this.thumbnails.size <= THUMBNAIL_LIMIT && bytes <= THUMBNAIL_BYTES) break
        URL.revokeObjectURL(thumbnail.url)
        this.thumbnails.delete(key)
        bytes -= thumbnail.bytes
      }
      this.publish()
    } catch {
      // 截图不可用时保留画板轮廓；不为同一可见帧反复请求栅格化。
    } finally {
      // 交互中止后，仍显示的帧可以等下一次空闲；关闭的帧已从队列移除。
      if (!controller.signal.aborted && this.eligible.get(id) === capture) this.eligible.delete(id)
      if (this.capture?.controller === controller) {
        this.capture = undefined
        this.scheduleCapture()
      }
    }
  }

  reset() {
    this.wanted = []
    this.inspectorBoard = undefined
    this.captureEnabled = false
    for (const controller of this.loading.values()) controller.abort()
    this.loading.clear()
    this.entries.clear()
    clearTimeout(this.timer)
    this.timer = undefined
    this.eligible.clear()
    this.capture?.controller.abort()
    this.capture = undefined
    for (const thumbnail of this.thumbnails.values()) URL.revokeObjectURL(thumbnail.url)
    this.thumbnails.clear()
    this.publish()
  }
}
