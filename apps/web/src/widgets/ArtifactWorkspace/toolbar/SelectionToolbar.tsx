import {
  type CanvasElementPresentation,
  type CanvasLayer,
  DEFAULT_ARTBOARD_APPEARANCE,
  DESIGN_LAYER_COLORS,
  DESIGN_LAYER_FONT_SIZES,
  DESIGN_LAYER_FONT_WEIGHTS,
  DESIGN_LAYER_PALETTE,
  type DesignLayer,
  type DesignLayerColor,
  type DesignLayerFontWeight,
  type DesignLayerPaletteColor,
  type DesignLayerTextAlign,
  type EditOp,
  type ElementRect,
  resolveDesignLayerColors,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Input } from '@akasha/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  FlipHorizontal2,
  FlipVertical2,
  MessageCircle,
  PencilLine,
} from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type RefObject, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import type { VisualEditTarget } from '@/features/visual-edit'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import { DESIGN_LAYER_COLOR_LABELS, isPaletteColor } from '../inspector/DesignLayerLayout'
import { updateTailwindTextClasses } from '../lib/canvas-layer-navigation'
import { cssColorToHex, evaluateColorContrast } from '../lib/color-contrast'
import type { SelectionToolbarAnchor } from '../ui/ArtifactCanvas'
import { canvasToolsMessages } from './canvas-tools-messages'

const WEIGHT_LABELS: Record<DesignLayerFontWeight, '常规' | '中等' | '半粗' | '粗体'> = {
  normal: '常规',
  medium: '中等',
  semibold: '半粗',
  bold: '粗体',
}

const WEIGHT_NUMERIC: Record<DesignLayerFontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

const HEX_COLOR = /^#[\da-f]{6}$/i
const DRAWER_INSET = 384

export interface SelectionToolbarProps {
  anchor: SelectionToolbarAnchor
  board: CanvasBoard
  runtimeLayer?: CanvasLayer
  designLayer?: DesignLayer
  /** 当命中节点超出图层树上限或尚未拉回快照时，直接使用沙盒上报的静态源码位置。 */
  sourceLoc?: string
  /** 选中元素在画板固有坐标系内的矩形，用于原地文字编辑精准落位。 */
  selectedRect?: ElementRect
  presentation: CanvasElementPresentation | null
  visualTarget: VisualEditTarget | null
  /** 仅在右栏停留在「属性」页签时成立；打开「源码」等其他页签不隐藏形状或文字快捷项。 */
  propertiesOpen: boolean
  /** 右侧检查器或批注抽屉打开时，浮栏位置避开抽屉占用区域，防止被遮挡。 */
  drawerOpen: boolean
  canEditBoards: boolean
  canEditText: boolean
  canComment: boolean
  editing?: CanvasBoardEditing
  textTools?: CanvasTextTools
  onApplyRuntimeOp: (op: EditOp) => Promise<boolean>
  onComment: (anchor: { x: number; y: number }) => void
}

function numericWeightToToken(weight: number | undefined): DesignLayerFontWeight {
  if (!weight || weight < 450) return 'normal'
  if (weight < 550) return 'medium'
  if (weight < 650) return 'semibold'
  return 'bold'
}

function nearestFontSize(size: number | undefined): number {
  if (!size) return 16
  let best: number = DESIGN_LAYER_FONT_SIZES[0]
  let diff = Math.abs(size - best)
  for (const candidate of DESIGN_LAYER_FONT_SIZES) {
    const next = Math.abs(size - candidate)
    if (next < diff) {
      diff = next
      best = candidate
    }
  }
  return best
}

function resolveCurrentAlign(
  designLayer: DesignLayer | undefined,
  presentation: CanvasElementPresentation | null,
): DesignLayerTextAlign {
  if (designLayer?.kind === 'text' || designLayer?.kind === 'note') {
    return designLayer.textAlign ?? 'left'
  }
  if (presentation?.textAlign === 'center' || presentation?.textAlign === 'right') {
    return presentation.textAlign
  }
  return 'left'
}

