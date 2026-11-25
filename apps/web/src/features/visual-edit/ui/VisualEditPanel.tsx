import type { EditOp } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@akasha/ui/sheet'
import { Textarea } from '@akasha/ui/textarea'
import { GripVertical, RotateCcw } from 'lucide-react'
import { type FormEvent, useId, useRef, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from '../messages'
import type { PickedTarget, VisualEditController } from '../model/useVisualEdit'

interface Props {
  controller: VisualEditController
}

function LiteralEditor({ controller, picked }: Props & { picked: PickedTarget }) {
  const { t } = useMessages(panelMessages)
  const { loc, element, target } = picked
  const [text, setText] = useState(target.text ?? '')
  const [classes, setClasses] = useState(target.className)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [saving, setSaving] = useState<'text' | 'className' | null>(null)
  const orderHeadingId = useId()
  const dragged = useRef(false)
  const currentPosition = target.order?.siblings.findIndex((sibling) => sibling.loc === loc) ?? -1
  const busy = controller.busy

  const saveField = async (operation: Extract<EditOp, { kind: 'text' | 'className' }>) => {
    setSaving(operation.kind)
    try {
      await controller.apply(operation)
    } finally {
      setSaving(null)
    }
  }

  const saveText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy && text !== target.text) void saveField({ kind: 'text', loc, value: text })
  }

  const saveStyle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy && classes !== target.className)
      void saveField({ kind: 'className', loc, value: classes })
  }

  const move = (index: number) => {
    if (!target.order || busy || currentPosition === index) return
    void controller.apply({ kind: 'move', loc, targetParentLoc: target.order.parentLoc, index })
  }

  return (
    <div className="flex flex-col gap-5">
      <span dir="ltr" className="font-mono text-sm">
        &lt;{target.tagName}&gt;
      </span>
      {target.text !== null ? (
        <form className="flex flex-col items-start gap-2" onSubmit={saveText}>
          <Field label={t('文字')} className="w-full">
            <Textarea
              rows={3}
              dir="auto"
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Button
            size="sm"
            type="submit"
            disabled={busy || text === target.text}
            loading={saving === 'text'}
          >
            {t('保存')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink-muted">
          {t('这段文字不能直接编辑。可选择子元素或添加批注。')}
        </p>
      )}
      <form className="flex flex-col items-start gap-2" onSubmit={saveStyle}>
        <Field label={t('Tailwind 类名')} hint={t('用空格分隔')} className="w-full">
          <Textarea
            dir="ltr"
            className="font-mono"
            rows={2}
            value={classes}
            onChange={(event) => setClasses(event.target.value)}
            disabled={busy}
            placeholder="text-sm hover:font-bold"
          />
        </Field>
        <Button
          size="sm"
          type="submit"
          disabled={busy || classes === target.className}
          loading={saving === 'className'}
        >
          {t('保存')}
        </Button>
      </form>
      {target.order ? (
        <section className="space-y-2" aria-labelledby={orderHeadingId}>
          <h3 id={orderHeadingId} className="text-sm font-medium">
            {t('元素顺序')}
          </h3>
          <p className="text-xs text-ink-muted">{t('拖动选中项，或使用上移、下移。')}</p>
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
              {t('上移')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || currentPosition >= target.order.siblings.length - 1}
              onClick={() => move(currentPosition + 1)}
            >
              {t('下移')}
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
          {t('添加批注')}
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
          {confirmRemove ? t('确认删除') : t('删除元素')}
        </Button>
        {confirmRemove ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>
            {t('取消')}
          </Button>
        ) : null}
      </div>
      {confirmRemove && (
        <p role="status" className="text-xs text-ink-muted">
          {t('元素及其内容将被删除。')}
        </p>
      )}
    </div>
  )
}

/** 可视化直改面板：点选提示、撤销入口，以及编辑选中目标的抽屉。 */
export function VisualEditPanel({ controller }: Props) {
  const { t, dir } = useMessages(panelMessages)
  const { active, busy, isPicking, canUndo } = controller
  return (
    <>
      {isPicking ? (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto w-fit rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink"
        >
          {t('选择要编辑的元素。无法直接编辑时将打开批注。')}
        </p>
      ) : null}
      {canUndo && !active ? (
        <div className="pointer-events-none absolute inset-e-4 bottom-16 z-10">
          <Button
            className="pointer-events-auto shadow-sm"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void controller.undo()}
          >
            <RotateCcw size={14} aria-hidden /> {t('撤销')}
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
          side={dir === 'rtl' ? 'left' : 'right'}
          size="sm"
          aria-describedby={undefined}
          className="top-16 bottom-14 overflow-hidden"
        >
          <SheetHeader>
            <SheetTitle>{t('编辑元素')}</SheetTitle>
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
                {t('撤销')}
              </Button>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
