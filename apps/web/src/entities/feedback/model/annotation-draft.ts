import { type ElementRef, ElementRefSchema } from '@akasha/protocol'
import { useCallback, useSyncExternalStore } from 'react'

/** 尚未提交的正文和发起时的目标；换页、换选区和头版本推进都不改写锚点。 */
export interface AnnotationDraft {
  /** 打开草稿时必须回到该版本，不能跟随最新推送重绑元素。 */
  version: number
  /** 为 `null` 时批注针对整个版本。 */
  element: ElementRef | null
  /** 草拟时所属的轮次；`null` 表示不参加轮次。 */
  roundId: string | null
  body: string
  /** 仅表示用户选择的投递对象，草稿本身不会通知 Agent。 */
  sendToAgent: boolean
}

interface CachedAnnotationDraft {
  /** 与 `draft` 对应的 sessionStorage 序列化文本；未持久化（空正文或已清空）时为 `null`。 */
  raw: string | null
  draft: AnnotationDraft | null
  /** 浏览器禁用 sessionStorage 时退回当前标签页内存共享，供多编辑器保持一致。 */
  memoryOnly: boolean
}

const prefix = 'akasha:annotation-draft:'
const draftCache = new Map<string, CachedAnnotationDraft>()
const draftListeners = new Map<string, Set<() => void>>()

function notifyDraftListeners(artifactId: string): void {
  const listeners = draftListeners.get(artifactId)
  if (!listeners) return
  for (const listener of [...listeners]) listener()
}

function readRawDraft(artifactId: string): { available: boolean; raw: string | null } {
  try {
    return { available: true, raw: sessionStorage.getItem(`${prefix}${artifactId}`) }
  } catch {
    return { available: false, raw: null }
  }
}

function parseAnnotationDraft(saved: string | null): AnnotationDraft | null {
  if (!saved) return null
  try {
    const value = JSON.parse(saved) as Partial<AnnotationDraft> | null
    if (
      !value ||
      typeof value.body !== 'string' ||
      typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1 ||
      (value.roundId !== null && typeof value.roundId !== 'string') ||
      typeof value.sendToAgent !== 'boolean'
    )
      return null
    const element = ElementRefSchema.nullable().safeParse(value.element)
    if (!element.success) return null
    return {
      version: value.version,
      body: value.body,
      roundId: value.roundId,
      element: element.data,
      sendToAgent: value.sendToAgent,
    }
  } catch {
    return null
  }
}

function getAnnotationDraftSnapshot(artifactId: string): AnnotationDraft | null {
  const { available, raw } = readRawDraft(artifactId)
  const cached = draftCache.get(artifactId)
  if (!available) return cached?.draft ?? null
  if (cached) {
    if (cached.memoryOnly && raw === null) return cached.draft
    if (!cached.memoryOnly && cached.raw === raw) return cached.draft
  }
  const parsed = parseAnnotationDraft(raw)
  draftCache.set(artifactId, { raw, draft: parsed, memoryOnly: false })
  return parsed
}

function subscribeAnnotationDraft(artifactId: string, listener: () => void): () => void {
  let listeners = draftListeners.get(artifactId)
  if (!listeners) {
    listeners = new Set()
    draftListeners.set(artifactId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = draftListeners.get(artifactId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      draftListeners.delete(artifactId)
      const cached = draftCache.get(artifactId)
      if (cached && !cached.draft?.body) draftCache.delete(artifactId)
    }
  }
}

const getServerDraftSnapshot = () => null

/** 订阅同一制品的共享批注草稿，使选区浮层与右侧讨论抽屉始终读写同一状态源。 */
export function useAnnotationDraft(artifactId: string): AnnotationDraft | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeAnnotationDraft(artifactId, listener),
    [artifactId],
  )
  const getSnapshot = useCallback(() => getAnnotationDraftSnapshot(artifactId), [artifactId])
  return useSyncExternalStore(subscribe, getSnapshot, getServerDraftSnapshot)
}

/** 从当前标签页找回一条草稿，不读取其他制品或其他标签页。 */
export function readAnnotationDraft(artifactId: string): AnnotationDraft | null {
  const snapshot = getAnnotationDraftSnapshot(artifactId)
  return snapshot?.body ? snapshot : null
}

/** 提交或清空正文后移除持久草稿；浏览器关闭存储时只保留当前标签页内的共享草稿状态。 */
export function writeAnnotationDraft(artifactId: string, draft: AnnotationDraft | null): void {
  const key = `${prefix}${artifactId}`
  const serialized = draft?.body ? JSON.stringify(draft) : null
  let memoryOnly = false
  try {
    if (serialized) sessionStorage.setItem(key, serialized)
    else sessionStorage.removeItem(key)
  } catch {
    memoryOnly = true
  }
  if (draft) {
    draftCache.set(artifactId, { raw: serialized, draft, memoryOnly })
  } else {
    draftCache.set(artifactId, { raw: null, draft: null, memoryOnly: false })
  }
  notifyDraftListeners(artifactId)
}

/** 回复草稿只属于此次讨论，不替换同制品正在撰写的根批注。 */
export function readReplyDraft(artifactId: string, feedbackId: string): string {
  try {
    return sessionStorage.getItem(`${prefix}reply:${artifactId}/${feedbackId}`) ?? ''
  } catch {
    return ''
  }
}

/** 回复成功或清空正文时移除该线程的本地草稿。 */
export function writeReplyDraft(artifactId: string, feedbackId: string, body: string): void {
  try {
    const key = `${prefix}reply:${artifactId}/${feedbackId}`
    if (body) sessionStorage.setItem(key, body)
    else sessionStorage.removeItem(key)
  } catch {}
}

/** 此标签页切换 Hub 身份前清理旧用户未提交的正文。 */
export function clearAnnotationDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  } catch {}
  draftCache.clear()
  for (const artifactId of [...draftListeners.keys()]) {
    notifyDraftListeners(artifactId)
  }
}
