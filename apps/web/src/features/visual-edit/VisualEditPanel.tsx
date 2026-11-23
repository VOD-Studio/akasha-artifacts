import { Button } from '@akasha/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { GripVertical, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PickedTarget, VisualEditController } from './useVisualEdit'

interface Props {
  controller: VisualEditController
}

function LiteralEditor({ controller, picked }: Props & { picked: PickedTarget }) {
  const { loc, element, target } = picked
  const [text, setText] = useState(target.text ?? '')
  const [classes, setClasses] = useState(target.className)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const dragged = useRef(false)
  const currentPosition = target.order?.siblings.findIndex((sibling) => sibling.loc === loc) ?? -1
  const busy = controller.busy
  const fieldClass =
    'w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent'

  function move(index: number) {
    if (!target.order || busy || currentPosition === index) return
    void controller.apply({ kind: 'move', loc, targetParentLoc: target.order.parentLoc, index })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-mono">
          &lt;{target.tagName}&gt; · {loc}
        </span>
        <span className="text-xs text-ink-muted">静态源码</span>
      </div>
      {target.text !== null ? (
        <form
          className="flex flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && text !== target.text)
              void controller.apply({ kind: 'text', loc, value: text })
          }}
        >
          <label className="w-full space-y-1 text-sm font-medium">
            <span>文字</span>
            <textarea
              className={fieldClass}
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />
          </label>
          <Button size="sm" type="submit" disabled={busy || text === target.text}>
            保存文字
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink-muted">
          该元素没有单独可改的字面量文字。请点选其子元素，或添加批注。
        </p>
      )}
      <form
        className="flex flex-col items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && classes !== target.className)
            void controller.apply({ kind: 'className', loc, value: classes })
        }}
      >
        <label className="w-full space-y-1 text-sm font-medium">
          <span>Tailwind 类名</span>
          <textarea
            className={`${fieldClass} font-mono`}
            rows={2}
            value={classes}
            onChange={(event) => setClasses(event.target.value)}
            disabled={busy}
            placeholder="text-sm hover:font-bold"
          />
        </label>
        <p className="text-xs text-ink-muted">用空格分隔类名，支持变体和任意值。</p>
        <Button size="sm" type="submit" disabled={busy || classes === target.className}>
          保存样式
        </Button>
      </form>
      {target.order ? (
        <section className="space-y-2" aria-label="同级元素排序">
          <h3 className="text-sm font-medium">同级元素排序</h3>
          <p className="text-xs text-ink-muted">拖动选中项到目标位置，或使用上移、下移。</p>
          <ol className="max-h-40 space-y-1 overflow-auto">
            {target.order.siblings.map((sibling, index) => (
              <li
                key={sibling.loc}
                draggable={!busy && index === currentPosition}
                onDragStart={(event) => {
                  if (index !== currentPosition) return
                  dragged.current = true
                  event.dataTransfer.setData('text/plain', loc)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  dragged.current = false
                }}
                onDragOver={(event) => {
                  if (!dragged.current || index === currentPosition) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  if (!dragged.current) return
                  event.preventDefault()
                  dragged.current = false
                  move(index)
                }}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${index === currentPosition ? 'cursor-grab border-accent font-medium' : 'border-border'}`}
              >
                {index === currentPosition ? <GripVertical size={14} aria-hidden /> : null}
                <span className="truncate">{sibling.label}</span>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || currentPosition <= 0}
              onClick={() => move(currentPosition - 1)}
            >
              上移
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || currentPosition >= target.order.siblings.length - 1}
              onClick={() => move(currentPosition + 1)}
            >
              下移
            </Button>
          </div>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => controller.annotate(element)}
        >
          改用批注
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (confirmRemove) void controller.apply({ kind: 'remove', loc })
            else setConfirmRemove(true)
          }}
        >
          {confirmRemove ? '确认删除元素' : '删除元素'}
        </Button>
        {confirmRemove ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>
            取消
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function VisualEditPanel({ controller }: Props) {
  const { active, busy, isPicking, canUndo } = controller
  return (
    <>
      {isPicking ? (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto w-fit rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink"
        >
          点选画布中的静态元素进行直改；动态元素将进入批注。
        </p>
      ) : null}
      {canUndo && !active ? (
        <div className="pointer-events-none absolute right-4 bottom-16 z-10">
          <Button
            className="pointer-events-auto shadow-sm"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void controller.undo()}
          >
            <RotateCcw size={14} aria-hidden /> 撤销直改
          </Button>
        </div>
      ) : null}
      <Sheet
        modal={false}
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) controller.cancel()
        }}
      >
        <SheetContent
          size="sm"
          aria-describedby={undefined}
          className="top-16 bottom-14 overflow-hidden"
        >
          <SheetHeader>
            <SheetTitle>可视化直改</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {active ? (
              <LiteralEditor
                key={`${active.baseVersion}:${active.loc}`}
                controller={controller}
                picked={active}
              />
            ) : null}
            {active && canUndo ? (
              <Button
                className="mt-3"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void controller.undo()}
              >
                撤销上一步直改
              </Button>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