function focusableToolbarControls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function resolveToolbarBox(
  anchor: SelectionToolbarAnchor,
  drawerOpen: boolean,
  dir: 'ltr' | 'rtl',
) {
  const viewportWidth = anchor.viewport.width || 960
  const viewportHeight = anchor.viewport.height || 720
  const reserved = drawerOpen ? Math.min(DRAWER_INSET, Math.max(0, viewportWidth - 280)) : 0
  const minLeft = dir === 'rtl' ? 12 + reserved : 12
  const maxRight = dir === 'rtl' ? viewportWidth - 12 : viewportWidth - 12 - reserved
  const availableWidth = Math.max(220, maxRight - minLeft)
  const estimatedWidth = Math.min(380, availableWidth)
  const maxLeft = Math.max(minLeft, maxRight - estimatedWidth)
  const left = Math.max(minLeft, Math.min(anchor.rect.x, maxLeft))
  const topAbove = anchor.rect.y - 40
  const maxTop = Math.max(56, viewportHeight - 96)
  const top =
    topAbove >= 56
      ? Math.min(maxTop, topAbove)
      : Math.min(maxTop, Math.max(56, anchor.rect.y + anchor.rect.height + 8))
  return { left, top, maxWidth: availableWidth }
}

/**
 * 贴靠选中对象的上下文浮栏：随文字、形状或流元素切换动作，与检查器「属性」页签去重，
 * 在只读视图下保留检查与对比度提示，并通过 F6 / Esc 与画布对象往返焦点。
 */
