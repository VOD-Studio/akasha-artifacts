import { DropdownMenuItem } from '@akasha/ui/dropdown-menu'
import { Maximize, Minimize } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

function subscribeFullscreen(notify: () => void) {
  document.addEventListener('fullscreenchange', notify)
  return () => document.removeEventListener('fullscreenchange', notify)
}

function fullscreenState() {
  if (document.fullscreenElement === document.documentElement) return 'fullscreen'
  if (
    document.fullscreenEnabled &&
    !document.fullscreenElement &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function'
  )
    return 'window'
  return null
}

/** 作品全屏不切换路由或挂载点，画布与 body 中的编辑浮层属于同一文档。 */
export function HostDisplayItems() {
  const { t } = useMessages(messages)
  const display = useSyncExternalStore(subscribeFullscreen, fullscreenState, () => null)
  const toggleFullscreen = async () => {
    try {
      if (display === 'fullscreen') await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      toast.error(t('无法切换全屏'))
    }
  }
  if (!display) return null
  return (
    <DropdownMenuItem onSelect={() => void toggleFullscreen()}>
      {display === 'fullscreen' ? <Minimize size={14} /> : <Maximize size={14} />}
      {t(display === 'fullscreen' ? '退出全屏' : '全屏查看')}
    </DropdownMenuItem>
  )
}
