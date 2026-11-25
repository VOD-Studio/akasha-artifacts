import {
  type ArtboardContent,
  type Artifact,
  type ArtifactSharedAccess,
  type ArtifactShareInput,
  type ArtifactSpecOutput,
  type ArtifactStorageUsage,
  ArtifactStorageUsageSchema,
  type ArtifactTransferInput,
  type ArtifactType,
  type ArtifactWorkspaceDetail,
  type Author,
  type JsonPatchOp,
  type ReviewRound,
  type StateStreamSnapshot,
  type Version,
  type VersionSummary,
  type Visibility,
  type WithdrawnArtifact,
} from '@akasha/protocol'
import { ApiError } from '@/shared/api/error'
import { requestJson } from '@/shared/api/request'

/** 工作区打开一个可读快照所需的数据；源码版本和运行状态是两条独立的版本线。 */
export interface ArtifactDetailResponse {
  artifact: Artifact
  /** 这里是实际返回的快照，不一定等于作品的头版本。 */
  version: Version
  /** 运行状态按 `seq` 更新，不随 `version` 的版本号递增。 */
  state: StateStreamSnapshot
  rounds: ReviewRound[]
  /** 访问所用的链接或身份授权；未设置时不是受邀会话。 */
  access?: ArtifactSharedAccess
  /** 受控作品的所有者预览也保留在 Hub，不探测本机副本。 */
  hubRestricted?: true
}

/** 签发分享链接；普通定位链接不经过这个接口。 */
export async function createArtifactShare(
  id: string,
  input: ArtifactShareInput,
): Promise<{ url: string; expiresAt: string }> {
  return requestJson(
    `/api/v1/artifacts/${encodeURIComponent(id)}/share`,
    { method: 'POST', body: JSON.stringify(input) },
    'workbench',
  )
}

/** 读取当前会话的管理权限；能打开作品不代表能修改、撤下或分享。 */
export async function fetchArtifactManagement(id: string): Promise<{ canManage: boolean }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/management`)
}

/** 服务端固定复制版本并原子移动；两种操作都校验源与目标项目。 */
export async function transferArtifact(
  id: string,
  input: ArtifactTransferInput,
): Promise<{ artifact: Artifact; version?: Version }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 只更改展示名称，不产生新版本，也不改变已有定位链接。 */
export async function renameArtifact(id: string, title: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

/** 撤下不删除书签指向的记录，但会在服务端撤销所有已发签名。 */
export async function withdrawArtifact(id: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 读取当前登录者可恢复的作品，不加载作品源码或历史版本。 */
export async function fetchWithdrawnArtifacts(): Promise<{ items: WithdrawnArtifact[] }> {
  return requestJson('/api/v1/withdrawn-artifacts')
}

/** 恢复原作品链接；撤下时失效的签名分享不会恢复。 */
export async function restoreArtifact(id: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

/** 收藏记录只对当前身份有效；不代表拥有作品管理权。 */
export async function fetchArtifactFavorites(): Promise<{ artifactIds: string[] }> {
  return requestJson('/api/v1/favorites')
}

/** 按目标值设置而不是反转状态；成功响应返回服务端保存的结果。 */
export async function setArtifactFavorite(
  id: string,
  favorite: boolean,
): Promise<{ favorite: boolean }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorite }),
  })
}

/** 用量只含共享与当前用户的运行数据；不含源码和历史版本。 */
export async function fetchArtifactStorageUsage(id: string): Promise<ArtifactStorageUsage> {
  const usage = await requestJson<unknown>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/storage/usage`,
  )
  return ArtifactStorageUsageSchema.parse(usage)
}

/** 不传项目时读取当前会话可见的全部作品。 */
export async function fetchArtifacts(projectId?: string): Promise<{ artifacts: Artifact[] }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ artifacts: Artifact[] }>(`/api/v1/artifacts${query}`)
}

/** 可读取固定快照；未指定版本时由服务端按普通访问或分享授权决定。 */
export async function fetchArtifactDetail(
  id: string,
  version?: number,
  signal?: AbortSignal,
): Promise<ArtifactDetailResponse> {
  const query = version !== undefined ? `?version=${version}` : ''
  return requestJson<ArtifactDetailResponse>(
    `/api/v1/artifacts/${encodeURIComponent(id)}${query}`,
    {
      signal,
    },
  )
}

/** 版本摘要可由已读取的完整快照实现，但不能假定包含源码。 */
export function hasVersionSource(version: VersionSummary): version is Version {
  return 'source' in version && typeof version.source === 'string'
}

