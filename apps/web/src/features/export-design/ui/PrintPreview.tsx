import { Button } from '@akasha/ui/button'
import { useEffect, useRef, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 只解码当前纸页；翻页和关闭时释放其临时地址。 */
export function PrintPreview({ pages }: { pages: readonly Blob[] }) {
  const { t, number } = useMessages(messages)
  const [index, setIndex] = useState(0)
  const image = useRef<HTMLImageElement>(null)
  const png = pages[index]
  useEffect(() => {
    if (!png || !image.current) return
    const url = URL.createObjectURL(png)
    image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [png])
  const pageLabel = t('第 {current} 页，共 {total} 页', {
    current: number(index + 1),
    total: number(pages.length),
  })
  return (
    <section aria-label={t('打印预览')} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={!index} onClick={() => setIndex(index - 1)}>
          {t('上一页')}
        </Button>
        <span aria-live="polite" className="tabular-nums">
          {pageLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={index + 1 >= pages.length}
          onClick={() => setIndex(index + 1)}
        >
          {t('下一页')}
        </Button>
      </div>
      <img
        ref={image}
        alt={pageLabel}
        className="mx-auto max-h-[40dvh] max-w-full object-contain"
      />
    </section>
  )
}
