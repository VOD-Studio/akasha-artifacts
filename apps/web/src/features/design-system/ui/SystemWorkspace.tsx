import {
  type ArtifactWorkspaceDetail,
  DesignSystemSnapshotSchema,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useMemo, useState } from 'react'
import {
  hasVersionSource,
  useArtifactManagementQuery,
  useArtifactSourceQuery,
} from '@/entities/artifact'
import { isResourceUnavailable } from '@/shared/api/error'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { messages } from '../messages'
import { componentKey } from '../model/review'
import { AssetReview } from './AssetReview'
import { GenerateArtboard } from './GenerateArtboard'
import { GuidanceFields } from './GuidanceFields'
import { OwnerVersionPublication } from './PublicationControls'
import { type SystemBaseline, SystemEditor } from './SystemEditor'
import { SystemPreview } from './SystemPreview'
import { VersionMembers } from './VersionMembers'

interface SystemWorkspaceProps {
  detail: ArtifactWorkspaceDetail
  versions: readonly VersionSummary[]
  fixedVersion?: number
  sandboxOrigin: string
  onBack: () => void
  onVersion: (version?: number) => void
  onOpenArtifact: (id: string) => void
}

/** 系统来源单独审阅，不把系统清单当作 React 源码放进通用画板编辑器。 */
export function SystemWorkspace({
  detail,
  versions,
  fixedVersion,
  sandboxOrigin,
  onBack,
  onVersion,
  onOpenArtifact,
}: SystemWorkspaceProps) {
  const { t } = useMessages(messages)
  const { artifact, version, access } = detail
  const management = useArtifactManagementQuery(artifact.publicId, artifact.projectId, !access)
  const canManage =
    !access && management.data?.canManage === true && !isResourceUnavailable(management.error)
  const fetched = useArtifactSourceQuery(
    artifact.publicId,
    version.version,
    !hasVersionSource(version),
  )
  const source = hasVersionSource(version) ? version.source : fetched.data?.source
  const snapshot = useMemo(() => {
    if (!source) return
    try {
      return DesignSystemSnapshotSchema.parse(JSON.parse(source))
    } catch {
      return
    }
  }, [source])
  const [baseline, setBaseline] = useState<SystemBaseline | null>(null)
  const editing = canManage && baseline && fixedVersion === undefined
  const changeVersion = (value: string) => onVersion(value === 'head' ? undefined : Number(value))
  return (
    <main className="h-dvh overflow-auto bg-canvas text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t('返回作品库')}
        </Button>
        <h1 className="min-w-0 flex-1 break-words font-semibold">
          <bdi>{version.title}</bdi>
        </h1>
        {!access?.version && versions.length > 0 && (
          <Field label={t('版本')}>
            <Select
              disabled={!!editing}
              value={fixedVersion === undefined ? 'head' : String(fixedVersion)}
              onValueChange={changeVersion}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="head">
                  {t('最新版本')} · v{artifact.headVersion}
                </SelectItem>
                {versions.map((item) => (
                  <SelectItem key={item.version} value={String(item.version)}>
                    v{item.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <LanguageMenu />
      </header>
      <div className="mx-auto max-w-3xl space-y-5 p-4 text-sm sm:p-6">
        {editing && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setBaseline(null)}>
              {t('返回系统版本')}
            </Button>
            <SystemEditor
              baseline={baseline}
              projectId={artifact.projectId}
              sandboxOrigin={sandboxOrigin}
              onSaved={() => {
                setBaseline(null)
                onVersion()
              }}
            />
          </>
        )}
        {!editing && !snapshot && !source && fetched.isLoading && (
          <p role="status">{t('正在读取')}</p>
        )}
        {!editing && !snapshot && (source !== undefined || !fetched.isLoading) && (
          <div role="alert">
            {t('无法读取设计系统')}{' '}
            {fetched.isError && (
              <Button variant="outline" onClick={() => void fetched.refetch()}>
                {t('重试')}
              </Button>
            )}
          </div>
        )}
        {!editing && snapshot && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {t('设计系统')} · v{version.version}
              </h2>
              {canManage && fixedVersion === undefined && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setBaseline({
                      draft: snapshot.draft,
                      title: version.title,
                      slug: artifact.slug,
                      id: artifact.publicId,
                      version: version.version,
                    })
                  }
                >
                  {t('重新同步')}
                </Button>
              )}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>{t('来源')}</dt>
              <dd>
                <bdi>{snapshot.draft.origin.label}</bdi> ·{' '}
                {snapshot.draft.origin.kind === 'local'
                  ? t('本机文件')
                  : t('已授权的 GitHub 检出目录')}
              </dd>
              <dt>{t('来源指纹')}</dt>
              <dd dir="ltr" className="break-all font-mono">
                {snapshot.sourceVersion}
              </dd>
            </dl>
            {isCloudHub() && canManage && (
              <VersionMembers
                key={`${artifact.projectId}:${artifact.publicId}:${version.version}`}
                projectId={artifact.projectId}
                id={artifact.publicId}
                version={version.version}
              />
            )}
            {isCloudHub() && canManage && fixedVersion !== undefined && (
              <OwnerVersionPublication
                key={`publication:${artifact.projectId}:${artifact.publicId}:${version.version}`}
                projectId={artifact.projectId}
                id={artifact.publicId}
                version={version.version}
              />
            )}
            <GuidanceFields guidance={snapshot.draft.guidance} />
            <AssetReview files={snapshot.draft.files} />
            {snapshot.draft.components.length > 0 && (
              <section>
                <h3 className="font-medium">{t('组件')}</h3>
                <ul>
                  {snapshot.draft.components.map((entry) => (
                    <li key={componentKey(entry)}>
                      <code dir="ltr">
                        {componentKey(entry)} {JSON.stringify(entry.props)}
                      </code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <SystemPreview
              key={`${artifact.publicId}:${version.version}`}
              source={snapshot.previewSource}
              sandboxOrigin={sandboxOrigin}
            />
            {canManage && (
              <GenerateArtboard
                key={version.version}
                id={artifact.publicId}
                projectId={artifact.projectId}
                version={version.version}
                components={snapshot.draft.components}
                onOpenArtifact={onOpenArtifact}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
