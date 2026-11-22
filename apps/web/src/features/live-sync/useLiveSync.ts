import type { JsonPatchOp, RealtimeServerEvent } from '@akasha/protocol'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { artifactKeys } from '../../entities/artifact/queries'
import { projectKeys } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import { AkashaWsClient } from '../../shared/api/ws'
import { getWsUrl } from '../../shared/config/runtime'

export interface StatePatchedCallbackPayload {
  artifactId: string
  stateSeq: number
  ops: JsonPatchOp[]
}

// 纯函数事件归约器：把 WS 事件直接写入 TanStack Query 缓存与 Zustand，同时保持未提交草稿与视角状态不受影响。
export function applyRealtimeEventToCache(
  queryClient: QueryClient,
  event: RealtimeServerEvent,
  options?: {
    onStatePatched?: (payload: StatePatchedCallbackPayload) => void
  },
): void {
  const store = useWorkspaceStore.getState()

  switch (event.type) {
    case 'version.created': {
      queryClient.setQueryData<ArtifactDetailResponse | undefined>(
        artifactKeys.detail(event.artifactId, undefined),
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            artifact: {
              ...prev.artifact,
              title: event.version.title,
              headVersion: Math.max(prev.artifact.headVersion, event.version.version),
              updatedAt: event.version.createdAt,
            },
            version: event.version,
          }
        },
      )
      queryClient.setQueryData(
        artifactKeys.versions(event.artifactId),
        (prev: ArtifactDetailResponse['version'][] | undefined) => {
          if (!prev) return [event.version]
          const filtered = prev.filter((v) => v.version !== event.version.version)
          return [...filtered, event.version].sort((a, b) => a.version - b.version)
        },
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all, exact: false })
      return
    }

    case 'state.patched': {
      options?.onStatePatched?.({
        artifactId: event.artifactId,
        stateSeq: event.stateSeq,
        ops: event.ops,
      })
      return
    }

    case 'round.updated': {
      queryClient.setQueryData<ArtifactDetailResponse | undefined>(
        artifactKeys.detail(event.artifactId, undefined),
        (prev) => {
          if (!prev) return prev
          const idx = prev.rounds.findIndex((r) => r.id === event.round.id)
          const nextRounds =
            idx === -1
              ? [...prev.rounds, event.round]
              : prev.rounds.map((r, i) => (i === idx ? event.round : r))
          return { ...prev, rounds: nextRounds }
        },
      )
      return
    }

    case 'feedback.created':
    case 'feedback.updated': {
      void queryClient.invalidateQueries({
        queryKey: artifactKeys.detail(event.artifactId, undefined),
      })
      return
    }

    case 'agent.activity': {
      store.setAgentActivity(event.projectId, {
        state: event.state,
        summary: event.summary,
        artifactId: event.artifactId,
        updatedAt: event.timestamp,
      })
      return
    }

    case 'presence.changed': {
      store.setPresence(event.artifactId, {
        viewers: event.viewers,
        agentOnline: event.agentOnline,
      })
      return
    }

    case 'resync': {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      return
    }
  }
}

export interface UseLiveSyncOptions {
  artifactId?: string
  projectId?: string
  enabled?: boolean
  onStatePatched?: (payload: StatePatchedCallbackPayload) => void
}

export function useLiveSync(options: UseLiveSyncOptions = {}): void {
  const { artifactId, projectId, enabled = true, onStatePatched } = options
  const queryClient = useQueryClient()
  const setWsStatus = useWorkspaceStore((s) => s.setWsStatus)
  const onStatePatchedRef = useRef(onStatePatched)
  onStatePatchedRef.current = onStatePatched
  const clientRef = useRef<AkashaWsClient | null>(null)

  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') return
    const client = new AkashaWsClient({
      url: getWsUrl(),
      target: { artifactId, projectId },
      onStatusChange: (status) => setWsStatus(status),
      onEvent: (event) => {
        applyRealtimeEventToCache(queryClient, event, {
          onStatePatched: (payload) => onStatePatchedRef.current?.(payload),
        })
      },
    })
    clientRef.current = client
    client.connect()
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [enabled, queryClient, setWsStatus, artifactId, projectId])
}