/** 画布先读取布局，非多板制品仍随同返回其渲染源码。 */
export function fetchArtifactWorkspace(
  id: string,
  version?: number,
  signal?: AbortSignal,
): Promise<ArtifactWorkspaceDetail> {
  const params = new URLSearchParams({ view: 'canvas' })
  if (version !== undefined) params.set('version', String(version))
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}?${params}`, { signal })
}

/** 取同一制品指定版本的一块画板；取消信号直达 HTTP 请求。 */
export async function fetchArtifactBoard(
  artifactId: string,
  version: number,
  boardId: string,
  signal: AbortSignal,
): Promise<ArtboardContent> {
  const params = new URLSearchParams({ version: String(version), boardId })
  const path = `/api/v1/artifacts/${encodeURIComponent(artifactId)}/boards?${params}`
  const response = await requestJson<{
    artifactId: string
    version: number
    board: ArtboardContent
  }>(path, { signal })
  if (
    response?.artifactId !== artifactId ||
    response.version !== version ||
    response.board?.id !== boardId
  ) {
    throw new Error('画板响应与请求的版本或标识不一致')
  }
  return response.board
}

/** 版本菜单只读取当前访问权限范围内的元数据。 */
export function fetchArtifactVersions(
  id: string,
  signal?: AbortSignal,
): Promise<{ versions: VersionSummary[] }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/versions?view=metadata`, {
    signal,
  })
}

/** 以历史快照创建新的头版本，不覆盖旧版本；`baseVersion` 防止覆盖并发提交。 */
export async function revertArtifactVersion(
  id: string,
  input: { targetVersion: number; baseVersion: number },
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson<{ artifact: Artifact; version: Version }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/revert`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 读取作品类型公开的检查与参数规格，与某个版本的运行数据无关。 */
export async function fetchArtifactSpec(type: ArtifactType): Promise<ArtifactSpecOutput> {
  return requestJson<ArtifactSpecOutput>(`/api/v1/specs/${encodeURIComponent(type)}`)
}

/** 更新独立于源码版本的运行状态；返回已应用补丁后的序号与快照。 */
export async function pushArtifactState(
  id: string,
  input: { project?: string; patch: JsonPatchOp[] },
): Promise<{ publicId: string; seq: number; snapshot: Record<string, unknown> }> {
  return requestJson<{ publicId: string; seq: number; snapshot: Record<string, unknown> }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/state`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 人类保存版本时的发布入参；`author` 缺省为 `human:web`。 */
export interface PublishHumanVersionInput {
  project: string
  slug: string
  title: string
  type: ArtifactType
  source: string
  /** 基于的头版本；若其间有其他写入则返回 409。 */
  baseVersion: number
  visibility?: Visibility
  author?: Author
}

/**
 * 保存代码编辑或画布操作产生的新版本，不改写原快照。
 *
 * @remarks `baseVersion` 落后于头版本时服务端返回 409，`ApiError.details` 里带冲突详情。
 */
export async function publishHumanVersion(
  input: PublishHumanVersionInput,
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson<{ artifact: Artifact; version: Version }>('/api/v1/artifacts', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      author: input.author ?? 'human:web',
    }),
  })
}

/** 保存遇到 `VERSION_CONFLICT` 时用于展示差异及决定下次保存的基准。 */
export interface VersionConflictDetails {
  artifactId?: string
  baseVersion: number
  headVersion: number
  /** 服务端给出的基准与头版本差异；没有差异文本时为空串。 */
  diff: string
  authors: string[]
}

/** 只提取服务端的版本冲突详情，其他错误仍由调用方按原样处理。 */
export function parseVersionConflictDetails(err: unknown): VersionConflictDetails | null {
  if (!(err instanceof ApiError)) return null
  if (err.status !== 409 || err.code !== 'VERSION_CONFLICT') return null
  if (!err.details || typeof err.details !== 'object') return null
  const d = err.details as Record<string, unknown>
  if (typeof d.headVersion !== 'number' || typeof d.baseVersion !== 'number') return null
  return {
    artifactId: typeof d.artifactId === 'string' ? d.artifactId : undefined,
    baseVersion: d.baseVersion,
    headVersion: d.headVersion,
    diff: typeof d.diff === 'string' ? d.diff : '',
    authors: Array.isArray(d.authors)
      ? d.authors.filter((a): a is string => typeof a === 'string')
      : [],
  }
}
