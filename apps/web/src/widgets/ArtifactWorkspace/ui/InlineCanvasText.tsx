import type { ElementRef } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Textarea } from '@akasha/ui/textarea'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMessages } from '@/shared/i18n'
import type { CanvasTextDraft } from '../hooks/useInlineCanvasText'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

interface InlineTextProps {
  /** 源码文字、原生文字和只读提示共用同一个画布锚点。 */
  draft: CanvasTextDraft
  initialText?: string
  /** 未提交文字按原版本暂存；主动取消才丢弃。 */
  onInput: (text: string) => void
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
export function InlineCanvasText({
  draft,
  initialText,
  onInput,
  onSave,
  onClose,
  onAnnotate,
}: InlineTextProps) {
  const { t } = useMessages(canvasToolsMessages)
  const diagnostic = (message: string) => {
    switch (message) {
      case '无法检查文字':
      case '无法定位可编辑的静态文字。':
      case '无法保存文字，输入仍保留。':
      case '当前无法保存文字，输入已保留。':
      case '无法保存文字，请处理画布上的提示后重试。':
        return t(message)
      default:
        return message
    }
  }
  const initial = draftText(draft)
  const [text, setText] = useState(
    draft.kind === 'readOnly' ? '' : (initialText ?? draft.restoredText ?? initial),
  )
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

  const title = t(draftTitle(draft))
  // 非模态对话框贴在命中点上，打开和关闭均不改变画布布局。
  return createPortal(
    <dialog
      open
      ref={panel}
      aria-labelledby={`${id}-heading`}
      className="canvas-text-editor fixed z-50 m-0 overflow-y-auto rounded-lg border border-border bg-surface p-3 text-ink shadow-lg"
      style={
        {
          '--anchor-x': `${draft.anchor.x}px`,
          '--anchor-y': `${draft.anchor.y}px`,
        } as CSSProperties
      }
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
          <p className="mb-3 text-sm text-ink-muted">{diagnostic(draft.message)}</p>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('关闭')}
            </Button>
            <Button size="sm" onClick={() => onAnnotate(draft.element)}>
              {t('批注')}
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
          <Field label={<span className="sr-only">{t('文字')}</span>} error={diagnostic(error)}>
            <Textarea
              ref={target}
              dir="auto"
              rows={3}
              variant="outline"
              className="resize-y"
              maxLength={draft.kind === 'source' ? undefined : 8000}
              value={text}
              onChange={(event) => {
                const next = event.currentTarget.value
                setText(next)
                onInput(next)
              }}
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
              {t('取消')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSave} loading={busy}>
              {t('保存')}
            </Button>
          </div>
        </form>
      )}
    </dialog>,
    document.body,
  )
}
