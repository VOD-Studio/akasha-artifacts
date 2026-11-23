import type { JsonPatchOp, RealtimeServerEvent } from '@akasha/protocol'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { artifactKeys } from '../../entities/artifact/queries'
import { feedbackKeys } from '../../entities/feedback/queries'
import { projectKeys } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import { AkashaWsClient } from '../../shared/api/ws'
import { getWsUrl, isCloudHub } from '../../shared/config/runtime'
import { applyJsonPatchClient } from '../../shared/lib/json-patch'

/** `state.patched` 事件的要点，供调用方把补丁转发给沙盒。 */
export interface StatePatchedCallbackPayload {
  artifactId: string
  stateSeq: number
  ops: JsonPatchOp[]
}

/**
 * 把一条实时事件归约进 TanStack Query 缓存与工作台状态。
 *
 * @remarks 版本与轮次事件就地改写缓存，状态补丁按 `stateSeq` 去重后应用；
 * 反馈事件使相关查询失效，`resync` 使项目、制品与反馈的全部查询失效。
 * 状态补丁写完缓存后经 `onStatePatched` 通知调用方。
 */
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
      // 同步推进 TanStack Query 缓存中的状态快照，保证 L2 属性面板与 Agent 推送的 StateStream 实时一致
      queryClient.setQueriesData<ArtifactDetailResponse | undefined>(
        { queryKey: artifactKeys.detailPrefix(event.artifactId) },
        (prev) => {
          if (!prev || event.stateSeq <= prev.state.seq) return prev
          return {
            ...prev,
            state: {
              ...prev.state,
              seq: event.stateSeq,
              snapshot: applyJsonPatchClient(prev.state.snapshot, event.ops),
              updatedAt: event.timestamp,
            },
          }
        },
      )
      options?.onStatePatched?.({
        artifactId: event.artifactId,
        stateSeq: event.stateSeq,
        ops: event.ops,
      })
      return
    }

    case 'round.updated': {
      // 同时刷新 head 与所有历史版本详情缓存中的 rounds，确保查看 /v/$version 时同样实时同步
      queryClient.setQueriesData<ArtifactDetailResponse | undefined>(
        { queryKey: artifactKeys.detailPrefix(event.artifactId) },
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
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(event.artifactId) })
      return
    }

    case 'feedback.created':
    case 'feedback.updated': {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(event.artifactId) })
      void queryClient.invalidateQueries({
        queryKey: artifactKeys.detailPrefix(event.artifactId),
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
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.all })
      return
    }
  }
}

export interface UseLiveSyncOptions {
  // 订阅范围；在 Hub 上会写进连接地址
  artifactId?: string
  projectId?: string
  // 为 false 时不建立连接
  enabled?: boolean
  // 状态补丁写完缓存后调用
  onStatePatched?: (payload: StatePatchedCallbackPayload) => void
}

/**
 * 订阅服务端的实时事件并同步到查询缓存。
 *
 * @remarks 挂载时建立 WebSocket 连接，卸载或 `enabled` 变为 false 时关闭。
 * 订阅范围随 `artifactId` 与 `projectId` 变化；连接状态写进工作台状态。
 */
export function useLiveSync(options: UseLiveSyncOptions = {}): void {
  const { artifactId, projectId, enabled = true, onStatePatched } = options
  const queryClient = useQueryClient()
  const setWsStatus = useWorkspaceStore((s) => s.setWsStatus)
  const onStatePatchedRef = useRef(onStatePatched)
  onStatePatchedRef.current = onStatePatched

  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') return
    const url = new URL(getWsUrl())
    // Hub 的连接需要先验明订阅范围，所以写进地址；本地 Daemon 经订阅消息传递
    if (isCloudHub()) {
      if (artifactId) url.searchParams.set('artifactId', artifactId)
      if (projectId) url.searchParams.set('projectId', projectId)
    }
    const client = new AkashaWsClient({
      url: url.href,
      target: { artifactId, projectId },
      onStatusChange: (status) => setWsStatus(status),
      onEvent: (event) => {
        applyRealtimeEventToCache(queryClient, event, {
          onStatePatched: (payload) => onStatePatchedRef.current?.(payload),
        })
      },
    })
    client.connect()
    return () => client.close()
  }, [enabled, queryClient, setWsStatus, artifactId, projectId])
}
