import {
  ARTBOARD_GEOMETRY_LIMITS,
  type CanvasElementPresentation,
  type CanvasLayer,
  type CanvasLayerStyles,
  DEFAULT_ARTBOARD_APPEARANCE,
  DESIGN_LAYER_FONT_SIZES,
  DESIGN_LAYER_FONT_WEIGHTS,
  type DesignLayer,
  type DesignLayerFontWeight,
  type DesignLayerTextAlign,
  type EditOp,
  type ElementRect,
  type ElementRef,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Segmented } from '@akasha/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Skeleton } from '@akasha/ui/skeleton'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, PencilLine } from 'lucide-react'
import { useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import type { VisualEditTarget } from '@/features/visual-edit'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import { updateTailwindTextClasses } from '../lib/canvas-layer-navigation'
import { cssColorToHex, evaluateColorContrast } from '../lib/color-contrast'
import { patchHtmlElementGeometry } from '../lib/html-element-geometry'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import {
  InspectorColorInput,
  InspectorNumberInput,
  InspectorRow,
  InspectorSection,
  InspectorValuePill,
} from '../ui/inspector-controls'
import { BoardPrintSettings } from './BoardPrintSettings'
import { DESIGN_LAYER_COLOR_LABELS, DesignLayerLayout, isPaletteColor } from './DesignLayerLayout'
import { panelMessages } from './messages'

interface BoardInspectorPropertiesProps {
  board: CanvasBoard
  pageTitle?: string
  designLayer?: DesignLayer
  runtimeLayer?: CanvasLayer
  styles?: CanvasLayerStyles
  advancedOpen?: boolean
  onAdvancedOpenChange?: (open: boolean) => void
  selectedElement?: ElementRef | null
  sourceLoc?: string
  presentation?: CanvasElementPresentation | null
  visualTarget?: VisualEditTarget | null
  /** 只有声明的原生图层能加入多选布局操作。 */
  selectedDesignLayers: readonly DesignLayer[]
  /** 无写权限或非当前头版时不传；运行时节点不使用画板原生布局编辑器。 */
  editing?: CanvasBoardEditing
  /** 静态 HTML/React 元素直改（含单板 HTML）使用的编辑控制器。 */
  elementEditing?: CanvasBoardEditing
  onEditText?: CanvasTextTools['edit']
  onEditSourceText?: CanvasTextTools['editSource']
  onApplyRuntimeOp?: (op: EditOp) => Promise<boolean>
  readFullSource?: () => Promise<string | null | undefined>
  onHtmlElementSaved?: (
    boardId: string,
    loc: string,
    rect: ElementRect | undefined,
    version: number,
  ) => void
}

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

function resolveRuntimeAlign(presentation: CanvasElementPresentation | null | undefined) {
  if (presentation?.textAlign === 'center' || presentation?.textAlign === 'right') {
    return presentation.textAlign
  }
  return 'left' as const
}

/** 根据当前选中的对象（原生图层 / 运行时 HTML 元素 / 画板）动态渲染全宽模块化属性区块。 */
export function BoardInspectorProperties({
  board,
  designLayer,
  runtimeLayer,
  styles,
  advancedOpen,
  onAdvancedOpenChange,
  selectedElement,
  sourceLoc,
  presentation,
  visualTarget,
  selectedDesignLayers,
  editing,
  elementEditing,
  onEditText,
  onEditSourceText,
  onApplyRuntimeOp,
  readFullSource,
  onHtmlElementSaved,
}: BoardInspectorPropertiesProps) {
  const { t } = useMessages(panelMessages)
  const { t: toolText } = useMessages(canvasToolsMessages)

  if (designLayer) {
    const textLayer = designLayer.kind === 'text' || designLayer.kind === 'note'
    const canEditText = textLayer && onEditText
    const customColor = designLayer.color !== undefined && !isPaletteColor(designLayer.color)
    let layerColorText = toolText(DESIGN_LAYER_COLOR_LABELS.auto)
    if (designLayer.color !== undefined) {
      layerColorText = isPaletteColor(designLayer.color)
        ? toolText(DESIGN_LAYER_COLOR_LABELS[designLayer.color])
        : designLayer.color
    }
    const textProps =
      designLayer.kind === 'text' || designLayer.kind === 'note' ? designLayer : null
    const currentSize = textProps?.fontSize ?? 16
    const currentWeight: DesignLayerFontWeight = textProps?.fontWeight ?? 'normal'
    const currentAlign: DesignLayerTextAlign = textProps?.textAlign ?? 'left'

    const applyNativeStyle = (patch: {
      fontSize?: number | null
      fontWeight?: DesignLayerFontWeight | null
      textAlign?: DesignLayerTextAlign | null
    }) => {
      if (!editing?.available) return
      void editing.change({
        kind: 'layerStyle',
        boardId: board.id,
        layerIds: [designLayer.id],
        patch,
      })
    }

    return (
      <section aria-label={t('原生图层属性')} className="divide-y divide-border/75">
        {textLayer && (editing || canEditText) ? (
          <InspectorSection
            title={t('文本')}
            action={
              canEditText ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-[7px] px-2 text-xs text-ink-muted hover:text-ink"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    onEditText(board, designLayer, { x: rect.left, y: rect.top })
                  }}
                >
                  <PencilLine size={12} aria-hidden="true" />
                  {t('编辑文字')}
                </Button>
              ) : undefined
            }
          >
            {editing ? (
              <>
                <InspectorRow label={t('字重')}>
                  <Select
                    value={currentWeight}
                    disabled={!editing.available}
                    onValueChange={(value) =>
                      applyNativeStyle({ fontWeight: value as DesignLayerFontWeight })
                    }
                  >
                    <SelectTrigger aria-label={t('字重')} controlSize="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DESIGN_LAYER_FONT_WEIGHTS.map((weight) => (
                        <SelectItem key={weight} value={weight}>
                          {toolText(WEIGHT_LABELS[weight])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </InspectorRow>
                <InspectorRow label={t('字号')}>
                  <Select
                    value={String(nearestFontSize(currentSize))}
                    disabled={!editing.available}
                    onValueChange={(value) => {
                      const fontSize = Number.parseInt(value, 10)
                      if (Number.isInteger(fontSize)) applyNativeStyle({ fontSize })
                    }}
                  >
                    <SelectTrigger aria-label={t('字号')} controlSize="sm">
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
                </InspectorRow>
                <InspectorRow label={t('对齐')}>
                  <Segmented
                    block
                    size="sm"
                    rounded="md"
                    aria-label={t('对齐')}
                    disabled={!editing.available}
                    value={currentAlign}
                    onValueChange={(align) =>
                      applyNativeStyle({ textAlign: align as DesignLayerTextAlign })
                    }
                    segments={[
                      {
                        value: 'left',
                        label: '',
                        icon: <AlignLeft size={14} aria-hidden="true" />,
                        ariaLabel: toolText('文字左对齐'),
                        title: toolText('文字左对齐'),
                      },
                      {
                        value: 'center',
                        label: '',
                        icon: <AlignCenter size={14} aria-hidden="true" />,
                        ariaLabel: toolText('文字居中'),
                        title: toolText('文字居中'),
                      },
                      {
                        value: 'right',
                        label: '',
                        icon: <AlignRight size={14} aria-hidden="true" />,
                        ariaLabel: toolText('文字右对齐'),
                        title: toolText('文字右对齐'),
                      },
                    ]}
                  />
                </InspectorRow>
              </>
            ) : null}
          </InspectorSection>
        ) : null}

        {!editing && (
          <>
            <InspectorSection title={t('尺寸')}>
              <InspectorRow label={t('尺寸')}>
                <InspectorValuePill>
                  {designLayer.width} × {designLayer.height} px
                </InspectorValuePill>
              </InspectorRow>
              <InspectorRow label={t('位置')}>
                <div className="grid grid-cols-2 gap-1.5">
                  <InspectorValuePill prefix="X">{designLayer.x}</InspectorValuePill>
                  <InspectorValuePill prefix="Y">{designLayer.y}</InspectorValuePill>
                </div>
              </InspectorRow>
            </InspectorSection>
            <InspectorSection title={t('外观')}>
              <InspectorRow label={t('颜色')}>
                <InspectorValuePill dir={customColor ? 'ltr' : undefined}>
                  {layerColorText}
                </InspectorValuePill>
              </InspectorRow>
            </InspectorSection>
          </>
        )}

        {editing && (
          <DesignLayerLayout
            boardId={board.id}
            layer={designLayer}
            selected={selectedDesignLayers}
            editing={editing}
          />
        )}
      </section>
    )
  }

  if (runtimeLayer || selectedElement) {
    return (
      <RuntimeElementProperties
        board={board}
        runtimeLayer={runtimeLayer}
        styles={styles}
        advancedOpen={advancedOpen}
        onAdvancedOpenChange={onAdvancedOpenChange}
        selectedElement={selectedElement ?? null}
        sourceLoc={runtimeLayer?.sourceLoc ?? sourceLoc}
        presentation={presentation ?? null}
        visualTarget={visualTarget ?? null}
        editing={elementEditing ?? editing}
        onEditSourceText={onEditSourceText}
        onApplyRuntimeOp={onApplyRuntimeOp}
        readFullSource={readFullSource}
        onHtmlElementSaved={onHtmlElementSaved}
      />
    )
  }

  const current = boardProperties(board)
  return (
    <section aria-label={t('画板属性')} className="divide-y divide-border/75">
      {!editing && (
        <>
          <InspectorSection title={t('画板')}>
            <InspectorRow label={t('尺寸')}>
              <InspectorValuePill suffix="px">
                {current.width} × {current.height}
              </InspectorValuePill>
            </InspectorRow>
          </InspectorSection>
          <InspectorSection title={t('外观')}>
            <InspectorRow label={t('背景')}>
              <div
                dir="ltr"
                className="flex h-8 items-center gap-2.5 rounded-[8px] bg-surface-subtle px-2 font-mono text-[13px] text-ink"
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-5 shrink-0 rounded-[5px] border border-black/12 dark:border-white/18"
                  style={{ backgroundColor: current.background }}
                />
                <span>{current.background}</span>
              </div>
            </InspectorRow>
            <InspectorRow label={t('圆角')}>
              <InspectorValuePill suffix="px">{current.cornerRadius}</InspectorValuePill>
            </InspectorRow>
          </InspectorSection>
        </>
      )}
      {editing && <BoardAppearanceForm boardId={board.id} current={current} editing={editing} />}
      {board.scoped && <BoardPrintSettings board={board} editing={editing} />}
    </section>
  )
}

