import type { AgentActivityState, PreservedViewState } from '@akasha/protocol'
import { create } from 'zustand'
import type { WsConnectionStatus } from '@/shared/api/ws'

/** 工具视图会隐藏而非销毁画布或已经打开的编辑器。 */
export type WorkspaceViewMode = 'preview' | 'edit' | 'diff' | 'source'

/** 某项目最近一次上报的 Agent 活跃状态。 */
export interface AgentActivityRecord {
  /** Daemon 最近上报的状态，不代表服务端写入已完成。 */
  state: AgentActivityState
  /** Agent 上报的活动摘要；未提供时不展示占位文字。 */
  summary?: string
  /** 最近活动仅属于某作品时才提供公开标识。 */
  artifactId?: string
  /** Daemon 上报时间，ISO 8601。 */
  updatedAt: string
}

/** 沙盒上报的最近一次编译或运行错误。 */
export interface SandboxErrorRecord {
  /** 报错时 sandbox 正在渲染的版本；不能直接定位到其他版本的源码。 */
  version: number
  /** 编译失败时没有可用的运行画面；运行错误可能来自已挂载的节点。 */
  phase: 'compile' | 'runtime'
  message: string
  stack?: string
  /** 只有成功映射到作者源码时才提供 `line:column`。 */
  loc?: string
}

/** 工作台的客户端状态。 */
export interface WorkspaceStoreState {
  selectedProjectId: string | null
  commandPaletteOpen: boolean
  /** 两个非模态抽屉互斥；关闭时不清除选区和草稿。 */
  inspectorTab: 'review' | 'inspect' | null
  /** 控制画布上的批注图钉是否显示；独立于右侧批注与评审抽屉的开合。 */
  showComments: boolean
  /** 当前打开的作品；`null` 表示在作品库。 */
  artifactViewId: string | null
  viewMode: WorkspaceViewMode
  wsStatus: WsConnectionStatus
  /** 按项目保存最近一次 Agent 状态。 */
  agentActivityByProject: Record<string, AgentActivityRecord>
  /** 来自服务端事件的在线状态，不由画板 iframe 写入。 */
  presenceByArtifact: Record<string, { viewers: number; agentOnline: boolean }>
  /** 以作品 ID 保存预览状态，供重载同一作品时恢复。 */
  preservedViewByArtifact: Record<string, PreservedViewState>
  /** 已投递给 Agent 的错误指纹；同一条错误不能重复提交。 */
  sentErrorFingerprints: Record<string, boolean>

  openArtifactView: (publicId: string | null) => void
  setSelectedProjectId: (projectId: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setInspectorTab: (tab: WorkspaceStoreState['inspectorTab']) => void
  setShowComments: (show: boolean) => void
  toggleShowComments: () => void
  setViewMode: (mode: WorkspaceViewMode) => void
  setWsStatus: (status: WsConnectionStatus) => void
  setAgentActivity: (projectId: string, record: AgentActivityRecord) => void
  setPresence: (artifactId: string, presence: { viewers: number; agentOnline: boolean }) => void
  setPreservedView: (artifactId: string, state: PreservedViewState) => void
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
  showComments: true,
  artifactViewId: null,
  viewMode: 'preview',
  wsStatus: 'closed',
  agentActivityByProject: {},
  presenceByArtifact: {},
  preservedViewByArtifact: {},
  sentErrorFingerprints: {},

  openArtifactView: (artifactViewId) =>
    set((state) =>
      state.artifactViewId === artifactViewId
        ? state
        : { artifactViewId, viewMode: 'preview', inspectorTab: null, showComments: true },
    ),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setShowComments: (showComments) => set({ showComments }),
  toggleShowComments: () => set((state) => ({ showComments: !state.showComments })),
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
  markErrorSent: (fingerprint) =>
    set((s) => ({
      sentErrorFingerprints: { ...s.sentErrorFingerprints, [fingerprint]: true },
    })),
}))
