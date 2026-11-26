import type { AgentConversation } from '@akasha/protocol'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { fetchAgentDesignSession, startAgentDesign } from '../api/client'
import { messages } from './messages'
import { useDesignConnections } from './useDesignConnections'

interface DesignAttempt {
  /** 实际受理之后才有的本机会话。 */
  id: string
  /** 原请求授权的项目，不跟随库的筛选器。 */
  projectId: string
}

const attemptKey = 'akasha:agent-design-attempt'
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function readAttempt(): DesignAttempt | null {
  try {
    const raw = sessionStorage.getItem(attemptKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DesignAttempt> | null
    return value &&
      typeof value.id === 'string' &&
      uuid.test(value.id) &&
      typeof value.projectId === 'string' &&
      value.projectId
      ? { id: value.id, projectId: value.projectId }
      : null
  } catch {
    return null
  }
}

function writeAttempt(value: DesignAttempt | null) {
  try {
    if (value) sessionStorage.setItem(attemptKey, JSON.stringify(value))
    else sessionStorage.removeItem(attemptKey)
  } catch {}
}

/** 关闭表单只暂停轮询；重新打开时仍跟踪原项目受理的会话，不重发首条消息。 */
export function useDesignSession(open: boolean) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const [attempt, setAttempt] = useState(readAttempt)
  const connections = useDesignConnections(open)
  const sessionQuery = useQuery({
    queryKey: ['agent-design-session', attempt?.id],
    queryFn: ({ signal }) => {
      if (!attempt) throw new Error(t('没有已受理的设计会话'))
      return fetchAgentDesignSession(attempt.id, signal)
    },
    enabled: open && Boolean(attempt),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.turns.at(-1)?.status === 'running' ? 1000 : false,
  })
  const send = useMutation({
    mutationFn: startAgentDesign,
    onSuccess(session: AgentConversation) {
      const next = { id: session.id, projectId: session.projectId }
      cache.setQueryData(['agent-design-session', session.id], session)
      setAttempt(next)
      writeAttempt(next)
      void cache.invalidateQueries({ queryKey: ['agent-connections'] })
    },
    onError() {
      void cache.invalidateQueries({ queryKey: ['agent-connections'] })
    },
  })
  const accessDenied =
    connections.error instanceof ApiError && [401, 403].includes(connections.error.status)
  const denied =
    accessDenied ||
    (sessionQuery.error instanceof ApiError && [401, 403, 404].includes(sessionQuery.error.status))
  const missing = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404
  const session = denied ? undefined : sessionQuery.data
  const turn = session?.turns[0]
  // 服务端只在确认真实 v1 后写 artifactId；会话的最近轮次可以滚动淘汰首次回执。
  const published =
    session?.projectId === attempt?.projectId && session?.id === attempt?.id
      ? session?.artifactId
      : undefined
  const forgetAttempt = () => {
    setAttempt(null)
    writeAttempt(null)
  }
  return {
    attempt,
    connections,
    send,
    sessionQuery,
    accessDenied,
    missing,
    session,
    turn,
    published,
    forgetAttempt,
  }
}
