import { ARTBOARD_GEOMETRY_LIMITS, type Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Input } from '@akasha/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { Ellipsis } from 'lucide-react'
import { useId, useState } from 'react'
import type { CanvasBoardEdit } from './canvas-board-source'
import type { CanvasBounds } from './canvas-camera'
import type { CanvasBoard } from './canvas-model'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface BoardActionsProps {
  board: CanvasBoard
  bounds: CanvasBounds
  version: Version
  disabled: boolean
  onChange: (edit: CanvasBoardEdit, base: Version) => void
}

const fieldLabels = { x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' } as const
const fields = ['x', 'y', 'width', 'height'] as const

/** 坐标和尺寸可以用键盘修改；四个字段作为一项版本变更提交。 */
export function CanvasBoardActions({
  board,
  bounds,
  version,
  disabled,
  onChange,
}: BoardActionsProps) {
  const [form, setForm] = useState<{
    base: Version
    initial: CanvasBounds
    bounds: CanvasBounds
    confirming: boolean
  } | null>(null)
  const { viewport, coordinate } = ARTBOARD_GEOMETRY_LIMITS
  const fieldPrefix = useId()

  function apply(edit: CanvasBoardEdit) {
    if (!form || disabled) return
    onChange(edit, form.base)
    setForm(null)
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
          aria-label={`设置画板：${board.title}`}
          title="设置画板"
        >
          <Ellipsis size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3" aria-label={`设置${board.title}`}>
        {form?.confirming ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">删除「{board.title}」及其流程连线？旧版本仍可查看。</p>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm({ ...form, confirming: false })}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => apply({ kind: 'delete', ids: [board.id] })}
              >
                删除画板
              </Button>
            </div>
          </div>
        ) : form ? (
          <>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                apply({ kind: 'geometry', changes: [{ id: board.id, bounds: form.bounds }] })
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                {fields.map((field) => {
                  const position = field === 'x' || field === 'y'
                  const inputId = `${fieldPrefix}-${field}`
                  return (
                    <div key={field} className="space-y-1 text-xs text-ink-muted">
                      <label htmlFor={inputId}>{fieldLabels[field]}</label>
                      <Input
                        id={inputId}
                        type="number"
                        controlSize="sm"
                        value={Number.isNaN(form.bounds[field]) ? '' : form.bounds[field]}
                        min={position ? -coordinate : 1}
                        max={position ? coordinate : viewport}
                        step={position ? 'any' : 1}
                        required
                        onChange={(event) =>
                          setForm({
                            ...form,
                            bounds: { ...form.bounds, [field]: event.target.valueAsNumber },
                          })
                        }
                      />
                    </div>
                  )
                })}
              </div>
              <Button
                size="sm"
                type="submit"
                disabled={
                  disabled || fields.every((field) => form.bounds[field] === form.initial[field])
                }
              >
                应用布局
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
                复制画板
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setForm({ ...form, confirming: true })}
              >
                删除…
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** 版本冲突时仍可取回未保存源码；不会将失败的候选当成新版本。 */
export function CanvasBoardEditNotice({ editing }: { editing: CanvasBoardEditing }) {
  const { draft, inputError } = editing
  if (!draft && !inputError) return null
  if (draft?.status === 'saving') {
    return (
      <p role="status" className="rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
        正在保存画板…
      </p>
    )
  }
  return (
    <div
      role="alert"
      className="max-w-xs space-y-2 rounded-md border border-border bg-surface p-3 text-sm text-ink shadow-sm"
    >
      <p>{draft?.error ?? inputError}</p>
      {draft ? (
        <>
          <p className="text-xs text-ink-muted">已保留基于 v{draft.base.version} 的未保存操作。</p>
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
            下载未保存源码
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={editing.dismissDraft}>
        {draft ? '放弃这次操作' : '关闭提示'}
      </Button>
    </div>
  )
}
