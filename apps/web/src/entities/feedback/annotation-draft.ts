import { type ElementRef, ElementRefSchema } from '@akasha/protocol'

/** 尚未提交的正文和发起时的目标；换页、换选区和头版本推进都不改写锚点。 */
export interface AnnotationDraft {
  version: number
  element: ElementRef | null
  // 不把另一个活动轮次误当成原轮次。
  roundId: string | null
  body: string
  sendToAgent: boolean
}

const prefix = 'akasha:annotation-draft:'

/** 从当前标签页找回一条草稿，不读取其他制品或其他标签页。 */
export function readAnnotationDraft(artifactId: string): AnnotationDraft | null {
  try {
    const saved = sessionStorage.getItem(`${prefix}${artifactId}`)
    if (!saved) return null
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

/** 提交或清空正文后移除持久草稿；浏览器关闭存储时只保留当前编辑器的状态。 */
export function writeAnnotationDraft(artifactId: string, draft: AnnotationDraft | null): void {
  try {
    const key = `${prefix}${artifactId}`
    if (draft?.body) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch {}
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
}
