import type { AgentActivityState, PreservedViewState } from '@akasha/protocol'
import { create } from 'zustand'
import type { WsConnectionStatus } from '../../shared/api/ws'

export type WorkspaceViewMode = 'preview' | 'edit' | 'diff' | 'source'

/** 某项目最近一次上报的 Agent 活跃状态。 */
export interface AgentActivityRecord {
  state: AgentActivityState
  summary?: string
  artifactId?: string
  updatedAt: string
}

/** 沙盒上报的最近一次编译或运行错误。 */
export interface SandboxErrorRecord {
  version: number
  phase: 'compile' | 'runtime'
  message: string
  stack?: string
  loc?: string
}

/** 工作台的客户端状态。 */
export interface WorkspaceStoreState {
  selectedProjectId: string | null
  commandPaletteOpen: boolean
  // 两个非模态抽屉互斥；关闭抽屉不清除选区和草稿
  inspectorTab: 'review' | 'inspect' | null
  artifactViewId: string | null
  viewMode: WorkspaceViewMode
  wsStatus: WsConnectionStatus
  agentActivityByProject: Record<string, AgentActivityRecord>
  presenceByArtifact: Record<string, { viewers: number; agentOnline: boolean }>
  preservedViewByArtifact: Record<string, PreservedViewState>
  unsentDraftsByArtifact: Record<string, string>
  // 已交给 Agent 的错误指纹，同一条错误不重复提交
  sentErrorFingerprints: Record<string, boolean>

  openArtifactView: (publicId: string | null) => void
  setSelectedProjectId: (projectId: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setInspectorTab: (tab: WorkspaceStoreState['inspectorTab']) => void
  setViewMode: (mode: WorkspaceViewMode) => void
  setWsStatus: (status: WsConnectionStatus) => void
  setAgentActivity: (projectId: string, record: AgentActivityRecord) => void
  setPresence: (artifactId: string, presence: { viewers: number; agentOnline: boolean }) => void
  setPreservedView: (artifactId: string, state: PreservedViewState) => void
  setUnsentDraft: (artifactId: string, text: string) => void
  markErrorSent: (fingerprint: string) => void
}

/**
 * 工作台状态的 Zustand 容器。
 *
 * @remarks Agent 推送新版本重绘时，靠这里保存的视图模式、保态快照与未提交草稿恢复用户的上下文。
 */
export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  selectedProjectId: null,
  commandPaletteOpen: false,
  inspectorTab: null,
  artifactViewId: null,
  viewMode: 'preview',
  wsStatus: 'closed',
  agentActivityByProject: {},
  presenceByArtifact: {},
  preservedViewByArtifact: {},
  unsentDraftsByArtifact: {},
  sentErrorFingerprints: {},

  openArtifactView: (artifactViewId) =>
    set((state) =>
      state.artifactViewId === artifactViewId
        ? state
        : { artifactViewId, viewMode: 'preview', inspectorTab: null },
    ),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setViewMode: (viewMode) => set({ viewMode }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setAgentActivity: (projectId, record) =>
    set((s) => ({
      agentActivityByProject: { ...s.agentActivityByProject, [projectId]: record },
    })),
  setPresence: (artifactId, presence) =>
    set((s) => ({
      presenceByArtifact: { ...s.presenceByArtifact, [artifactId]: presence },
    })),
  setPreservedView: (artifactId, state) =>
    set((s) => ({
      preservedViewByArtifact: { ...s.preservedViewByArtifact, [artifactId]: state },
    })),
  setUnsentDraft: (artifactId, text) =>
    set((s) => ({
      unsentDraftsByArtifact: { ...s.unsentDraftsByArtifact, [artifactId]: text },
    })),
  markErrorSent: (fingerprint) =>
    set((s) => ({
      sentErrorFingerprints: { ...s.sentErrorFingerprints, [fingerprint]: true },
    })),
}))
