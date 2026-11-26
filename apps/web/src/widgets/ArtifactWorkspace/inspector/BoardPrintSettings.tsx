import {
  ARTBOARD_MAX_LAYOUT_GUIDES,
  type ArtboardLayoutGuide,
  type ArtboardPrintLayout,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Input } from '@akasha/ui/input'
import { Radio, RadioGroup } from '@akasha/ui/radio'
import { ChevronRight, X } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import { boardPrintMessages } from './board-print-messages'

const fixed = { mode: 'fixed' } as const
const noGuides: ArtboardLayoutGuide[] = []
const paperNames = { a4: 'A4', letter: 'Letter' } as const

interface BoardPrintSettingsProps {
  board: CanvasBoard
  /** 只读版本展示快照，不保留或接受编辑草稿。 */
  editing?: CanvasBoardEditing
}

interface PrintDraft {
  base: VersionSummary
  layout: ArtboardPrintLayout
  guides: ArtboardLayoutGuide[]
}

function sameSettings(
  draft: PrintDraft,
  layout: ArtboardPrintLayout,
  guides: ArtboardLayoutGuide[],
) {
  return (
    draft.layout.mode === layout.mode &&
    (draft.layout.mode !== 'flow' ||
      (layout.mode === 'flow' && layout.paper === draft.layout.paper)) &&
    draft.guides.length === guides.length &&
    draft.guides.every(
      (guide, index) =>
        guide.axis === guides[index]?.axis && guide.position === guides[index]?.position,
    )
  )
}

interface GuideListProps {
  guides: ArtboardLayoutGuide[]
  onRemove?: (guide: ArtboardLayoutGuide) => void
}

