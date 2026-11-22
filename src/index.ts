export type ArtifactType =
  | 'react'
  | 'html'
  | 'markdown'
  | 'mermaid'
  | 'svg'
  | 'pr-walkthrough'
  | 'live-timeline'
  | 'option-compare'
  | 'data-story'

export type VisibilityScope = 'private' | 'team' | 'public'

export interface ArtifactPublishPayload {
  id: string
  title: string
  type: ArtifactType
  content: string
  visibility?: VisibilityScope
}

export interface ArtifactStatePatch {
  id: string
  patch: Record<string, unknown>
}

export interface ArtifactVersionRecord {
  id: string
  version: number
  title: string
  type: ArtifactType
  content: string
  state: Record<string, unknown>
  visibility: VisibilityScope
  updatedAt: string
}

// 内存版本存储：同时支撑本地 Daemon 与云端无状态 Hub 的核心状态演进
export class ArtifactStore {
  private readonly records = new Map<string, ArtifactVersionRecord[]>()

  publish(payload: ArtifactPublishPayload): ArtifactVersionRecord {
    const id = payload.id.trim()
    if (!id) {
      throw new Error('Artifact id must not be empty')
    }
    const history = this.records.get(id) ?? []
    const prev = history.at(-1)
    const next: ArtifactVersionRecord = {
      id,
      version: history.length + 1,
      title: payload.title.trim() || id,
      type: payload.type,
      content: payload.content,
      state: prev ? structuredClone(prev.state) : {},
      visibility: payload.visibility ?? prev?.visibility ?? 'private',
      updatedAt: new Date().toISOString(),
    }
    history.push(next)
    this.records.set(id, history)
    return next
  }

  pushState({ id, patch }: ArtifactStatePatch): ArtifactVersionRecord {
    const history = this.records.get(id)
    const latest = history?.at(-1)
    if (!latest) {
      throw new Error(`Artifact "${id}" not found`)
    }
    latest.state = {
      ...latest.state,
      ...patch,
    }
    latest.updatedAt = new Date().toISOString()
    return latest
  }

  getLatest(id: string): ArtifactVersionRecord | undefined {
    return this.records.get(id)?.at(-1)
  }

  getHistory(id: string): readonly ArtifactVersionRecord[] {
    return this.records.get(id) ?? []
  }
}
