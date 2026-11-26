import {
  AGENT_REFERENCE_BYTES,
  AGENT_REFERENCE_COUNT,
  AGENT_REFERENCE_TOTAL_BYTES,
  type AgentReferencePreview,
  type AgentReferenceScope,
  type AgentReferenceSelection,
} from '@akasha/protocol'
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { getRequestErrorMessage } from '@/shared/api/error'
import { getMessages, type Messages } from '@/shared/i18n'
import { readContent } from '@/shared/lib/selected-file'
import { revokeReference, stageReference } from './reference-api'

interface Entry {
  key: string
  file: File
  preview?: AgentReferencePreview
  status: 'pending' | 'ready' | 'failed' | 'expired'
  error?: string
}

/** 文件仅存在于当前草稿的内存中；只要有一项不可发送，整份 selection 都不可用。 */
export interface ReferenceDraft {
  entries: Entry[]
  blocked: boolean
  busy: boolean
  selection?: AgentReferenceSelection
  add(files: readonly File[]): void
  remove(key: string): void
  retry(key: string): void
  reset(): void
  /** 不重用可能已消费的标识；保留原文件供用户重新预览。 */
  invalidate(): void
}

interface Slot extends Entry {
  scope: AgentReferenceScope
  removing?: boolean
}

interface Quota {
  count: number
  bytes: number
}

const limits = {
  '请选择非空文件，单份材料最多 {mib} MiB。': [
    'Eine nicht leere Datei mit höchstens {mib} MiB auswählen.',
    'اختر ملفًا غير فارغ لا يتجاوز {mib} MiB.',
    'Choose a nonempty file of at most {mib} MiB.',
  ],
  '每轮最多 {count} 份材料，合计最多 {mib} MiB。请移除部分材料后重试。': [
    'Pro Runde höchstens {count} Dateien und insgesamt {mib} MiB. Dateien entfernen und erneut versuchen.',
    'الحد لكل جولة {count} ملفات و{mib} MiB إجمالًا. أزل بعض الملفات ثم أعد المحاولة.',
    'A turn allows {count} files and {mib} MiB total. Remove some files and try again.',
  ],
} as const satisfies Messages

function limitError(size: number, used: Quota) {
  if (!size || size > AGENT_REFERENCE_BYTES) {
    return getMessages(limits).t('请选择非空文件，单份材料最多 {mib} MiB。', {
      mib: AGENT_REFERENCE_BYTES / 2 ** 20,
    })
  }
  if (used.count >= AGENT_REFERENCE_COUNT || used.bytes + size > AGENT_REFERENCE_TOTAL_BYTES) {
    const { t } = getMessages(limits)
    return t('每轮最多 {count} 份材料，合计最多 {mib} MiB。请移除部分材料后重试。', {
      count: AGENT_REFERENCE_COUNT,
      mib: AGENT_REFERENCE_TOTAL_BYTES / 2 ** 20,
    })
  }
}

function forgetPreview(scope: AgentReferenceScope, preview: AgentReferencePreview) {
  // 旧草稿已经不可见，不能把撤回错误挂到新项目；无法到达服务时由服务端期限收回。
  if (preview.expiresAt > Date.now()) void revokeReference(scope, preview.id).catch(() => {})
}