function GuideList({ guides, onRemove }: GuideListProps) {
  const { t } = useMessages(boardPrintMessages)
  if (!guides.length) return null
  return (
    <ul aria-label={t('布局辅助线')} className="space-y-1">
      {guides.map((guide) => {
        const label = t(guide.axis === 'x' ? '垂直 · {position} px' : '水平 · {position} px', guide)
        return (
          <li
            key={`${guide.axis}:${guide.position}`}
            className="flex items-center justify-between gap-2"
          >
            <span>{label}</span>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={t('删除辅助线：{guide}', { guide: label })}
                onClick={() => onRemove(guide)}
              >
                <X size={14} />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 版式和辅助线共用打开草稿时的版本，一次保存只占一个撤销步骤。 */
export function BoardPrintSettings({ board, editing }: BoardPrintSettingsProps) {
  const { t } = useMessages(boardPrintMessages)
  const [open, setOpen] = useState(false)
  const layout = board.printLayout ?? fixed
  return (
    <div className="border-t border-border/75 pt-2.5 text-xs">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-1 text-start text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-ink-muted transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span>{t('打印与辅助线')}</span>
      </button>
      {open && editing ? <PrintForm board={board} editing={editing} /> : null}
      {open && !editing ? (
        <div className="mt-2 space-y-2 ps-1">
          <p className="text-ink-muted">
            {layout.mode === 'flow' ? t('流式') : t('固定')} ·{' '}
            <bdi dir="ltr">
              {layout.mode === 'flow'
                ? paperNames[layout.paper]
                : `${board.width} × ${board.height} px`}
            </bdi>
          </p>
          <GuideList guides={board.layoutGuides ?? noGuides} />
        </div>
      ) : null}
    </div>
  )
}

function PrintForm({ board, editing }: Required<BoardPrintSettingsProps>) {
  const { t } = useMessages(boardPrintMessages)
  const positionId = useId()
  const currentLayout = board.printLayout ?? fixed
  const currentGuides = board.layoutGuides ?? noGuides
  const [draft, setDraft] = useState<PrintDraft | null>(null)
  const [axis, setAxis] = useState<'x' | 'y'>('x')
  const [input, setInput] = useState('')
  const layout = draft?.layout ?? currentLayout
  const guides = draft?.guides ?? currentGuides
  const stale =
    draft !== null &&
    (draft.base.version !== editing.version.version ||
      draft.base.artifactId !== editing.version.artifactId)
  const position = input === '' ? Number.NaN : Number(input)
  const span = axis === 'x' ? board.width : board.height
  const duplicate = guides.some((guide) => guide.axis === axis && guide.position === position)
  const canAdd =
    Number.isFinite(position) &&
    position >= 0 &&
    position <= span &&
    !duplicate &&
    guides.length < ARTBOARD_MAX_LAYOUT_GUIDES
  const canSave =
    draft !== null &&
    !stale &&
    editing.available &&
    input === '' &&
    !sameSettings(draft, currentLayout, currentGuides)
  const update = (layout: ArtboardPrintLayout, guides: ArtboardLayoutGuide[]) => {
    setDraft({ base: draft?.base ?? editing.version, layout, guides })
  }
  const addGuide = () => {
    if (!canAdd || stale || !editing.available) return
    update(layout, [...guides, { axis, position }])
    setInput('')
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave || !draft) return
    if (
      await editing.change(
        { kind: 'printLayout', boardId: board.id, printLayout: layout, layoutGuides: guides },
        draft.base,
      )
    ) {
      setDraft((current) => (current === draft ? null : current))
    }
  }
  return (
    <form className="mt-3 space-y-2" aria-label={t('打印与辅助线')} onSubmit={save}>
      <fieldset disabled={!editing.available || stale} className="flex min-w-0 flex-col gap-3">
        <RadioGroup
          legend={t('打印版式')}
          orientation="horizontal"
          value={layout.mode}
          onValueChange={(mode) => update(mode === 'flow' ? { mode, paper: 'a4' } : fixed, guides)}
        >
          <Radio value="fixed" label={t('固定')} />
          <Radio value="flow" label={t('流式')} />
        </RadioGroup>
        {layout.mode === 'flow' ? (
          <RadioGroup
            legend={t('纸张尺寸')}
            orientation="horizontal"
            value={layout.paper}
            onValueChange={(paper) => {
              if (paper === 'a4' || paper === 'letter') update({ mode: 'flow', paper }, guides)
            }}
          >
            <Radio value="a4" label="A4" />
            <Radio value="letter" label="Letter" />
          </RadioGroup>
        ) : (
          <p className="text-ink-muted">
            <bdi dir="ltr">
              {board.width} × {board.height} px
            </bdi>
          </p>
        )}
        <div className="space-y-2">
          <h4 className="font-medium">{t('布局辅助线')}</h4>
          <GuideList
            guides={guides}
            onRemove={(guide) =>
              update(
                layout,
                guides.filter((item) => item !== guide),
              )
            }
          />
          <RadioGroup
            aria-label={t('辅助线方向')}
            orientation="horizontal"
            value={axis}
            onValueChange={(value) => {
              if (value === 'x' || value === 'y') setAxis(value)
            }}
          >
            <Radio value="x" label={t('垂直')} />
            <Radio value="y" label={t('水平')} />
          </RadioGroup>
          <div className="space-y-1">
            <div className="grid grid-cols-[5.25rem_1fr] items-center gap-2">
              <label htmlFor={positionId} className="text-xs text-ink-muted">
                {t('位置（px）')}
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={positionId}
                  type="number"
                  dir="ltr"
                  controlSize="sm"
                  step="any"
                  min={0}
                  max={span}
                  aria-invalid={duplicate || undefined}
                  className="flex-1"
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    addGuide()
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAdd}
                  className="h-7 shrink-0 rounded-md px-2 text-xs"
                  onClick={addGuide}
                >
                  {t('添加辅助线')}
                </Button>
              </div>
            </div>
            {duplicate ? (
              <p role="alert" className="text-[11px] text-destructive">
                {t('此位置已有辅助线')}
              </p>
            ) : null}
          </div>
        </div>
        {draft !== null ? (
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={!canSave}
              loading={editing.draft?.status === 'saving'}
            >
              {t('保存打印设置')}
            </Button>
          </div>
        ) : null}
      </fieldset>
      {stale && (
        <div role="alert" className="space-y-1">
          <p>{t('作品已更新，未保存打印设置。')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(null)
              setInput('')
            }}
          >
            {t('载入当前设置')}
          </Button>
        </div>
      )}
    </form>
  )
}
