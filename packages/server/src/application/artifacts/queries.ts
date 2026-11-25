import type {
  Artifact,
  ArtifactIdentifier,
  ArtifactWorkspaceDetail,
  ReviewRound,
  StateStreamSnapshot,
  Version,
} from '@akasha/protocol'
import { PublicIdSchema } from '@akasha/protocol'
import { NotFoundError } from '../../domain/errors.js'
import type { ArtifactRepository, RoundRepository, StateRepository } from '../../domain/ports.js'
import { ArtifactWorkspaceRead } from '../artifact-workspace-read.js'

interface QueryPorts {
  artifacts: ArtifactRepository
  rounds: Pick<RoundRepository, 'listByArtifact'>
  states: Pick<StateRepository, 'getSnapshot'>
}

/** 未显式给出项目时，仍按制品标识的既有解析规则查找。 */
export interface ArtifactReference {
  id: ArtifactIdentifier
  projectId?: string
}

export interface ArtifactVersionQuery extends ArtifactReference {
  version?: number
}

export const DEFAULT_PROJECT_ID = 'default'

/** 源码详情与画布索引共用活动制品的寻址规则，但不共用源码加载路径。 */
export class ArtifactQueries {
  readonly workspace: ArtifactWorkspaceRead

  constructor(private readonly deps: QueryPorts) {
    this.workspace = new ArtifactWorkspaceRead(deps.artifacts)
  }

  async resolveArtifact(identifier: ArtifactIdentifier, projectId?: string): Promise<Artifact> {
    if (PublicIdSchema.safeParse(identifier).success) {
      const byPublic = await this.deps.artifacts.findByPublicId(identifier)
      if (byPublic) return byPublic
      // 撤下的 publicId 仍是保留标识，不能把旧书签重新解释为另一份制品的 slug。
      if (await this.deps.artifacts.lifecycle.findWithdrawn(identifier)) {
        throw new NotFoundError('未找到活动制品')
      }
    }
    const targetProject = projectId ?? DEFAULT_PROJECT_ID
    const bySlug = await this.deps.artifacts.findBySlug(targetProject, identifier)
    if (bySlug) return bySlug

    // 未显式指定项目时，兼容跨项目按旧 slug 解析（仅当唯一命中时放行）
    if (!projectId) {
      const all = await this.deps.artifacts.listByProject()
      const matches = all.filter((a) => a.slug === identifier)
      if (matches.length === 1 && matches[0]) {
        return matches[0]
      }
    }

    throw new NotFoundError(`未找到 Artifact "${identifier}"`, {
      identifier,
      projectId: targetProject,
    })
  }

  async getArtifact(input: ArtifactVersionQuery): Promise<{
    artifact: Artifact
    version: Readonly<Version>
    state: StateStreamSnapshot
    rounds: readonly ReviewRound[]
  }> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const targetNum = input.version ?? artifact.headVersion
    const version = await this.deps.artifacts.getVersion(artifact.publicId, targetNum)
    if (!version) {
      throw new NotFoundError(`未找到版本 v${targetNum}`)
    }
    return { artifact, version, ...(await this.readRuntime(artifact)) }
  }

  async getWorkspace(input: ArtifactVersionQuery): Promise<ArtifactWorkspaceDetail> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const number = input.version ?? artifact.headVersion
    const entry = await this.workspace.getVersion(artifact, number)
    if (!entry) throw new NotFoundError(`未找到版本 v${number}`)
    return { artifact, ...entry, ...(await this.readRuntime(artifact)) }
  }

  private async readRuntime(artifact: Artifact) {
    const [snapshot, rounds] = await Promise.all([
      this.deps.states.getSnapshot(artifact.publicId),
      this.deps.rounds.listByArtifact(artifact.publicId),
    ])
    const state = snapshot ?? {
      artifactId: artifact.publicId,
      seq: 0,
      snapshot: {},
      updatedAt: artifact.updatedAt,
    }
    return { state, rounds }
  }

  async getHistory(
    id: ArtifactIdentifier,
    projectId?: string,
  ): Promise<readonly Readonly<Version>[]> {
    const artifact = await this.resolveArtifact(id, projectId)
    return this.deps.artifacts.getVersions(artifact.publicId)
  }

  async getHistorySummaries(id: ArtifactIdentifier, projectId?: string) {
    const artifact = await this.resolveArtifact(id, projectId)
    return this.deps.artifacts.getVersionSummaries(artifact.publicId)
  }
}

export type ResolveArtifact = ArtifactQueries['resolveArtifact']
