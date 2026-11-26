import { ARTBOARD_GEOMETRY_LIMITS, type VersionSummary } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Spinner } from '@akasha/ui/indicator'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { AlertCircle, Download, Ellipsis, Focus, Play, RotateCcw, X } from 'lucide-react'
import { type MouseEventHandler, useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { CanvasBoardEdit } from '../lib/canvas-board-source'
import { useBoardEditError } from '../model/board-edit-error-messages'
import { navigationMessages } from '../navigation/board-navigation-messages'
import { CanvasGeometryFields, sameGeometry } from '../ui/CanvasGeometryFields'

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
        variant="ghost"
        iconOnly
        className="artifact-canvas-board-action size-7"
        aria-label={t('展开画板：{title}', { title })}
        title={t('展开画板')}
        onClick={onExpand}
      >
        <Focus size={14} />
      </Button>
      {onPlay && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          className="artifact-canvas-board-action size-7"
          aria-label={t('播放原型：{title}', { title })}
          title={t('播放原型')}
          onClick={onPlay}
        >
          <Play size={14} />
        </Button>
      )}
      {onExport && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          className="artifact-canvas-board-action size-7"
          aria-label={t('导出画板：{title}', { title })}
          title={t('导出画板')}
          onClick={onExport}
        >
          <Download size={14} />
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
          variant="ghost"
          size="sm"
          iconOnly
          disabled={disabled}
          className="artifact-canvas-board-action size-7"
          aria-label={t('设置画板：{title}', { title: board.title })}
          title={t('设置画板')}
        >
          <Ellipsis size={14} />
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

/** 版本冲突或鉴权失败时仍可取回未保存源码；不会将失败的候选当成新版本。 */
export function CanvasBoardEditNotice({ editing }: { editing: CanvasBoardEditing }) {
  const { t } = useMessages(navigationMessages)
  const { draft, inputError } = editing
  const rawError =
    draft?.error ??
    (draft?.errorCause !== undefined
      ? getRequestErrorMessage(draft.errorCause, '无法保存改动')
      : inputError)
  const errorText = useBoardEditError(rawError)
  if (!draft && !inputError) return null
  if (draft?.status === 'saving') {
    return (
      <div
        role="status"
        className="v-toast relative min-h-0 w-auto gap-2 rounded-full px-3.5 py-2 text-xs text-ink-muted"
      >
        <Spinner size={16} aria-hidden="true" className="text-(--canvas-selection)" />
        <span>{t('正在保存…')}</span>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="v-toast v-toast--error relative w-auto max-w-[min(36rem,calc(100vw-24px))] flex-wrap gap-x-3 gap-y-2 sm:flex-nowrap"
    >
      <span className="v-toast__icon self-start pt-0.5" aria-hidden="true">
        <AlertCircle size={17} />
      </span>
      <div className="v-toast__content">
        <p className="v-toast__title font-medium">{errorText}</p>
        {draft ? (
          <p className="v-toast__description">
            {t('未保存的改动已保留（基于 {version}）。', { version: `v${draft.base.version}` })}
          </p>
        ) : null}
      </div>
      {draft ? (
        <div className="flex shrink-0 items-center gap-1 border-border/70 sm:border-s sm:ps-2">
          {editing.retryDraft ? (
            <button
              type="button"
              className="v-toast__action h-7 gap-1 px-2.5 text-xs text-(--canvas-selection-strong)"
              onClick={editing.retryDraft}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {t('重试')}
            </button>
          ) : null}
          <button
            type="button"
            className="v-toast__cancel h-7 gap-1 px-2 text-xs"
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
            <Download size={12} aria-hidden="true" />
            {t('下载草稿')}
          </button>
          <button
            type="button"
            className="v-toast__cancel h-7 px-2 text-xs"
            onClick={editing.dismissDraft}
          >
            {t('放弃改动')}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="v-toast__close"
        aria-label={t('关闭')}
        onClick={editing.dismissDraft}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
