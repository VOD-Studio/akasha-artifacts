import type {
  ArtifactHandoffReference,
  CodingSessionPublication,
  CodingSessionPublish,
} from '@akasha/protocol'
import { designSystemReferenceHeader, readDesignSystemReference } from '@akasha/protocol'
import { DomainError } from '../domain/errors.js'
import type { ArtifactRepository, WorkspaceComponent } from '../domain/ports.js'
import type { ArtifactService } from './artifact-service.js'
import type { CheckService } from './check-service.js'
import { renderCodingComponent, retainsCodingComponent } from './coding-component-preview.js'
import { bundleSelectedComponents } from './design-systems/bundle.js'

/** 只编译显式提交的工程文件；共用版本写锁按原交接基线提交，冲突不重试。 */
export async function publishCodingSession(
  deps: { artifacts: ArtifactRepository; checks: CheckService; service: ArtifactService },
  sessionId: string,
  reference: ArtifactHandoffReference,
  input: CodingSessionPublish,
  actor: 'human' | 'agent' = 'agent',
): Promise<CodingSessionPublication> {
  const { artifactId, projectId, version: baseVersion } = reference
  const artifact = await deps.artifacts.findByPublicId(artifactId)
  if (!artifact || artifact.projectId !== projectId)
    throw new DomainError('NOT_FOUND', '作品不在当前项目')
  let source = input.source
  let workspaceComponent: WorkspaceComponent | undefined
  if (input.component) {
    if (artifact.type !== 'react')
      throw new DomainError(
        'BAD_REQUEST',
        '组件预览只可发布回 React 作品；其他类型请提交完整作品文件',
      )
    const { files, ...component } = input.component
    const entry = files.find((file) => file.path === component.path)
    if (!entry) throw new DomainError('BAD_REQUEST', '工程文件中没有该组件入口')
    const base = await deps.artifacts.getVersion(artifactId, baseVersion)
    if (!base) throw new DomainError('NOT_FOUND', '找不到交接的固定版本')
    const reviewed = readDesignSystemReference(base.source)
    workspaceComponent = {
      path: entry.path,
      exportName: component.exportName,
      source: entry.content,
    }
    const [module] = await bundleSelectedComponents({
      files: files.map((file) => ({ ...file, kind: 'source' })),
      components: [component],
    })
    source = renderCodingComponent(module, component.props)
    if (reviewed) source = `${designSystemReferenceHeader(reviewed)}\n${source}`
  } else if (source && artifact.type === 'react') {
    const entry = await deps.artifacts.getWorkspaceComponent(artifactId, baseVersion)
    if (entry) {
      const base = await deps.artifacts.getVersion(artifactId, baseVersion)
      if (base && retainsCodingComponent(base.source, source)) workspaceComponent = entry
    }
  }
  if (!source) throw new DomainError('BAD_REQUEST', '未提交作品源码')
  const check = deps.checks.check({ type: artifact.type, source })
  if (!check.ok) throw new DomainError('BAD_REQUEST', '作品未通过发布检查', check.errors)
  const { version } = await deps.service.update({
    id: artifactId,
    projectId,
    baseVersion,
    source,
    workspaceComponent,
    author: `${actor}:coding-${sessionId}`,
  })
  return { artifactId, version: version.version, path: `/a/${artifactId}/v/${version.version}` }
}
