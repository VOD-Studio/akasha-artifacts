import { useSyncExternalStore } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { routeMessages } from './messages'

function subscribe(notify: () => void) {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}
const isOnline = () => navigator.onLine

/** 普通断线不卸载内容或重放写请求；未订阅实时事件的页面不显示虚假的断线状态。 */
export function ConnectionNotice() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true)
  const reconnecting = useWorkspaceStore((state) => state.wsStatus === 'reconnecting')
  const { t } = useMessages(routeMessages)
  if (online && !reconnecting) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-e-2 inset-b-2 z-10 max-w-[calc(100%-1rem)] rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
    >
      {online ? t('连接已断开，正在重连…') : t('离线')}
    </div>
  )
}
