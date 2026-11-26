import {
  ARTBOARD_MAX_LAYOUT_GUIDES,
  type ArtboardLayoutGuide,
  type ArtboardPrintLayout,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Segmented } from '@akasha/ui/segmented'
import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import {
  InspectorNumberInput,
  InspectorRow,
  InspectorSection,
  InspectorValuePill,
} from '../ui/inspector-controls'
import { boardPrintMessages } from './board-print-messages'

const fixed = { mode: 'fixed' } as const
const noGuides: ArtboardLayoutGuide[] = []
const paperNames = { a4: 'A4', letter: 'Letter' } as const

interface BoardPrintSettingsProps {
  board: CanvasBoard
  /** 只读版本展示快照，不保留或接受编辑草稿。 */
  editing?: CanvasBoardEditing
}

interface GuideListProps {
  guides: ArtboardLayoutGuide[]
  onRemove?: (guide: ArtboardLayoutGuide) => void
}

function GuideList({ guides, onRemove }: GuideListProps) {
  const { t } = useMessages(boardPrintMessages)
  if (!guides.length) return null
  return (
    <ul aria-label={t('布局辅助线')} className="space-y-1 text-xs">
      {guides.map((guide) => {
        const label = t(guide.axis === 'x' ? '垂直 · {position} px' : '水平 · {position} px', guide)
        return (
          <li
            key={`${guide.axis}:${guide.position}`}
            className="flex h-7 items-center justify-between gap-2 rounded-[7px] bg-surface-subtle/70 px-2.5"
          >
            <span className="truncate text-ink">{label}</span>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                className="size-5 rounded-full text-ink-muted hover:text-ink"
                aria-label={t('删除辅助线：{guide}', { guide: label })}
                onClick={() => onRemove(guide)}
              >
                <X size={12} />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 版式和辅助线修改即生效，无需额外的保存按钮。 */
export function BoardPrintSettings({ board, editing }: BoardPrintSettingsProps) {
  const { t } = useMessages(boardPrintMessages)
  const layout = board.printLayout ?? fixed
  return (
    <InspectorSection collapsible title={t('打印与辅助线')}>
      {editing ? (
        <PrintForm board={board} editing={editing} />
      ) : (
        <div className="space-y-2.5">
          <InspectorRow label={t('打印版式')}>
            <InspectorValuePill>
              {layout.mode === 'flow' ? t('流式') : t('固定')} ·{' '}
              <bdi dir="ltr">
                {layout.mode === 'flow'
                  ? paperNames[layout.paper]
                  : `${board.width} × ${board.height} px`}
              </bdi>
            </InspectorValuePill>
          </InspectorRow>
          <GuideList guides={board.layoutGuides ?? noGuides} />
        </div>
      )}
    </InspectorSection>
  )
}

function PrintForm({ board, editing }: Required<BoardPrintSettingsProps>) {
  const { t } = useMessages(boardPrintMessages)
  const positionId = useId()
  const layout = board.printLayout ?? fixed
  const guides = board.layoutGuides ?? noGuides
  const [axis, setAxis] = useState<'x' | 'y'>('x')
  const [input, setInput] = useState('')

  const position = input === '' ? Number.NaN : Number(input)
  const span = axis === 'x' ? board.width : board.height
  const duplicate = guides.some((guide) => guide.axis === axis && guide.position === position)
  const canAdd =
    editing.available &&
    Number.isFinite(position) &&
    position >= 0 &&
    position <= span &&
    !duplicate &&
    guides.length < ARTBOARD_MAX_LAYOUT_GUIDES

  const commit = (nextLayout: ArtboardPrintLayout, nextGuides: ArtboardLayoutGuide[]) => {
    if (!editing.available) return
    void editing.change(
      {
        kind: 'printLayout',
        boardId: board.id,
        printLayout: nextLayout,
        layoutGuides: nextGuides,
      },
      editing.version,
    )
  }

  const addGuide = () => {
    if (!canAdd) return
    commit(layout, [...guides, { axis, position }])
    setInput('')
  }

  return (
    <form
      aria-label={t('打印与辅助线')}
      className="space-y-2.5"
      onSubmit={(event) => event.preventDefault()}
    >
      <InspectorRow label={t('打印版式')}>
        <Segmented
          block
          size="sm"
          rounded="md"
          aria-label={t('打印版式')}
          disabled={!editing.available}
          value={layout.mode}
          onValueChange={(mode) => {
            if (mode === layout.mode) return
            commit(mode === 'flow' ? { mode: 'flow', paper: 'a4' } : fixed, guides)
          }}
          segments={[
            { value: 'fixed', label: t('固定') },
            { value: 'flow', label: t('流式') },
          ]}
        />
      </InspectorRow>
      {layout.mode === 'flow' ? (
        <InspectorRow label={t('纸张尺寸')}>
          <Segmented
            block
            size="sm"
            rounded="md"
            aria-label={t('纸张尺寸')}
            disabled={!editing.available}
            value={layout.paper}
            onValueChange={(paper) => {
              if ((paper === 'a4' || paper === 'letter') && paper !== layout.paper) {
                commit({ mode: 'flow', paper }, guides)
              }
            }}
            segments={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
            ]}
          />
        </InspectorRow>
      ) : null}
      <div className="space-y-2 border-t border-border/60 pt-2.5">
        <h4 className="text-xs font-medium text-ink-muted">{t('布局辅助线')}</h4>
        <GuideList
          guides={guides}
          onRemove={(guide) =>
            commit(
              layout,
              guides.filter((item) => item !== guide),
            )
          }
        />
        <InspectorRow label={t('辅助线方向')}>
          <Segmented
            block
            size="sm"
            rounded="md"
            aria-label={t('辅助线方向')}
            disabled={!editing.available}
            value={axis}
            onValueChange={(value) => {
              if (value === 'x' || value === 'y') setAxis(value)
            }}
            segments={[
              { value: 'x', label: t('垂直') },
              { value: 'y', label: t('水平') },
            ]}
          />
        </InspectorRow>
        <div className="space-y-1">
          <InspectorRow label={t('位置（px）')} htmlFor={positionId}>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <InspectorNumberInput
                  id={positionId}
                  label={t('位置（px）')}
                  step="any"
                  min={0}
                  max={span}
                  disabled={!editing.available}
                  invalid={duplicate}
                  value={input}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    addGuide()
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                disabled={!canAdd}
                aria-label={t('添加辅助线')}
                title={t('添加辅助线')}
                className="size-8 shrink-0 rounded-[8px] bg-surface-subtle text-ink hover:bg-border/60 disabled:opacity-45"
                onClick={addGuide}
              >
                <Plus size={14} aria-hidden="true" />
              </Button>
            </div>
          </InspectorRow>
          {duplicate ? (
            <p role="alert" className="text-[11px] text-destructive">
              {t('此位置已有辅助线')}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