function createDraft(projectId: string, sessionId?: string) {
  let scope: AgentReferenceScope | undefined
  const currentScope = () => {
    scope ??= { projectId, sessionId, draftId: crypto.randomUUID() }
    return scope
  }
  const slots = new Map<string, Slot>()
  let entries: Entry[] = []
  let active = false
  let notify: (() => void) | undefined
  let timer: number | undefined

  const publish = () => {
    clearTimeout(timer)
    const now = Date.now()
    let nextExpiry = Infinity
    entries = Array.from(slots.values(), (slot) => {
      if (slot.preview && slot.status === 'ready') {
        if (slot.preview.expiresAt <= now) {
          slot.status = 'expired'
          slot.preview = undefined
        } else nextExpiry = Math.min(nextExpiry, slot.preview.expiresAt)
      }
      const { key, file, status, error } = slot
      return { key, file, status, error, preview: slot.removing ? undefined : slot.preview }
    })
    if (Number.isFinite(nextExpiry)) timer = window.setTimeout(publish, nextExpiry - now)
    if (active) notify?.()
  }

  const withdraw = async (slot: Slot, preview: AgentReferencePreview) => {
    try {
      if (preview.expiresAt > Date.now()) await revokeReference(slot.scope, preview.id)
      if (slots.get(slot.key) !== slot) return
      slots.delete(slot.key)
    } catch (reason) {
      if (slots.get(slot.key) !== slot) return
      slot.status = 'failed'
      slot.error = getRequestErrorMessage(reason)
    }
    publish()
  }

  const upload = async (slot: Slot) => {
    try {
      const content = await readContent(slot.file, true)
      if (slots.get(slot.key) !== slot) return
      if (!slot.removing) {
        const preview = await stageReference(slot.scope, { name: slot.file.name, content })
        if (slots.get(slot.key) !== slot) {
          forgetPreview(slot.scope, preview)
          return
        }
        slot.preview = preview
        if (slot.removing) return withdraw(slot, preview)
        slot.status = 'ready'
      } else slots.delete(slot.key)
    } catch (reason) {
      if (slots.get(slot.key) !== slot) return
      if (slot.removing) slots.delete(slot.key)
      else {
        slot.status = 'failed'
        slot.error = getRequestErrorMessage(reason)
      }
    }
    publish()
  }

  const usedQuota = (): Quota => {
    const used = { count: 0, bytes: 0 }
    for (const slot of slots.values()) {
      if (slot.status !== 'pending' && !slot.preview) continue
      used.count++
      used.bytes += slot.file.size
    }
    return used
  }

  const stage = (slot: Slot, used: Quota) => {
    slot.error = limitError(slot.file.size, used)
    if (slot.error) {
      slot.status = 'failed'
      return
    }
    used.count++
    used.bytes += slot.file.size
    slot.status = 'pending'
    void upload(slot)
  }

  const remove = (key: string) => {
    const slot = slots.get(key)
    if (!slot || (slot.removing && slot.status === 'pending')) return
    slot.removing = true
    slot.error = undefined
    if (slot.preview) {
      slot.status = 'pending'
      void withdraw(slot, slot.preview)
    } else if (slot.status !== 'pending') slots.delete(key)
    publish()
  }

  const replace = (keepFiles: boolean) => {
    scope = undefined
    for (const [key, slot] of slots) {
      if (keepFiles && slot.removing) continue
      if (slot.preview && !(slot.removing && slot.status === 'pending')) {
        forgetPreview(slot.scope, slot.preview)
      }
      if (keepFiles) {
        slots.set(key, { key, file: slot.file, status: 'expired', scope: currentScope() })
      } else slots.delete(key)
    }
    publish()
  }

  return {
    activate: () => {
      active = true
      return () => {
        active = false
        replace(false)
      }
    },
    subscribe: (listener: () => void) => {
      notify = listener
      return () => {
        notify = undefined
      }
    },
    snapshot: () => entries,
    draftId: () => currentScope().draftId,
    add: (files: readonly File[]) => {
      if (!active || !projectId || !files.length) return
      const used = usedQuota()
      const scope = currentScope()
      for (const file of files) {
        const slot: Slot = { key: crypto.randomUUID(), file, status: 'pending', scope }
        slots.set(slot.key, slot)
        stage(slot, used)
      }
      publish()
    },
    remove,
    retry: (key: string) => {
      const slot = slots.get(key)
      if (!slot || (slot.status !== 'failed' && slot.status !== 'expired')) return
      if (slot.removing) return remove(key)
      stage(slot, usedQuota())
      publish()
    },
    reset: () => replace(false),
    invalidate: () => replace(true),
  }
}

function isReady(entry: Entry): entry is Entry & { preview: AgentReferencePreview } {
  return entry.status === 'ready' && !!entry.preview && entry.preview.expiresAt > Date.now()
}

/** 项目或会话变化时同步隔离草稿；空项目不接收文件，恢复授权也不复用旧预览。 */
export function useReferenceDraft(projectId: string, sessionId?: string): ReferenceDraft {
  const draft = useMemo(() => createDraft(projectId, sessionId), [projectId, sessionId])
  useLayoutEffect(() => draft.activate(), [draft])
  const entries = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot)
  return {
    entries,
    busy: entries.some((entry) => entry.status === 'pending'),
    // 后台页面的定时器可能延迟；读取发送清单时再核对期限以及草稿是否已经被替换。
    get blocked() {
      return entries !== draft.snapshot() || !entries.every(isReady)
    },
    get selection() {
      if (!entries.length || entries !== draft.snapshot() || !entries.every(isReady))
        return undefined
      return { draftId: draft.draftId(), ids: entries.map(({ preview }) => preview.id) }
    },
    add: draft.add,
    remove: draft.remove,
    retry: draft.retry,
    reset: draft.reset,
    invalidate: draft.invalidate,
  }
}
