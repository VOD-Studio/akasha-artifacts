import type { ElementRef } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Textarea } from '@akasha/ui/textarea'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CanvasTextDraft } from './useInlineCanvasText'

interface InlineTextProps {
  /** 源码文字、原生文字和只读提示共用同一个画布锚点。 */
  draft: CanvasTextDraft
  /** 只有在收到真正的保存候选后才关闭；请求失败时保留输入。 */
  onSave: (text: string) => Promise<void>
  /** 仅关闭编辑，不回写源码。 */
  onClose: () => void
  /** 从只读提示把真实命中元素送到批注入口。 */
  onAnnotate: (element: ElementRef) => void
}

function draftText(draft: CanvasTextDraft) {
  if (draft.kind === 'readOnly') return ''
  return draft.kind === 'source' ? draft.text : draft.layer.text
}

function draftTitle(draft: CanvasTextDraft) {
  if (draft.kind === 'readOnly') return '此处只读'
  if (draft.kind !== 'create') return '编辑文字'
  return draft.layer.kind === 'note' ? '添加便签' : '添加文本'
}

/** 就地输入不启动试玩；焦点在输入框内时由浏览器处理文本快捷键。 */
export function InlineCanvasText({ draft, onSave, onClose, onAnnotate }: InlineTextProps) {
  const initial = draftText(draft)
  const [text, setText] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const target = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const id = useId()
  const isNew = draft.kind === 'create'
  const canSave = !busy && text !== initial && (!isNew || Boolean(text.trim()))

  useEffect(() => {
    const previous = document.activeElement
    const focus = target.current ?? panel.current
    focus?.focus({ preventScroll: true })
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        document.activeElement === document.body
      )
        previous.focus({ preventScroll: true })
    }
  }, [])

  const submit = async () => {
    if (!canSave) return
    setError('')
    setBusy(true)
    try {
      await onSave(text)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存文字，输入仍保留。')
    } finally {
      setBusy(false)
    }
  }

  const title = draftTitle(draft)
  // 非模态对话框贴在命中点上，打开和关闭均不改变画布布局。
  return createPortal(
    <dialog
      open
      ref={panel}
      aria-labelledby={`${id}-heading`}
      className="fixed z-50 m-0 w-[min(18rem,calc(100vw-24px))] rounded-lg border border-border bg-surface p-3 text-ink shadow-lg"
      style={{
        left: `clamp(12px, ${draft.anchor.x}px, calc(100vw - 19rem))`,
        top: `clamp(12px, ${draft.anchor.y}px, calc(100dvh - 15rem))`,
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <h2 id={`${id}-heading`} className="mb-2 text-sm font-semibold">
        {title}
      </h2>
      {draft.kind === 'readOnly' ? (
        <>
          <p className="mb-3 text-sm text-ink-muted">{draft.message}</p>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button size="sm" onClick={() => onAnnotate(draft.element)}>
              批注
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-2"
        >
          <Field label={<span className="sr-only">文字</span>} error={error}>
            <Textarea
              ref={target}
              rows={3}
              variant="outline"
              className="resize-y"
              maxLength={draft.kind === 'source' ? undefined : 8000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Enter' ||
                  (!event.metaKey && !event.ctrlKey) ||
                  event.nativeEvent.isComposing
                )
                  return
                event.preventDefault()
                void submit()
              }}
            />
          </Field>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={!canSave} loading={busy}>
              保存
            </Button>
          </div>
        </form>
      )}
    </dialog>,
    document.body,
  )
}
