import {
  ARTBOARD_GEOMETRY_LIMITS,
  type CanvasElementPresentation,
  type CanvasLayer,
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
import { Tag } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, PencilLine } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import type { VisualEditTarget } from '@/features/visual-edit'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel } from '@/shared/lib/format'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasTextTools } from '../hooks/useInlineCanvasText'
import { updateTailwindTextClasses } from '../lib/canvas-layer-navigation'
import { cssColorToHex, evaluateColorContrast } from '../lib/color-contrast'
import { patchHtmlElementGeometry } from '../lib/html-element-geometry'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import { BoardPrintSettings } from './BoardPrintSettings'
import { DESIGN_LAYER_COLOR_LABELS, DesignLayerLayout, isPaletteColor } from './DesignLayerLayout'
import { panelMessages } from './messages'

interface BoardInspectorPropertiesProps {
  board: CanvasBoard
  pageTitle?: string
  designLayer?: DesignLayer
  runtimeLayer?: CanvasLayer
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

const measurements = 'grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs'
const term = 'text-ink-muted'
const sectionTitle = 'text-[11px] font-semibold tracking-wide text-ink-muted uppercase'
const kindLabels = {
  text: '文本',
  note: '便签',
  rectangle: '矩形',
  ellipse: '椭圆',
  stroke: '笔迹',
} as const

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

/** 根据当前选中的对象（原生图层 / 运行时 HTML 元素 / 画板）动态渲染对应属性区块。 */
export function BoardInspectorProperties({
  board,
  pageTitle,
  designLayer,
  runtimeLayer,
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
  const { t, locale } = useMessages(panelMessages)
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
      <section aria-label={t('原生图层属性')} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-ink">
            {runtimeLayer?.label || t(kindLabels[designLayer.kind])}
          </p>
          <Tag size="sm">{t(kindLabels[designLayer.kind])}</Tag>
        </div>

        {!editing && (
          <dl className={measurements}>
            <dt className={term}>{t('尺寸')}</dt>
            <dd dir="ltr" className="tabular-nums">
              {designLayer.width} × {designLayer.height} px
            </dd>
            <dt className={term}>{t('位置')}</dt>
            <dd dir="ltr" className="tabular-nums">
              {designLayer.x}, {designLayer.y} px
            </dd>
            <dt className={term}>{t('颜色')}</dt>
            <dd dir={customColor ? 'ltr' : undefined}>{layerColorText}</dd>
          </dl>
        )}

        {textLayer && (editing || canEditText) ? (
          <div className="space-y-2 border-t border-border/75 pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className={sectionTitle}>{t('排版与文字')}</h3>
              {canEditText ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    onEditText(board, designLayer, { x: rect.left, y: rect.top })
                  }}
                >
                  <PencilLine size={12} aria-hidden="true" />
                  {t('编辑文字')}
                </Button>
              ) : null}
            </div>
            {editing ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('字号')}>
                  <Select
                    value={String(nearestFontSize(currentSize))}
                    disabled={!editing.available}
                    onValueChange={(value) => {
                      const fontSize = Number.parseInt(value, 10)
                      if (Number.isInteger(fontSize)) applyNativeStyle({ fontSize })
                    }}
                  >
                    <SelectTrigger controlSize="sm">
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
                </Field>
                <Field label={t('字重')}>
                  <Select
                    value={currentWeight}
                    disabled={!editing.available}
                    onValueChange={(value) =>
                      applyNativeStyle({ fontWeight: value as DesignLayerFontWeight })
                    }
                  >
                    <SelectTrigger controlSize="sm">
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
                </Field>
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-muted">{t('对齐')}</span>
                  <div className="flex items-center gap-0.5 rounded-lg border border-border/80 bg-surface-subtle p-0.5">
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
                        variant="ghost"
                        iconOnly
                        disabled={!editing.available}
                        aria-label={toolText(label)}
                        aria-pressed={currentAlign === align}
                        className={
                          currentAlign === align
                            ? 'size-6 rounded-md bg-(--canvas-selection-tint) text-(--canvas-selection-strong)'
                            : 'size-6 rounded-md text-ink-muted hover:text-ink'
                        }
                        onClick={() => applyNativeStyle({ textAlign: align })}
                      >
                        <Icon size={13} />
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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
    <section aria-label={t('画板属性')} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {pageTitle ? <p className="truncate text-[11px] text-ink-muted">{pageTitle}</p> : null}
          <p className="truncate text-sm font-medium text-ink">{board.title}</p>
        </div>
        <Tag size="sm">{artifactTypeLabel(board.type, locale)}</Tag>
      </div>
      {!editing && (
        <dl className={measurements}>
          <dt className={term}>{t('固有宽高（px）')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {current.width} × {current.height}
          </dd>
          <dt className={term}>{t('背景')}</dt>
          <dd dir="ltr" className="inline-flex items-center gap-1.5 font-mono">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-xs border border-border"
              style={{ backgroundColor: current.background }}
            />
            {current.background}
          </dd>
          <dt className={term}>{t('圆角')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {current.cornerRadius} px
          </dd>
        </dl>
      )}
      {editing && <BoardAppearanceForm boardId={board.id} current={current} editing={editing} />}
      {board.scoped && <BoardPrintSettings board={board} editing={editing} />}
    </section>
  )
}

interface RuntimeElementPropertiesProps {
  board: CanvasBoard
  runtimeLayer?: CanvasLayer
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
  const displayName =
    runtimeLayer?.label || selectedElement?.textPreview || (tag ? `<${tag}>` : t('图层'))
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
  const widthValue = sizeDraft?.width ?? measuredWidth
  const heightValue = sizeDraft?.height ?? measuredHeight
  const sizeChanged =
    sizeDraft !== null &&
    (sizeDraft.width !== measuredWidth || sizeDraft.height !== measuredHeight) &&
    Number.isFinite(sizeDraft.width) &&
    Number.isFinite(sizeDraft.height) &&
    sizeDraft.width >= 1 &&
    sizeDraft.height >= 1

  const submitSize = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canResizeHtml || !sizeChanged || !sizeDraft || !editing || !sourceLoc || !rect) return
    const patch = {
      ...(sizeDraft.width !== measuredWidth ? { width: Math.round(sizeDraft.width) } : {}),
      ...(sizeDraft.height !== measuredHeight ? { height: Math.round(sizeDraft.height) } : {}),
    }
    const nextRect: ElementRect = {
      x: rect.x,
      y: rect.y,
      width: Math.round(sizeDraft.width),
      height: Math.round(sizeDraft.height),
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
  const currentColorHex = cssColorToHex(presentation?.color ?? '') ?? '#202733'
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

  const isEditable = canResizeHtml || canEditRuntime

  return (
    <section aria-label={t('运行图层属性')} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            <bdi>{displayName}</bdi>
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
            {tag ? (
              <code
                dir="ltr"
                className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-[10px]"
              >
                &lt;{tag}&gt;
              </code>
            ) : null}
            <span dir="ltr" className="tabular-nums">
              {measuredWidth} × {measuredHeight} px
            </span>
          </div>
        </div>
        <Tag
          size="sm"
          className={
            isEditable ? 'bg-(--canvas-selection-tint) text-(--canvas-selection-strong)' : undefined
          }
        >
          {t(isEditable ? '可编辑' : '只读测量')}
        </Tag>
      </div>

      {canResizeHtml ? (
        <form onSubmit={submitSize} className="space-y-2 border-t border-border/75 pt-3">
          <h3 className={sectionTitle}>{t('尺寸与定位')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('宽度')}>
              <Input
                type="number"
                controlSize="sm"
                min={1}
                max={ARTBOARD_GEOMETRY_LIMITS.viewport}
                trailing="px"
                value={Number.isNaN(widthValue) ? '' : widthValue}
                onChange={(event) =>
                  setSizeDraft({
                    width: event.currentTarget.valueAsNumber,
                    height: heightValue,
                  })
                }
              />
            </Field>
            <Field label={t('高度')}>
              <Input
                type="number"
                controlSize="sm"
                min={1}
                max={ARTBOARD_GEOMETRY_LIMITS.viewport}
                trailing="px"
                value={Number.isNaN(heightValue) ? '' : heightValue}
                onChange={(event) =>
                  setSizeDraft({
                    width: widthValue,
                    height: event.currentTarget.valueAsNumber,
                  })
                }
              />
            </Field>
          </div>
          {sizeChanged ? (
            <div>
              <Button size="sm" type="submit" loading={editing?.draft?.status === 'saving'}>
                {t('应用')}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
      {!canResizeHtml && rect ? (
        <dl className={`${measurements} border-t border-border/75 pt-2.5`}>
          <dt className={term}>{t('位置')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {Math.round(rect.x)}, {Math.round(rect.y)} px
          </dd>
        </dl>
      ) : null}

      {isRuntimeText ? (
        <div className="space-y-2 border-t border-border/75 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className={sectionTitle}>{t('排版与文字')}</h3>
            {canEditRuntime &&
            sourceLoc &&
            visualTarget?.text !== null &&
            visualTarget &&
            onEditSourceText ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
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
            ) : null}
          </div>

          {canEditRuntime ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('字号')}>
                <Select
                  value={String(nearestFontSize(currentFontSize))}
                  onValueChange={(value) => {
                    const fontSize = Number.parseInt(value, 10)
                    if (Number.isInteger(fontSize)) applyRuntimeStyle({ fontSize })
                  }}
                >
                  <SelectTrigger controlSize="sm">
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
              </Field>
              <Field label={t('字重')}>
                <Select
                  value={currentFontWeight}
                  onValueChange={(value) =>
                    applyRuntimeStyle({ fontWeight: value as DesignLayerFontWeight })
                  }
                >
                  <SelectTrigger controlSize="sm">
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
              </Field>
              <Field label={t('文字颜色')}>
                <Input
                  type="color"
                  controlSize="sm"
                  value={currentColorHex}
                  onChange={(event) => applyRuntimeStyle({ colorHex: event.currentTarget.value })}
                />
              </Field>
              <div className="flex flex-col justify-end gap-1">
                <span className="text-xs font-medium text-ink">{t('对齐')}</span>
                <div className="flex h-8 items-center justify-around rounded-lg border border-border/80 bg-surface-subtle px-0.5">
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
                      variant="ghost"
                      iconOnly
                      aria-label={toolText(label)}
                      aria-pressed={currentAlign === align}
                      className={
                        currentAlign === align
                          ? 'size-6 rounded-md bg-(--canvas-selection-tint) text-(--canvas-selection-strong)'
                          : 'size-6 rounded-md text-ink-muted hover:text-ink'
                      }
                      onClick={() => applyRuntimeStyle({ textAlign: align })}
                    >
                      <Icon size={13} />
                    </Button>
                  ))}
                </div>
              </div>
              {contrast ? (
                <p
                  className={`col-span-2 rounded-md px-2 py-1 text-[11px] tabular-nums ${
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
            </div>
          ) : null}
          {!canEditRuntime && presentation ? (
            <dl className={measurements}>
              <dt className={term}>{t('字号')}</dt>
              <dd dir="ltr" className="tabular-nums">
                {currentFontSize} px · {toolText(WEIGHT_LABELS[currentFontWeight])}
              </dd>
              {presentation.color ? (
                <>
                  <dt className={term}>{t('文字颜色')}</dt>
                  <dd dir="ltr" className="inline-flex items-center gap-1.5 font-mono">
                    <span
                      aria-hidden="true"
                      className="inline-block size-3 rounded-xs border border-border"
                      style={{ backgroundColor: presentation.color }}
                    />
                    {currentColorHex}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}

      {canReorder ? (
        <div className="space-y-2 border-t border-border/75 pt-3">
          <h3 className={sectionTitle}>{t('排列顺序')}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={!canMoveUp}
              className="h-7 gap-1 text-xs"
              onClick={() => reorder(-1)}
            >
              <ArrowUp size={12} aria-hidden="true" />
              {t('上移一层')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canMoveDown}
              className="h-7 gap-1 text-xs"
              onClick={() => reorder(1)}
            >
              <ArrowDown size={12} aria-hidden="true" />
              {t('下移一层')}
            </Button>
          </div>
        </div>
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
  const changed =
    numericFields.some(({ key }) => current[key] !== values[key]) ||
    current.background !== values.background
  const update = (patch: Partial<Properties>) => {
    setDraft((previous) => ({
      base: previous?.base ?? editing.version,
      values: { ...(previous?.values ?? current), ...patch },
    }))
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || !changed || !editing.available) return
    if (await editing.change({ kind: 'boardProperties', boardId, ...draft.values }, draft.base)) {
      setDraft((current) => (current === draft ? null : current))
    }
  }
  return (
    <form onSubmit={save} aria-label={t('调整画板属性')} className="border-t border-border/75 pt-3">
      <h3 className={`${sectionTitle} mb-2`}>{t('外观')}</h3>
      <fieldset disabled={!editing.available} className="flex min-w-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {numericFields.map(({ key, label, min }) => (
            <Field key={key} label={t(label)}>
              <Input
                type="number"
                controlSize="sm"
                min={min}
                max={ARTBOARD_GEOMETRY_LIMITS.viewport}
                trailing="px"
                required
                value={Number.isNaN(values[key]) ? '' : values[key]}
                onChange={(event) => update({ [key]: event.currentTarget.valueAsNumber })}
              />
            </Field>
          ))}
          <Field label={t('背景')}>
            <Input
              type="color"
              controlSize="sm"
              value={values.background}
              onChange={(event) => update({ background: event.currentTarget.value })}
            />
          </Field>
        </div>
        <div>
          <Button
            size="sm"
            type="submit"
            disabled={!changed}
            loading={editing.draft?.status === 'saving'}
          >
            {t('保存')}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
