import type {
  ArtifactHandoffReference,
  CodingSessionPublication,
  CodingSessionPublish,
} from '@akasha/protocol'
import { DomainError } from '../domain/errors.js'
import type { ArtifactRepository } from '../domain/ports.js'
import type { ArtifactService } from './artifact-service.js'
import type { CheckService } from './check-service.js'
import { bundleSelectedComponents } from './design-systems/bundle.js'

/** 只编译显式提交的工程文件；共用版本写锁按原交接基线提交，冲突不重试。 */
export async function publishCodingSession(
  deps: { artifacts: ArtifactRepository; checks: CheckService; service: ArtifactService },
  sessionId: string,
  reference: ArtifactHandoffReference,
  input: CodingSessionPublish,
): Promise<CodingSessionPublication> {
  const { artifactId, projectId, version: baseVersion } = reference
  const artifact = await deps.artifacts.findByPublicId(artifactId)
  if (!artifact || artifact.projectId !== projectId)
    throw new DomainError('NOT_FOUND', '作品不在当前项目')
  let source = input.source
  if (input.component) {
    if (artifact.type !== 'react')
      throw new DomainError(
        'BAD_REQUEST',
        '组件预览只可发布回 React 作品；其他类型请提交完整作品文件',
      )
    const { files, ...component } = input.component
    const [module] = await bundleSelectedComponents({
      files: files.map((file) => ({ ...file, kind: 'source' })),
      components: [component],
    })
    source = `import * as React from 'react';\nconst result = ${module};\nexport default function WorkspacePreview() { return React.createElement(React.Fragment, null, result.css && React.createElement('style', null, result.css), React.createElement(result.component, ${JSON.stringify(component.props)})); }\n`
  }
  if (!source) throw new DomainError('BAD_REQUEST', '未提交作品源码')
  const check = deps.checks.check({ type: artifact.type, source })
  if (!check.ok) throw new DomainError('BAD_REQUEST', '作品未通过发布检查', check.errors)
  const { version } = await deps.service.update({
    id: artifactId,
    projectId,
    baseVersion,
    source,
    author: `agent:coding-${sessionId}`,
  })
  return { artifactId, version: version.version, path: `/a/${artifactId}/v/${version.version}` }
}
