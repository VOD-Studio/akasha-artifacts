import { useState } from 'react'

/** 按已授权制品或新建表单保存未发送文字，不把草稿混入批注或真实会话。 */
export function useAgentDraft(scope: string) {
  const key = `akasha:agent-draft:${scope}`
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  function update(next: string) {
    setText(next)
    try {
      if (next) sessionStorage.setItem(key, next)
      else sessionStorage.removeItem(key)
    } catch {}
  }
  return [text, update] as const
}
