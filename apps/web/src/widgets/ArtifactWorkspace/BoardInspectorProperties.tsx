import {
  ARTBOARD_GEOMETRY_LIMITS,
  type CanvasLayer,
  DEFAULT_ARTBOARD_APPEARANCE,
  type DesignLayer,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { type FormEvent, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel } from '@/shared/lib/format'
import { canvasToolsMessages } from './canvas-tools-messages'
import { DESIGN_LAYER_COLOR_LABELS, DesignLayerLayout } from './DesignLayerLayout'
import { panelMessages } from './messages'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'
import type { CanvasTextTools } from './useInlineCanvasText'

interface BoardInspectorPropertiesProps {
  board: CanvasBoard
  pageTitle?: string
  designLayer?: DesignLayer
  runtimeLayer?: CanvasLayer
  /** 只有声明的原生图层能加入多选布局操作。 */
  selectedDesignLayers: readonly DesignLayer[]
  /** 无写权限或非当前头版时不传；运行时节点不使用此编辑器。 */
  editing?: CanvasBoardEditing
  onEditText?: CanvasTextTools['edit']
}

const measurements = 'grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-sm'
const term = 'text-ink-muted'
const kindLabels = {
  text: '文本',
  note: '便签',
  rectangle: '矩形',
  ellipse: '椭圆',
  stroke: '笔迹',
} as const

/** 一次只检查一个对象：原生层属于版本，运行节点只展示沙盒测量结果。 */
export function BoardInspectorProperties({
  board,
  pageTitle,
  designLayer,
  runtimeLayer,
  selectedDesignLayers,
  editing,
  onEditText,
}: BoardInspectorPropertiesProps) {
  const { t, locale } = useMessages(panelMessages)
  const { t: colorLabel } = useMessages(canvasToolsMessages)
  if (designLayer) {
    const textLayer = designLayer.kind === 'text' || designLayer.kind === 'note'
    const canEditText = textLayer && onEditText
    return (
      <section aria-label={t('原生图层属性')}>
        <dl className={measurements}>
          <dt className={term}>{t('图层')}</dt>
          <dd>{runtimeLayer?.label || t(kindLabels[designLayer.kind])}</dd>
          {!editing && (
            <>
              <dt className={term}>{t('尺寸')}</dt>
              <dd dir="ltr">
                {designLayer.width} × {designLayer.height} px
              </dd>
              <dt className={term}>{t('位置')}</dt>
              <dd dir="ltr">
                {designLayer.x}, {designLayer.y} px
              </dd>
              <dt className={term}>{t('颜色')}</dt>
              <dd>{colorLabel(DESIGN_LAYER_COLOR_LABELS[designLayer.color ?? 'auto'])}</dd>
            </>
          )}
        </dl>
        {editing && (
          <DesignLayerLayout
            boardId={board.id}
            layer={designLayer}
            selected={selectedDesignLayers}
            editing={editing}
          />
        )}
        {canEditText && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onEditText(board, designLayer, { x: rect.left, y: rect.top })
            }}
          >
            {t('编辑文字')}
          </Button>
        )}
      </section>
    )
  }

  if (runtimeLayer) {
    return (
      <section aria-label={t('运行图层属性')}>
        <p className="mb-2 text-xs text-ink-muted">{t('运行图层 · 只读测量')}</p>
        <dl className={measurements}>
          <dt className={term}>{t('图层')}</dt>
          <dd>
            <bdi>{runtimeLayer.label || `<${runtimeLayer.tag}>`}</bdi>
          </dd>
          <dt className={term}>{t('尺寸')}</dt>
          <dd dir="ltr">
            {runtimeLayer.width} × {runtimeLayer.height} px
          </dd>
        </dl>
      </section>
    )
  }

  const current = boardProperties(board)
  return (
    <section aria-label={t('画板属性')} className="flex flex-col gap-3">
      <dl className={measurements}>
        <dt className={term}>{t('页面')}</dt>
        <dd>{pageTitle}</dd>
        <dt className={term}>{t('画板')}</dt>
        <dd>{board.title}</dd>
        <dt className={term}>{t('内容')}</dt>
        <dd>{artifactTypeLabel(board.type, locale)}</dd>
        {!editing && (
          <>
            <dt className={term}>{t('固有宽高（px）')}</dt>
            <dd dir="ltr">
              {current.width} × {current.height}
            </dd>
            <dt className={term}>{t('背景')}</dt>
            <dd dir="ltr" className="font-mono">
              {current.background}
            </dd>
            <dt className={term}>{t('圆角')}</dt>
            <dd dir="ltr">{current.cornerRadius} px</dd>
          </>
        )}
      </dl>
      {editing && <BoardAppearanceForm boardId={board.id} current={current} editing={editing} />}
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
    <form onSubmit={save} aria-label={t('调整画板属性')}>
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
