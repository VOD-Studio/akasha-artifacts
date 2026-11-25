import { ARTBOARD_GEOMETRY_LIMITS, type VersionSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Download, Ellipsis, Focus, Play } from 'lucide-react'
import { type MouseEventHandler, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { useBoardEditError } from './board-edit-error-messages'
import { navigationMessages } from './board-navigation-messages'
import { CanvasGeometryFields, sameGeometry } from './CanvasGeometryFields'
import type { CanvasBoardEdit } from './canvas-board-source'
import type { CanvasBounds } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface QuickActionsProps {
  title: string
  onExpand: MouseEventHandler<HTMLButtonElement>
  onPlay?: MouseEventHandler<HTMLButtonElement>
  onExport?: () => void
}

/** 同一画板的查看、交互预览和导出入口；布局编辑仍由设置菜单处理。 */
export function CanvasBoardQuickActions({ title, onExpand, onPlay, onExport }: QuickActionsProps) {
  const { t } = useMessages(navigationMessages)
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        iconOnly
        className="artifact-canvas-board-action"
        aria-label={t('展开画板：{title}', { title })}
        title={t('展开画板')}
        onClick={onExpand}
      >
        <Focus size={15} />
      </Button>
      {onPlay && (
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          className="artifact-canvas-board-action"
          aria-label={t('播放原型：{title}', { title })}
          title={t('播放原型')}
          onClick={onPlay}
        >
          <Play size={15} />
        </Button>
      )}
      {onExport && (
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          className="artifact-canvas-board-action"
          aria-label={t('导出画板：{title}', { title })}
          title={t('导出画板')}
          onClick={onExport}
        >
          <Download size={15} />
        </Button>
      )}
    </>
  )
}

interface BoardActionsProps {
  board: CanvasBoard
  bounds: CanvasBounds
  version: VersionSummary
  disabled: boolean
  onChange: CanvasBoardEditing['change']
}

/** 坐标和尺寸可以用键盘修改；四个字段作为一项版本变更提交。 */
export function CanvasBoardActions({
  board,
  bounds,
  version,
  disabled,
  onChange,
}: BoardActionsProps) {
  const { t } = useMessages(navigationMessages)
  const [form, setForm] = useState<{
    base: VersionSummary
    initial: CanvasBounds
    bounds: CanvasBounds
    confirming: boolean
  } | null>(null)
  const { coordinate } = ARTBOARD_GEOMETRY_LIMITS

  const apply = async (edit: CanvasBoardEdit) => {
    if (!form || disabled) return
    if (await onChange(edit, form.base)) {
      setForm((current) => (current === form ? null : current))
    }
  }

  return (
    <Popover
      open={form !== null}
      onOpenChange={(open) =>
        setForm(open ? { base: version, initial: bounds, bounds, confirming: false } : null)
      }
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          disabled={disabled}
          className="artifact-canvas-board-action"
          aria-label={t('设置画板：{title}', { title: board.title })}
          title={t('设置画板')}
        >
          <Ellipsis size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 space-y-3"
        aria-label={t('设置画板：{title}', { title: board.title })}
      >
        {form?.confirming && (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t('删除「{title}」及其流程连线？旧版本仍可查看。', { title: board.title })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm({ ...form, confirming: false })}
              >
                {t('取消')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={disabled}
                onClick={() => apply({ kind: 'delete', ids: [board.id] })}
              >
                {t('删除')}
              </Button>
            </div>
          </div>
        )}
        {form && !form.confirming && (
          <>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                apply({ kind: 'geometry', changes: [{ id: board.id, bounds: form.bounds }] })
              }}
            >
              <CanvasGeometryFields
                value={form.bounds}
                onChange={(bounds) => setForm({ ...form, bounds })}
              />
              <Button
                size="sm"
                type="submit"
                disabled={disabled || sameGeometry(form.bounds, form.initial)}
              >
                {t('应用')}
              </Button>
            </form>
            <div className="flex gap-1 border-t border-border pt-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  const offset = 48
                  const copy = {
                    ...form.initial,
                    x: Math.min(coordinate, form.initial.x + offset),
                    y: Math.min(coordinate, form.initial.y + offset),
                  }
                  apply({
                    kind: 'duplicate',
                    boardId: board.id,
                    id: crypto.randomUUID(),
                    bounds: copy,
                  })
                }}
              >
                {t('复制')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setForm({ ...form, confirming: true })}
              >
                {t('删除…')}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 版本冲突时仍可取回未保存源码；不会将失败的候选当成新版本。 */
export function CanvasBoardEditNotice({ editing }: { editing: CanvasBoardEditing }) {
  const { t } = useMessages(navigationMessages)
  const { draft, inputError } = editing
  const errorText = useBoardEditError(draft?.error ?? inputError)
  if (!draft && !inputError) return null
  if (draft?.status === 'saving') {
    return (
      <p role="status" className="rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
        {t('正在保存…')}
      </p>
    )
  }
  return (
    <div
      role="alert"
      className="max-w-xs space-y-2 rounded-md border border-border bg-surface p-3 text-sm text-ink shadow-sm"
    >
      <p>{errorText}</p>
      {draft ? (
        <>
          <p className="text-xs text-ink-muted">
            {t('未保存的改动已保留（基于 {version}）。', { version: `v${draft.base.version}` })}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([draft.source], { type: 'application/json' }),
              )
              const link = document.createElement('a')
              link.href = url
              link.download = `画板草稿-v${draft.base.version}.json`
              link.click()
              window.setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            {t('下载草稿')}
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={editing.dismissDraft}>
        {t(draft ? '放弃改动' : '关闭')}
      </Button>
    </div>
  )
}