interface RuntimeElementPropertiesProps {
  board: CanvasBoard
  runtimeLayer?: CanvasLayer
  styles?: CanvasLayerStyles
  advancedOpen?: boolean
  onAdvancedOpenChange?: (open: boolean) => void
  selectedElement: ElementRef | null
  sourceLoc?: string
  presentation: CanvasElementPresentation | null
  visualTarget: VisualEditTarget | null
  editing?: CanvasBoardEditing
  onEditSourceText?: CanvasTextTools['editSource']
  onApplyRuntimeOp?: (op: EditOp) => Promise<boolean>
  readFullSource?: () => Promise<string | null | undefined>
  onHtmlElementSaved?: (
    boardId: string,
    loc: string,
    rect: ElementRect | undefined,
    version: number,
  ) => void
}

function RuntimeElementProperties({
  board,
  runtimeLayer,
  styles,
  advancedOpen,
  onAdvancedOpenChange,
  selectedElement,
  sourceLoc,
  presentation,
  visualTarget,
  editing,
  onEditSourceText,
  onApplyRuntimeOp,
  readFullSource,
  onHtmlElementSaved,
}: RuntimeElementPropertiesProps) {
  const { t } = useMessages(panelMessages)
  const { t: toolText } = useMessages(canvasToolsMessages)

  const tag = runtimeLayer?.tag ?? ''
  const rect = selectedElement?.rect
  const measuredWidth = runtimeLayer?.width ?? (rect ? Math.round(rect.width) : 0)
  const measuredHeight = runtimeLayer?.height ?? (rect ? Math.round(rect.height) : 0)

  const canResizeHtml = Boolean(
    editing?.available &&
      board.type === 'html' &&
      !board.generated &&
      sourceLoc &&
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      (board.scoped || readFullSource),
  )
  const canEditRuntime = Boolean(
    editing?.available && sourceLoc && visualTarget && onApplyRuntimeOp,
  )
  const isRuntimeText = Boolean(
    (visualTarget && visualTarget.text !== null) ||
      presentation?.isText ||
      (tag && /^(?:h[1-6]|p|span|a|button|label|li|strong|em|small|blockquote)$/.test(tag)),
  )

  const [sizeDraft, setSizeDraft] = useState<{ width: number; height: number } | null>(null)
  const [colorPreview, setColorPreview] = useState<string | null>(null)
  const widthValue = sizeDraft?.width ?? measuredWidth
  const heightValue = sizeDraft?.height ?? measuredHeight
  const sizeChanged =
    sizeDraft !== null &&
    (sizeDraft.width !== measuredWidth || sizeDraft.height !== measuredHeight) &&
    Number.isFinite(sizeDraft.width) &&
    Number.isFinite(sizeDraft.height) &&
    sizeDraft.width >= 1 &&
    sizeDraft.height >= 1

  const commitSize = async (nextDraft = sizeDraft) => {
    if (
      !canResizeHtml ||
      !nextDraft ||
      !editing ||
      !sourceLoc ||
      !rect ||
      !Number.isFinite(nextDraft.width) ||
      !Number.isFinite(nextDraft.height) ||
      nextDraft.width < 1 ||
      nextDraft.height < 1 ||
      (nextDraft.width === measuredWidth && nextDraft.height === measuredHeight)
    ) {
      setSizeDraft(null)
      return
    }
    const patch = {
      ...(nextDraft.width !== measuredWidth ? { width: Math.round(nextDraft.width) } : {}),
      ...(nextDraft.height !== measuredHeight ? { height: Math.round(nextDraft.height) } : {}),
    }
    const nextRect: ElementRect = {
      x: rect.x,
      y: rect.y,
      width: Math.round(nextDraft.width),
      height: Math.round(nextDraft.height),
    }
    if (board.scoped) {
      const ok = await editing.change(
        { kind: 'htmlElementGeometry', boardId: board.id, loc: sourceLoc, ...patch },
        editing.version,
        (saved) => onHtmlElementSaved?.(board.id, sourceLoc, nextRect, saved.version),
      )
      if (ok) setSizeDraft(null)
      return
    }
    const full = await readFullSource?.()
    if (!full) return
    const nextSource = patchHtmlElementGeometry(full, sourceLoc, patch)
    if (nextSource === full) {
      setSizeDraft(null)
      return
    }
    const ok = await editing.replaceSource(nextSource, editing.version, (saved) =>
      onHtmlElementSaved?.(board.id, sourceLoc, nextRect, saved.version),
    )
    if (ok) setSizeDraft(null)
  }

  const currentFontSize = Math.round(presentation?.fontSize ?? 16)
  const currentFontWeight = numericWeightToToken(presentation?.fontWeight)
  const currentAlign = resolveRuntimeAlign(presentation)
  const boardBackground = board.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background
  const currentColorHex = colorPreview ?? cssColorToHex(presentation?.color ?? '') ?? '#202733'
  const contrastBg = presentation?.backgroundColor ?? boardBackground
  const contrast =
    isRuntimeText && presentation?.color
      ? evaluateColorContrast(presentation.color, contrastBg, {
          fontSize: currentFontSize,
          fontWeight: WEIGHT_NUMERIC[currentFontWeight],
        })
      : null

  const applyRuntimeStyle = (patch: {
    fontSize?: number
    fontWeight?: DesignLayerFontWeight
    textAlign?: DesignLayerTextAlign
    colorHex?: string
  }) => {
    if (!canEditRuntime || !sourceLoc || !visualTarget || !onApplyRuntimeOp) return
    const nextClassName = updateTailwindTextClasses(visualTarget.className, patch)
    if (nextClassName === visualTarget.className) return
    void onApplyRuntimeOp({ kind: 'className', loc: sourceLoc, value: nextClassName })
  }

  const flowOrder = visualTarget?.order
  const flowIndex =
    flowOrder && sourceLoc ? flowOrder.siblings.findIndex((item) => item.loc === sourceLoc) : -1
  const canReorder = Boolean(canEditRuntime && flowOrder && flowOrder.siblings.length > 1)
  const canMoveUp = canReorder && flowIndex > 0
  const canMoveDown = Boolean(
    canReorder && flowIndex >= 0 && flowOrder && flowIndex < flowOrder.siblings.length - 1,
  )

  const reorder = (delta: -1 | 1) => {
    if (!canReorder || !flowOrder || !sourceLoc || !onApplyRuntimeOp) return
    const targetIndex = flowIndex + delta
    if (targetIndex < 0 || targetIndex >= flowOrder.siblings.length) return
    void onApplyRuntimeOp({
      kind: 'move',
      loc: sourceLoc,
      targetParentLoc: flowOrder.parentLoc,
      index: targetIndex,
    })
  }

  const matchedStyles = runtimeLayer && styles?.layerId === runtimeLayer.id ? styles : undefined

  return (
    <section aria-label={t('运行图层属性')} className="divide-y divide-border/75">
      {canReorder ? (
        <div className="grid grid-cols-2 gap-1.5 px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveUp}
            className="h-7 gap-1 rounded-[7px] text-xs text-ink-muted hover:text-ink"
            onClick={() => reorder(-1)}
          >
            <ArrowUp size={13} aria-hidden="true" />
            {t('上移一层')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveDown}
            className="h-7 gap-1 rounded-[7px] text-xs text-ink-muted hover:text-ink"
            onClick={() => reorder(1)}
          >
            <ArrowDown size={13} aria-hidden="true" />
            {t('下移一层')}
          </Button>
        </div>
      ) : null}

      {isRuntimeText ? (
        <InspectorSection
          title={t('文本')}
          action={
            canEditRuntime &&
            sourceLoc &&
            visualTarget?.text !== null &&
            visualTarget &&
            onEditSourceText ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-[7px] px-2 text-xs text-ink-muted hover:text-ink"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  onEditSourceText(
                    board,
                    sourceLoc,
                    visualTarget.text ?? '',
                    { x: box.left, y: box.bottom + 6 },
                    rect,
                    presentation ?? undefined,
                  )
                }}
              >
                <PencilLine size={12} aria-hidden="true" />
                {t('编辑文字')}
              </Button>
            ) : undefined
          }
        >
          {canEditRuntime ? (
            <>
              <InspectorRow label={t('字重')}>
                <Select
                  value={currentFontWeight}
                  onValueChange={(value) =>
                    applyRuntimeStyle({ fontWeight: value as DesignLayerFontWeight })
                  }
                >
                  <SelectTrigger aria-label={t('字重')} controlSize="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DESIGN_LAYER_FONT_WEIGHTS.map((weight) => (
                      <SelectItem key={weight} value={weight}>
                        {toolText(WEIGHT_LABELS[weight])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InspectorRow>
              <InspectorRow label={t('字号')}>
                <Select
                  value={String(nearestFontSize(currentFontSize))}
                  onValueChange={(value) => {
                    const fontSize = Number.parseInt(value, 10)
                    if (Number.isInteger(fontSize)) applyRuntimeStyle({ fontSize })
                  }}
                >
                  <SelectTrigger aria-label={t('字号')} controlSize="sm">
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
              </InspectorRow>
              <InspectorRow label={t('文字颜色')}>
                <InspectorColorInput
                  label={t('文字颜色')}
                  value={currentColorHex}
                  onChange={setColorPreview}
                  onCommit={(colorHex) => {
                    setColorPreview(null)
                    applyRuntimeStyle({ colorHex })
                  }}
                />
              </InspectorRow>
              <InspectorRow label={t('对齐')}>
                <Segmented
                  block
                  size="sm"
                  rounded="md"
                  aria-label={t('对齐')}
                  value={currentAlign}
                  onValueChange={(align) =>
                    applyRuntimeStyle({ textAlign: align as DesignLayerTextAlign })
                  }
                  segments={[
                    {
                      value: 'left',
                      label: '',
                      icon: <AlignLeft size={14} aria-hidden="true" />,
                      ariaLabel: toolText('文字左对齐'),
                      title: toolText('文字左对齐'),
                    },
                    {
                      value: 'center',
                      label: '',
                      icon: <AlignCenter size={14} aria-hidden="true" />,
                      ariaLabel: toolText('文字居中'),
                      title: toolText('文字居中'),
                    },
                    {
                      value: 'right',
                      label: '',
                      icon: <AlignRight size={14} aria-hidden="true" />,
                      ariaLabel: toolText('文字右对齐'),
                      title: toolText('文字右对齐'),
                    },
                  ]}
                />
              </InspectorRow>
              {contrast ? (
                <p
                  className={`rounded-[8px] px-2.5 py-1.5 text-xs tabular-nums ${
                    contrast.level === 'fail'
                      ? 'bg-destructive/10 font-medium text-destructive'
                      : 'bg-surface-subtle text-ink-muted'
                  }`}
                >
                  {toolText('对比度 {ratio} · {level}', {
                    ratio: contrast.formatted,
                    level: contrast.level === 'fail' ? toolText('对比度偏低') : contrast.level,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
          {!canEditRuntime && presentation ? (
            <>
              <InspectorRow label={t('字重')}>
                <InspectorValuePill dir={undefined}>
                  {toolText(WEIGHT_LABELS[currentFontWeight])}
                </InspectorValuePill>
              </InspectorRow>
              <InspectorRow label={t('字号')}>
                <InspectorValuePill suffix="px">{currentFontSize}</InspectorValuePill>
              </InspectorRow>
              {presentation.color ? (
                <InspectorRow label={t('文字颜色')}>
                  <div
                    dir="ltr"
                    className="flex h-8 items-center gap-2.5 rounded-[8px] bg-surface-subtle px-2 font-mono text-[13px] text-ink uppercase"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block size-5 shrink-0 rounded-[5px] border border-black/12 dark:border-white/18"
                      style={{ backgroundColor: presentation.color }}
                    />
                    <span>{currentColorHex}</span>
                  </div>
                </InspectorRow>
              ) : null}
            </>
          ) : null}
        </InspectorSection>
      ) : null}

      <InspectorSection title={t('尺寸')}>
        {canResizeHtml ? (
          <div className="space-y-2.5">
            <InspectorRow label={t('宽度')}>
              <InspectorNumberInput
                label={t('宽度')}
                suffix="px"
                min={1}
                max={ARTBOARD_GEOMETRY_LIMITS.viewport}
                value={widthValue}
                onChange={(event) =>
                  setSizeDraft({
                    width: event.currentTarget.valueAsNumber,
                    height: heightValue,
                  })
                }
                onBlur={() => {
                  if (sizeChanged) void commitSize()
                  else setSizeDraft(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitSize()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setSizeDraft(null)
                    event.currentTarget.blur()
                  }
                }}
              />
            </InspectorRow>
            <InspectorRow label={t('高度')}>
              <InspectorNumberInput
                label={t('高度')}
                suffix="px"
                min={1}
                max={ARTBOARD_GEOMETRY_LIMITS.viewport}
                value={heightValue}
                onChange={(event) =>
                  setSizeDraft({
                    width: widthValue,
                    height: event.currentTarget.valueAsNumber,
                  })
                }
                onBlur={() => {
                  if (sizeChanged) void commitSize()
                  else setSizeDraft(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitSize()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setSizeDraft(null)
                    event.currentTarget.blur()
                  }
                }}
              />
            </InspectorRow>
            {rect ? (
              <InspectorRow label={t('位置')}>
                <div className="grid grid-cols-2 gap-1.5">
                  <InspectorValuePill prefix="X">{Math.round(rect.x)}</InspectorValuePill>
                  <InspectorValuePill prefix="Y">{Math.round(rect.y)}</InspectorValuePill>
                </div>
              </InspectorRow>
            ) : null}
          </div>
        ) : (
          <>
            <InspectorRow label={t('尺寸')}>
              <InspectorValuePill>
                {measuredWidth} × {measuredHeight} px
              </InspectorValuePill>
            </InspectorRow>
            {rect ? (
              <InspectorRow label={t('位置')}>
                <div className="grid grid-cols-2 gap-1.5">
                  <InspectorValuePill prefix="X">{Math.round(rect.x)}</InspectorValuePill>
                  <InspectorValuePill prefix="Y">{Math.round(rect.y)}</InspectorValuePill>
                </div>
              </InspectorRow>
            ) : null}
          </>
        )}
      </InspectorSection>

      {runtimeLayer ? (
        <InspectorSection
          collapsible
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          title={t('高级')}
        >
          {!matchedStyles ? (
            <div role="status">
              <span className="sr-only">{t('正在读取图层样式')}</span>
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}
          {matchedStyles && matchedStyles.declarations.length > 0
            ? matchedStyles.declarations.map(({ property, value, important }, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 计算样式快照可能包含同名属性，按层叠顺序展示。
                <InspectorRow key={`${property}:${index}`} label={property}>
                  <InspectorValuePill mono>
                    {`${value}${important ? ' !important' : ''}`}
                  </InspectorValuePill>
                </InspectorRow>
              ))
            : null}
          {matchedStyles && matchedStyles.declarations.length === 0 ? (
            <p className="text-xs text-ink-muted">{t('没有可归属的样式声明')}</p>
          ) : null}
        </InspectorSection>
      ) : null}
    </section>
  )
}

function boardProperties(board: CanvasBoard) {
  return {
    width: board.width,
    height: board.height,
    background: (
      board.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background
    ).toLowerCase(),
    cornerRadius: board.appearance?.cornerRadius ?? DEFAULT_ARTBOARD_APPEARANCE.cornerRadius,
  }
}

type Properties = ReturnType<typeof boardProperties>
const numericFields = [
  { key: 'width', label: '宽度', min: 1 },
  { key: 'height', label: '高度', min: 1 },
  { key: 'cornerRadius', label: '圆角', min: 0 },
] as const

interface BoardAppearanceFormProps {
  boardId: string
  current: Properties
  editing: CanvasBoardEditing
}

function BoardAppearanceForm({ boardId, current, editing }: BoardAppearanceFormProps) {
  const { t } = useMessages(panelMessages)
  const [draft, setDraft] = useState<{ values: Properties; base: VersionSummary } | null>(null)
  const values = draft?.values ?? current
  const update = (patch: Partial<Properties>) => {
    setDraft((previous) => ({
      base: previous?.base ?? editing.version,
      values: { ...(previous?.values ?? current), ...patch },
    }))
  }
  const commit = async (nextValues: Properties, base: VersionSummary) => {
    const valid =
      Number.isFinite(nextValues.width) &&
      nextValues.width >= 1 &&
      nextValues.width <= ARTBOARD_GEOMETRY_LIMITS.viewport &&
      Number.isFinite(nextValues.height) &&
      nextValues.height >= 1 &&
      nextValues.height <= ARTBOARD_GEOMETRY_LIMITS.viewport &&
      Number.isFinite(nextValues.cornerRadius) &&
      nextValues.cornerRadius >= 0 &&
      nextValues.cornerRadius <= ARTBOARD_GEOMETRY_LIMITS.viewport
    const changed =
      numericFields.some(({ key }) => current[key] !== nextValues[key]) ||
      current.background !== nextValues.background
    if (!valid || !changed || !editing.available) {
      setDraft(null)
      return
    }
    if (await editing.change({ kind: 'boardProperties', boardId, ...nextValues }, base)) {
      setDraft(null)
    }
  }
  const commitDraft = () => {
    if (!draft) return
    void commit(draft.values, draft.base)
  }
  return (
    <form
      aria-label={t('调整画板属性')}
      onSubmit={(event) => {
        event.preventDefault()
        commitDraft()
      }}
    >
      <fieldset disabled={!editing.available} className="min-w-0 divide-y divide-border/75">
        <InspectorSection title={t('画板')}>
          <InspectorRow label={t('宽度')}>
            <InspectorNumberInput
              label={t('宽度')}
              suffix="px"
              min={1}
              max={ARTBOARD_GEOMETRY_LIMITS.viewport}
              required
              disabled={!editing.available}
              value={values.width}
              onChange={(event) => update({ width: event.currentTarget.valueAsNumber })}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
          </InspectorRow>
          <InspectorRow label={t('高度')}>
            <InspectorNumberInput
              label={t('高度')}
              suffix="px"
              min={1}
              max={ARTBOARD_GEOMETRY_LIMITS.viewport}
              required
              disabled={!editing.available}
              value={values.height}
              onChange={(event) => update({ height: event.currentTarget.valueAsNumber })}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
          </InspectorRow>
        </InspectorSection>
        <InspectorSection title={t('外观')}>
          <InspectorRow label={t('背景')}>
            <InspectorColorInput
              label={t('背景')}
              disabled={!editing.available}
              value={values.background}
              onChange={(background) => update({ background })}
              onCommit={(background) => {
                const base = draft?.base ?? editing.version
                void commit({ ...values, background }, base)
              }}
            />
          </InspectorRow>
          <InspectorRow label={t('圆角')}>
            <InspectorNumberInput
              label={t('圆角')}
              min={0}
              max={ARTBOARD_GEOMETRY_LIMITS.viewport}
              suffix="px"
              required
              disabled={!editing.available}
              value={values.cornerRadius}
              onChange={(event) => update({ cornerRadius: event.currentTarget.valueAsNumber })}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
          </InspectorRow>
        </InspectorSection>
      </fieldset>
    </form>
  )
}
