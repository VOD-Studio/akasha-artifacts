import type { AgentActivityState, PreservedViewState } from '@akasha/protocol'
import { create } from 'zustand'
import type { WsConnectionStatus } from '../../shared/api/ws'

export type WorkspaceViewMode = 'preview' | 'edit' | 'diff' | 'source'

export interface AgentActivityRecord {
  state: AgentActivityState
  summary?: string
  artifactId?: string
  updatedAt: string
}

export interface SandboxErrorRecord {
  version: number
  phase: 'compile' | 'runtime'
  message: string
  stack?: string
  loc?: string
}

export interface WorkspaceStoreState {
  selectedProjectId: string | null
  commandPaletteOpen: boolean
  inspectorTab: 'review' | 'props' | null
  artifactViewId: string | null
  viewMode: WorkspaceViewMode
  wsStatus: WsConnectionStatus
  agentActivityByProject: Record<string, AgentActivityRecord>
  presenceByArtifact: Record<string, { viewers: number; agentOnline: boolean }>
  preservedViewByArtifact: Record<string, PreservedViewState>
  unsentDraftsByArtifact: Record<string, string>
  sandboxErrorByArtifact: Record<string, SandboxErrorRecord | null>
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
  setSandboxError: (artifactId: string, err: SandboxErrorRecord | null) => void
  markErrorSent: (fingerprint: string) => void
}

// 客户端工作台状态：管理视角切换、保态快照与未提交草稿，确保 Agent 推送新版本重绘时不丢失用户上下文。
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
  sandboxErrorByArtifact: {},
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
  setSandboxError: (artifactId, err) =>
    set((s) => ({
      sandboxErrorByArtifact: { ...s.sandboxErrorByArtifact, [artifactId]: err },
    })),
  markErrorSent: (fingerprint) =>
    set((s) => ({
      sentErrorFingerprints: { ...s.sentErrorFingerprints, [fingerprint]: true },
    })),
}))
