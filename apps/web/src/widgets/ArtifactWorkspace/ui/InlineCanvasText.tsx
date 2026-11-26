import {
  type CanvasElementPresentation,
  type DesignLayerFontWeight,
  type ElementRef,
  resolveDesignLayerColors,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Textarea } from '@akasha/ui/textarea'
import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useMessages } from '@/shared/i18n'
import type { CanvasTextDraft } from '../hooks/useInlineCanvasText'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

const FONT_WEIGHTS: Record<DesignLayerFontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

/** 原地画布文本编辑框在画布视口内的精确投影盒。 */
export interface InlineCanvasBox {
  x: number
  y: number
  width: number
  height: number
  scale: number
  boardBackground: string
  /** 静态 HTML/React 文字原地编辑时复用沙盒上报的计算样式，保持所见即所得。 */
  sourceStyle?: CanvasElementPresentation
  /** 画布视口宽度，用于防止靠右边缘的元素原地编辑框被裁切。 */
  viewportWidth?: number
}

interface InlineTextProps {
  /** 源码文字、原生文字和只读提示共用同一个画布锚点。 */
  draft: CanvasTextDraft
  initialText?: string
  /** 仅当在总览画布原地编辑原生文本或便签时传入，直接落位到画板对应坐标。 */
  canvasBox?: InlineCanvasBox
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

/** 就地输入不启动试玩；原生文本与便签在画板上所见即所得输入，焦点内保留浏览器文本快捷键。 */
export function InlineCanvasText({
  draft,
  initialText,
  canvasBox,
  onInput,
  onSave,
  onClose,
  onAnnotate,
}: InlineTextProps) {
  const { t, dir } = useMessages(canvasToolsMessages)
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
  const inlineRoot = useRef<HTMLDivElement>(null)
  const id = useId()
  const isNew = draft.kind === 'create'
  const canSave = !busy && text !== initial && (!isNew || Boolean(text.trim()))
  const inlineLayer =
    canvasBox && (draft.kind === 'create' || draft.kind === 'native') ? draft.layer : null
  const inlineOnCanvas = Boolean(canvasBox && draft.kind !== 'readOnly')

  useEffect(() => {
    const previous = document.activeElement
    const focus = target.current ?? panel.current
    focus?.focus({ preventScroll: true })
    if (target.current && draft.kind !== 'create') {
      const len = target.current.value.length
      target.current.setSelectionRange?.(len, len)
    }
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        document.activeElement === document.body
      )
        previous.focus({ preventScroll: true })
    }
  }, [draft.kind])

  // 原地编辑器随内容与画布倍率变化自动增高，避免出现内部滚动条破坏所见即所得视觉。
  const inlineScale = canvasBox?.scale
  useLayoutEffect(() => {
    void text
    void inlineScale
    const el = target.current
    if (!el || !inlineOnCanvas) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 22)}px`
  }, [inlineOnCanvas, text, inlineScale])

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

  // 点击画布其他区域时自动确认保存（空内容或未修改则直接退出），切换视图或窗口失焦不触发。
  const handleOutsideCanvasPointer = useEffectEvent((event: PointerEvent) => {
    if (busy || !inlineRoot.current) return
    const node = event.target instanceof Element ? event.target : null
    if (!node || inlineRoot.current.contains(node)) return
    if (!node.closest('.artifact-canvas')) return
    if (canSave) void submit()
    else onClose()
  })

  useEffect(() => {
    if (!inlineOnCanvas) return
    document.addEventListener('pointerdown', handleOutsideCanvasPointer, true)
    return () => document.removeEventListener('pointerdown', handleOutsideCanvasPointer, true)
  }, [inlineOnCanvas])

  const title = t(draftTitle(draft))

  if (inlineOnCanvas && canvasBox) {
    const scale = Math.max(0.1, canvasBox.scale)
    const isNote = inlineLayer?.kind === 'note'
    const isSource = draft.kind === 'source'
    let boxBackground = 'transparent'
    let foreground = '#1c1b19'
    let fontSize = Math.max(12, 16 * scale)
    let fontWeight = 400
    let textAlign: CSSProperties['textAlign'] = 'left'
    if (inlineLayer) {
      const colors = resolveDesignLayerColors(inlineLayer, canvasBox.boardBackground)
      foreground = colors.foreground
      fontSize = Math.max(11, (inlineLayer.fontSize ?? 16) * scale)
      fontWeight = FONT_WEIGHTS[inlineLayer.fontWeight ?? 'normal']
      textAlign = inlineLayer.textAlign ?? 'left'
      if (isNote) boxBackground = colors.surface ?? '#fef3c7'
      else if (draft.kind === 'native') boxBackground = canvasBox.boardBackground
    } else if (isSource) {
      const style = canvasBox.sourceStyle
      boxBackground = style?.backgroundColor ?? canvasBox.boardBackground
      foreground = style?.color ?? '#1c1b19'
      fontSize = Math.max(12, (style?.fontSize ?? 14) * scale)
      fontWeight = style?.fontWeight ?? 400
      textAlign = style?.textAlign ?? 'left'
    }
    const paddingY = isNote ? Math.max(6, 8 * scale) : Math.max(2, 2.5 * scale)
    const paddingX = isNote ? Math.max(8, 10 * scale) : Math.max(4, 5 * scale)
    const minWidth = isSource ? Math.max(120, canvasBox.width + 20) : Math.max(96, canvasBox.width)
    const maxViewportWidth = canvasBox.viewportWidth
      ? Math.max(160, canvasBox.viewportWidth - 24)
      : 480
    const boxWidth = Math.min(maxViewportWidth, minWidth)
    const boxLeft = canvasBox.viewportWidth
      ? Math.max(12, Math.min(canvasBox.x, canvasBox.viewportWidth - boxWidth - 12))
      : canvasBox.x
    const showActionBar = Boolean(
      error || (draft.kind !== 'readOnly' && draft.restoredText !== undefined),
    )

    return (
      <div
        ref={inlineRoot}
        role="dialog"
        aria-label={title}
        data-testid="canvas-inline-text-editor"
        className="artifact-canvas-inline-text"
        style={{
          left: boxLeft,
          top: canvasBox.y,
          width: boxWidth,
          minHeight: Math.max(24, canvasBox.height),
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div
          className="artifact-canvas-inline-text-box"
          data-kind={inlineLayer?.kind ?? 'source'}
          data-filled={text.length > 0 || isSource ? 'true' : undefined}
          style={{
            backgroundColor: boxBackground,
            borderRadius: isNote ? Math.max(4, 5 * scale) : undefined,
            paddingBlock: paddingY,
            paddingInline: paddingX,
          }}
        >
          <textarea
            ref={target}
            dir="auto"
            rows={1}
            aria-label={t('文字')}
            placeholder={t(isNote ? '输入便签…' : '输入文本…')}
            maxLength={isSource ? undefined : 8000}
            value={text}
            disabled={busy}
            className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none caret-(--canvas-selection) placeholder:text-ink-muted/55"
            style={{
              color: foreground,
              fontFamily: 'system-ui, sans-serif',
              fontSize,
              fontWeight,
              textAlign,
              lineHeight: 1.35,
              minHeight: Math.max(18, canvasBox.height - paddingY * 2),
            }}
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
        </div>
        {error ? (
          <p
            role="alert"
            dir={dir}
            className="mt-1 rounded-md border border-destructive/30 bg-surface px-2 py-1 text-xs text-destructive shadow-xs"
          >
            {diagnostic(error)}
          </p>
        ) : null}
        <div
          dir={dir}
          data-visible={showActionBar ? 'true' : undefined}
          className={
            showActionBar
              ? 'artifact-canvas-inline-text-actions'
              : 'artifact-canvas-inline-text-actions sr-only focus-within:not-sr-only pointer-coarse:not-sr-only'
          }
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={onClose}
          >
            {t('取消')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="h-6 bg-(--canvas-selection) px-2.5 text-xs text-(--canvas-selection-foreground) hover:bg-(--canvas-selection-strong)"
            disabled={!canSave}
            loading={busy}
            onClick={() => void submit()}
          >
            {t('保存')}
          </Button>
        </div>
      </div>
    )
  }

  // 非模态对话框贴在命中点上（源码静态文字、单板展开或只读提示），打开和关闭均不改变画布布局。
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