export function SelectionToolbar({
  anchor,
  board,
  runtimeLayer,
  designLayer,
  sourceLoc,
  selectedRect,
  presentation,
  visualTarget,
  propertiesOpen,
  drawerOpen,
  canEditBoards,
  canEditText,
  canComment,
  editing,
  textTools,
  onApplyRuntimeOp,
  onComment,
}: SelectionToolbarProps) {
  const { t, dir } = useMessages(canvasToolsMessages)
  const [colorOpen, setColorOpen] = useState(false)
  const [hexDraft, setHexDraft] = useState('')

  const boardBackground = board.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background
  const isNativeText = designLayer?.kind === 'text' || designLayer?.kind === 'note'
  const isNativeShape =
    designLayer?.kind === 'rectangle' ||
    designLayer?.kind === 'ellipse' ||
    designLayer?.kind === 'stroke'
  const isRuntimeText =
    !designLayer &&
    Boolean(
      (visualTarget && visualTarget.text !== null) ||
        presentation?.isText ||
        (runtimeLayer &&
          /^(?:h[1-6]|p|span|a|button|label|li|strong|em|small|blockquote)$/.test(
            runtimeLayer.tag,
          )),
    )
  const isText = isNativeText || isRuntimeText
  const activeSourceLoc = runtimeLayer?.sourceLoc ?? sourceLoc
  const canEditNative = Boolean(designLayer && canEditBoards && editing?.available)
  const canEditRuntime = Boolean(
    !designLayer && canEditText && activeSourceLoc && visualTarget && editing?.available,
  )
  const canEdit = isNativeText || isNativeShape ? canEditNative : canEditRuntime

  // 与检查器「属性」页签中已有编辑项去重；「源码」等其他页签不影响浮栏快捷动作。
  const hideDuplicatedColor = Boolean(designLayer && propertiesOpen && canEditNative)
  const hideDuplicatedEditText = Boolean(isNativeText && propertiesOpen && canEditNative)
  const hideDuplicatedComment = Boolean(propertiesOpen && canComment)

  const resolvedNative = designLayer
    ? resolveDesignLayerColors(designLayer, boardBackground)
    : undefined
  const activeSwatchColor = isNativeShape
    ? (resolvedNative?.surface ?? resolvedNative?.foreground ?? '#174f8f')
    : (resolvedNative?.foreground ?? presentation?.color ?? '#202733')
  const normalizedSwatchHex = cssColorToHex(activeSwatchColor) ?? activeSwatchColor
  const contrastBg =
    resolvedNative?.contrastBackground ?? presentation?.backgroundColor ?? boardBackground

  const currentFontSize = isNativeText
    ? (designLayer.fontSize ?? 16)
    : Math.round(presentation?.fontSize ?? 16)
  const currentFontWeight: DesignLayerFontWeight = isNativeText
    ? (designLayer.fontWeight ?? 'normal')
    : numericWeightToToken(presentation?.fontWeight)
  const currentAlign = resolveCurrentAlign(designLayer, presentation)

  const contrast = isText
    ? evaluateColorContrast(activeSwatchColor, contrastBg, {
        fontSize: currentFontSize,
        fontWeight: WEIGHT_NUMERIC[currentFontWeight],
      })
    : null
  const draftContrast =
    isText && colorOpen && HEX_COLOR.test(hexDraft.trim())
      ? evaluateColorContrast(hexDraft.trim(), contrastBg, {
          fontSize: currentFontSize,
          fontWeight: WEIGHT_NUMERIC[currentFontWeight],
        })
      : null

  const flowOrder = !designLayer ? visualTarget?.order : null
  const flowIndex =
    flowOrder && activeSourceLoc
      ? flowOrder.siblings.findIndex((item) => item.loc === activeSourceLoc)
      : -1
  const canMoveUp = Boolean(canEditRuntime && flowOrder && flowIndex > 0)
  const canMoveDown = Boolean(
    canEditRuntime && flowOrder && flowIndex >= 0 && flowIndex < flowOrder.siblings.length - 1,
  )

  const applyNativeStyle = (patch: {
    color?: DesignLayerColor | null
    fontSize?: number | null
    fontWeight?: DesignLayerFontWeight | null
    textAlign?: DesignLayerTextAlign | null
  }) => {
    if (!designLayer || !canEditNative || !editing) return
    void editing.change({
      kind: 'layerStyle',
      boardId: board.id,
      layerIds: [designLayer.id],
      patch,
    })
  }

  const applyRuntimeStyle = (patch: {
    fontSize?: number
    fontWeight?: DesignLayerFontWeight
    textAlign?: DesignLayerTextAlign
    colorHex?: string
  }) => {
    if (!canEditRuntime || !activeSourceLoc || !visualTarget) return
    const nextClassName = updateTailwindTextClasses(visualTarget.className, patch)
    if (nextClassName === visualTarget.className) return
    void onApplyRuntimeOp({ kind: 'className', loc: activeSourceLoc, value: nextClassName })
  }

  const applyColorChoice = (choice: DesignLayerColor) => {
    if (designLayer) {
      applyNativeStyle({ color: choice })
      setColorOpen(false)
      return
    }
    const hex = isPaletteColor(choice) ? DESIGN_LAYER_PALETTE[choice].foreground : choice
    applyRuntimeStyle({ colorHex: hex })
    setColorOpen(false)
  }

  const submitCustomHex = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = hexDraft.trim()
    if (!HEX_COLOR.test(normalized)) return
    applyColorChoice(normalized.toLowerCase() as DesignLayerColor)
  }

  const showEditText =
    !hideDuplicatedEditText &&
    ((isNativeText && canEditNative && Boolean(textTools)) ||
      (isRuntimeText && canEditRuntime && visualTarget?.text !== null && Boolean(textTools)))
  const showColor =
    (isText || isNativeShape) && !hideDuplicatedColor && (canEdit || Boolean(activeSwatchColor))
  const showFlip = isNativeShape && canEditNative
  const showFlowReorder = Boolean(canEditRuntime && flowOrder && flowOrder.siblings.length > 1)
  const showComment = canComment && !hideDuplicatedComment

  if (!showEditText && !isText && !showColor && !showFlip && !showFlowReorder && !showComment) {
    return null
  }

  const box = resolveToolbarBox(anchor, drawerOpen, dir)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && !colorOpen) {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopPropagation()
      anchor.returnFocusToTarget()
      return
    }
    if (event.key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopPropagation()
      anchor.returnFocusToTarget()
      return
    }
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, textarea, select')) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const root = anchor.toolbarRef.current
    if (!root) return
    const items = focusableToolbarControls(root)
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (currentIndex === -1 || items.length < 2) return
    event.preventDefault()
    const forward = (event.key === 'ArrowRight') !== (dir === 'rtl')
    const next = items[(currentIndex + (forward ? 1 : -1) + items.length) % items.length]
    next?.focus({ preventScroll: true })
  }

  let colorControlLabel = t('文字颜色')
  if (designLayer?.kind === 'rectangle' || designLayer?.kind === 'ellipse') {
    colorControlLabel = t('填充')
  } else if (designLayer?.kind === 'stroke') {
    colorControlLabel = t('描边')
  }

  const formatContrastLevel = (level: 'AAA' | 'AA' | 'AA-large' | 'fail') =>
    level === 'fail' ? t('对比度偏低') : level

  let typographySection = null
  if (isText && canEdit) {
    typographySection = (
      <>
        <Select
          value={String(nearestFontSize(currentFontSize))}
          onValueChange={(value) => {
            const fontSize = Number.parseInt(value, 10)
            if (!Number.isInteger(fontSize)) return
            if (designLayer) applyNativeStyle({ fontSize })
            else applyRuntimeStyle({ fontSize })
          }}
        >
          <SelectTrigger
            controlSize="sm"
            aria-label={t('字号')}
            className="w-[4.875rem] tabular-nums"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DESIGN_LAYER_FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={currentFontWeight}
          onValueChange={(value) => {
            const fontWeight = value as DesignLayerFontWeight
            if (designLayer) applyNativeStyle({ fontWeight })
            else applyRuntimeStyle({ fontWeight })
          }}
        >
          <SelectTrigger controlSize="sm" aria-label={t('字重')} className="w-[4.75rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DESIGN_LAYER_FONT_WEIGHTS.map((weight) => (
              <SelectItem key={weight} value={weight}>
                {t(WEIGHT_LABELS[weight])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>
    )
  } else if (isText) {
    typographySection = (
      <span
        dir="ltr"
        className="rounded bg-surface-subtle px-1.5 py-1 text-xs text-ink-muted tabular-nums"
      >
        {currentFontSize}px · {t(WEIGHT_LABELS[currentFontWeight])}
      </span>
    )
  }

  let colorSection = null
  if (showColor && canEdit) {
    colorSection = (
      <Popover
        open={colorOpen}
        onOpenChange={(next) => {
          setColorOpen(next)
          if (next) setHexDraft(cssColorToHex(activeSwatchColor) ?? '#202733')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={colorControlLabel}
            title={colorControlLabel}
          >
            <span
              aria-hidden="true"
              className="inline-block size-3.5 rounded-sm border border-black/15 shadow-2xs"
              style={{ backgroundColor: activeSwatchColor }}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={8}
          className="w-56 space-y-2.5 rounded-xl border border-ol bg-popover/96 p-2.5 shadow-(--shadow-float) backdrop-blur-lg"
          aria-label={colorControlLabel}
        >
          <div className="flex items-center justify-between gap-1">
            {DESIGN_LAYER_COLORS.map((key: DesignLayerPaletteColor) => {
              const swatch = DESIGN_LAYER_PALETTE[key]
              const preview = isNativeShape ? swatch.surface : swatch.foreground
              const selected =
                designLayer?.color === key ||
                normalizedSwatchHex.toLowerCase() === preview.toLowerCase()
              const label = t(DESIGN_LAYER_COLOR_LABELS[key])
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={selected}
                  className={`inline-flex size-7 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-(--canvas-selection) ${
                    selected
                      ? 'ring-2 ring-(--canvas-selection) ring-offset-2 ring-offset-popover'
                      : 'ring-1 ring-border/70'
                  }`}
                  onClick={() => applyColorChoice(key)}
                >
                  <span
                    aria-hidden="true"
                    className="size-5 rounded-full border border-black/10"
                    style={{ backgroundColor: preview }}
                  />
                </button>
              )
            })}
          </div>
          <form className="flex items-center gap-1.5" onSubmit={submitCustomHex}>
            <label className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border">
              <span className="sr-only">{colorControlLabel}</span>
              <input
                type="color"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                value={HEX_COLOR.test(hexDraft.trim()) ? hexDraft.trim() : normalizedSwatchHex}
                onChange={(event) => {
                  const next = event.currentTarget.value
                  setHexDraft(next)
                  applyColorChoice(next.toLowerCase() as DesignLayerColor)
                }}
              />
              <span
                aria-hidden="true"
                className="size-full"
                style={{
                  backgroundColor: HEX_COLOR.test(hexDraft.trim())
                    ? hexDraft.trim()
                    : normalizedSwatchHex,
                }}
              />
            </label>
            <Input
              type="text"
              controlSize="sm"
              dir="ltr"
              aria-label={t('自定义颜色')}
              placeholder="#202733"
              className="h-7 flex-1 font-mono text-xs"
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
            />
            <Button
              size="sm"
              type="submit"
              disabled={!HEX_COLOR.test(hexDraft.trim())}
              className="h-7 shrink-0 rounded-lg bg-(--canvas-selection) px-2.5 text-xs text-(--canvas-selection-foreground) hover:bg-(--canvas-selection-strong)"
            >
              {t('应用')}
            </Button>
          </form>
          {draftContrast ? (
            <p
              className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${
                draftContrast.level === 'fail'
                  ? 'bg-destructive/10 font-medium text-destructive'
                  : 'bg-surface-subtle text-ink-muted'
              }`}
            >
              {t('对比度 {ratio} · {level}', {
                ratio: draftContrast.formatted,
                level: formatContrastLevel(draftContrast.level),
              })}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    )
  } else if (showColor) {
    colorSection = (
      <span className="inline-flex items-center gap-1 rounded bg-surface-subtle px-1.5 py-1 text-xs text-ink-muted">
        <span className="sr-only">{colorControlLabel}</span>
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full border border-border"
          style={{ backgroundColor: activeSwatchColor }}
        />
        <span dir="ltr" className="font-mono">
          {normalizedSwatchHex}
        </span>
      </span>
    )
  }

  return (
    <div
      ref={anchor.toolbarRef as RefObject<HTMLDivElement>}
      role="toolbar"
      tabIndex={-1}
      dir={dir}
      aria-label={t('选区工具栏')}
      data-testid="selection-toolbar"
      className="artifact-canvas-selection-toolbar"
      style={{ left: box.left, top: box.top, maxWidth: box.maxWidth }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {showEditText ? (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label={t('编辑文字')}
          title={t('编辑文字')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (isNativeText && designLayer) {
              textTools?.edit(board, designLayer, { x: rect.left, y: rect.bottom + 6 })
            } else if (activeSourceLoc && visualTarget?.text !== null && visualTarget) {
              textTools?.editSource(
                board,
                activeSourceLoc,
                visualTarget.text,
                { x: rect.left, y: rect.bottom + 6 },
                selectedRect,
                presentation ?? undefined,
              )
            }
          }}
        >
          <PencilLine size={13} />
        </Button>
      ) : null}

      {typographySection}
      {colorSection}

      {contrast ? (
        <output
          data-testid="selection-contrast-hint"
          aria-live="polite"
          className={`rounded-md px-1.5 py-0.5 text-[11px] leading-tight tabular-nums ${
            contrast.level === 'fail'
              ? 'bg-destructive/10 font-medium text-destructive'
              : 'bg-surface-subtle text-ink-muted'
          }`}
        >
          {t('对比度 {ratio} · {level}', {
            ratio: contrast.formatted,
            level: formatContrastLevel(contrast.level),
          })}
        </output>
      ) : null}

      {isText ? (
        <fieldset aria-label={t('对齐方式')} className="flex items-center gap-0.5">
          {(
            [
              ['left', '文字左对齐', AlignLeft],
              ['center', '文字居中', AlignCenter],
              ['right', '文字右对齐', AlignRight],
            ] as const
          ).map(([align, label, Icon]) => (
            <Button
              key={align}
              size="sm"
              variant={currentAlign === align ? 'secondary' : 'ghost'}
              iconOnly
              disabled={!canEdit}
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={currentAlign === align}
              onClick={() => {
                if (designLayer) applyNativeStyle({ textAlign: align })
                else applyRuntimeStyle({ textAlign: align })
              }}
            >
              <Icon size={13} />
            </Button>
          ))}
        </fieldset>
      ) : null}

      {showFlip ? (
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant={designLayer?.flipX ? 'secondary' : 'ghost'}
            iconOnly
            aria-label={t('水平翻转')}
            title={`${t('水平翻转')} (Shift+H)`}
            aria-pressed={Boolean(designLayer?.flipX)}
            onClick={() => anchor.onFlip('horizontal')}
          >
            <FlipHorizontal2 size={13} />
          </Button>
          <Button
            size="sm"
            variant={designLayer?.flipY ? 'secondary' : 'ghost'}
            iconOnly
            aria-label={t('垂直翻转')}
            title={`${t('垂直翻转')} (Shift+V)`}
            aria-pressed={Boolean(designLayer?.flipY)}
            onClick={() => anchor.onFlip('vertical')}
          >
            <FlipVertical2 size={13} />
          </Button>
        </div>
      ) : null}

      {showFlowReorder ? (
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canMoveUp}
            aria-label={t('上移一层')}
            title={`${t('上移一层')} (Alt+↑)`}
            onClick={() => anchor.onReorderFlow(-1)}
          >
            <ArrowUp size={13} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            disabled={!canMoveDown}
            aria-label={t('下移一层')}
            title={`${t('下移一层')} (Alt+↓)`}
            onClick={() => anchor.onReorderFlow(1)}
          >
            <ArrowDown size={13} />
          </Button>
        </div>
      ) : null}

      {showComment ? (
        <>
          {showEditText || isText || showColor || showFlip || showFlowReorder ? (
            <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/80" />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={t('批注')}
            title={t('批注')}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onComment({ x: rect.left, y: rect.bottom + 8 })
            }}
          >
            <MessageCircle size={13} />
          </Button>
        </>
      ) : null}
    </div>
  )
}
