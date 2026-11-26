import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

interface InstallPrompt extends Event {
  prompt: () => Promise<unknown>
}

const InstallContext = createContext<(() => Promise<void>) | null>(null)

/** 在路由切换前接住宿主的一次性邀请；取消、安装和不可用都不冒充成功。 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<InstallPrompt | null>(null)
  useEffect(() => {
    const offer = (event: Event) => {
      if (!('prompt' in event) || typeof event.prompt !== 'function') return
      event.preventDefault()
      setPending(event as InstallPrompt)
    }
    const installed = () => setPending(null)
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', offer)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  const install = async () => {
    if (!pending) return
    setPending(null)
    await pending.prompt()
  }
  return (
    <InstallContext.Provider value={pending ? install : null}>{children}</InstallContext.Provider>
  )
}

/** 只有浏览器为当前站点发出安装邀请时才返回动作，不推测操作系统。 */
export function useInstallPrompt() {
  return useContext(InstallContext)
}
