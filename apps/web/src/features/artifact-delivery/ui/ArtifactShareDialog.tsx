import type {
  ArtboardIndex,
  Artifact,
  HubArtifactSharing,
  HubGrantSummary,
  VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ConfirmDialog } from '@akasha/ui/confirm-dialog'
import { Modal } from '@akasha/ui/dialog'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'
import { useMessages } from '@/shared/i18n'
import {
  changeHubGrantRole,
  fetchHubArtifactSharing,
  type HubShareRole,
  hubSharingMutationOptions,
  restrictHubSharingToOwner,
  revokeHubGrant,
} from '../api/hubSharing'
import { messages } from '../owner-sharing.messages'
import { CreateShareLinkDialog } from './CreateShareLinkDialog'
import { HubInviteForm } from './HubInviteForm'
import { HubShareGrants } from './HubShareGrants'

interface ArtifactShareDialogProps {
  artifact: Artifact
  /** 签发普通链接时使用打开面板时已经读到的快照；不跟随后台更新。 */
  version: VersionSummary
  canvas?: ArtboardIndex
  onClose: () => void
}

interface RevokingGrant {
  grant: HubGrantSummary
  /** 授权对象的展示名，来自列表行。 */
  target: string
}

/** 所有者的分享管理；授权、邀请与「仅本人」都走所有者浏览器会话，普通链接仍由链接弹框签发。 */
export function ArtifactShareDialog({
  artifact,
  version,
  canvas,
  onClose,
}: ArtifactShareDialogProps) {
  const { t } = useMessages(messages)
  const client = useQueryClient()
  const writes = hubSharingMutationOptions(client, artifact.publicId)
  const saving = useIsMutating({ mutationKey: writes.mutationKey }) > 0
  const sharing = useQuery({
    queryKey: artifactKeys.sharing(artifact.publicId),
    queryFn: () => fetchHubArtifactSharing(artifact.publicId),
    retry: false,
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const [revoking, setRevoking] = useState<RevokingGrant | null>(null)
  const [restricting, setRestricting] = useState(false)

  const isSaving = () => client.isMutating({ mutationKey: writes.mutationKey }) > 0

  const roleChange = useMutation({
    ...writes,
    mutationFn: ({ grantId, role }: { grantId: string; role: HubShareRole }) =>
      changeHubGrantRole(artifact.publicId, grantId, role),
  })
  const revoke = useMutation({
    ...writes,
    mutationFn: (grantId: string) => revokeHubGrant(artifact.publicId, grantId),
    onSuccess: (_, grantId) => {
      client.setQueryData<HubArtifactSharing>(writes.mutationKey, (current) =>
        current ? { ...current, grants: current.grants.filter((g) => g.id !== grantId) } : current,
      )
    },
  })
  const restrict = useMutation({
    ...writes,
    mutationFn: () => restrictHubSharingToOwner(artifact.publicId),
    onSuccess: () => {
      client.setQueryData<HubArtifactSharing>(writes.mutationKey, (current) =>
        current ? { ...current, restricted: true, grants: [] } : current,
      )
    },
  })

  const commitRole = (grantId: string, role: HubShareRole) => {
    if (isSaving()) return
    // 乐观更新缓存里的角色；失败后由失效重取回滚，成功后由重取确认。
    client.setQueryData<HubArtifactSharing>(artifactKeys.sharing(artifact.publicId), (current) =>
      current
        ? {
            ...current,
            grants: current.grants.map((grant) =>
              grant.id === grantId ? { ...grant, role } : grant,
            ),
          }
        : current,
    )
    roleChange.mutate({ grantId, role })
  }

  const revokeGrant = () => {
    if (!revoking || isSaving()) return
    revoke.mutate(revoking.grant.id, {
      onSuccess: () => setRevoking(null),
    })
  }

  const restrictToOwner = () => {
    if (isSaving()) return
    restrict.mutate(undefined, {
      onSuccess: () => setRestricting(false),
    })
  }

  const closeLinkDialog = () => {
    setLinkOpen(false)
    void client.invalidateQueries({ queryKey: artifactKeys.sharing(artifact.publicId) })
  }

  const rowError = roleChange.error
    ? t('调整权限失败：{reason}', { reason: getRequestErrorMessage(roleChange.error) })
    : undefined
  const pendingGrantId = roleChange.isPending ? (roleChange.variables?.grantId ?? null) : null
  const data = sharing.isSuccess ? sharing.data : undefined
  const accessDenied = sharing.error instanceof ApiError && sharing.error.status === 403

  // 未受限时沿用作品原有的可见性，不暗示它曾对团队或公开；受限且无授权即仅本人。
  const accessLine = (info: HubArtifactSharing): string => {
    if (!info.restricted) return t('沿用作品原有的可见性，另加下列授权。')
    if (info.grants.length === 0) return t('当前仅本人可访问。')
    return t('仅所有者与下列授权可访问。')
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('管理作品分享')}
      description={t('查看并调整现有授权，或邀请指定的人访问。')}
      footer={
        data ? (
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                restrict.reset()
                setRestricting(true)
              }}
            >
              {t('仅本人可访问')}
            </Button>
            {data.policy.externalLinks ? (
              <Button variant="outline" disabled={saving} onClick={() => setLinkOpen(true)}>
                {t('创建链接')}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {sharing.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <AkashaMark size={16} loading className="text-ink" />
          {t('加载中…')}
        </p>
      ) : null}
      {sharing.error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-error">
            {accessDenied
              ? t('只有作品所有者可以管理分享。')
              : t('分享设置加载失败：{reason}', {
                  reason: getRequestErrorMessage(sharing.error),
                })}
          </p>
          {!accessDenied ? (
            <Button variant="outline" size="sm" onClick={() => void sharing.refetch()}>
              {t('重试')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {data ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm">{accessLine(data)}</p>
            {data.organization ? (
              <p className="text-xs text-ink-muted">
                {t('组织：{organization}', { organization: data.organization })}
              </p>
            ) : null}
            {!data.policy.externalLinks ? (
              <p className="text-xs text-ink-muted">
                {t('管理员已停用普通链接；已发出的链接不能再访问。')}
              </p>
            ) : null}
          </div>
          <fieldset disabled={saving} className="min-w-0">
            <HubShareGrants
              grants={data.grants}
              organization={data.organization}
              pendingGrantId={pendingGrantId}
              error={rowError}
              onRoleChange={commitRole}
              onRevoke={(grant, target) => {
                revoke.reset()
                setRevoking({ grant, target })
              }}
            />
          </fieldset>
          <HubInviteForm artifactId={artifact.publicId} sharing={data} saving={saving} />
        </div>
      ) : null}
      {linkOpen ? (
        <CreateShareLinkDialog
          artifact={artifact}
          version={version}
          canvas={canvas}
          saving={saving}
          onClose={closeLinkDialog}
        />
      ) : null}
      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !revoke.isPending) setRevoking(null)
          }}
          title={t('撤回「{target}」的访问？', { target: revoking.target })}
          description={t(
            '该授权立即失效。被撤回的普通链接不能重新启用，点名与邮箱邀请需重新创建。',
          )}
          confirmLabel={t('撤回')}
          loading={revoke.isPending}
          error={revoke.error ? getRequestErrorMessage(revoke.error) : undefined}
          onConfirm={revokeGrant}
        />
      ) : null}
      {restricting ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !restrict.isPending) setRestricting(false)
          }}
          title={t('撤清所有授权，仅本人可访问？')}
          description={t(
            '将移除全部邀请与链接授权，并停止沿用作品原有的可见性；历史匿名链接不能重新启用。',
          )}
          confirmLabel={t('仅本人可访问')}
          loadingLabel={t('正在撤清授权…')}
          loading={restrict.isPending}
          error={restrict.error ? getRequestErrorMessage(restrict.error) : undefined}
          onConfirm={restrictToOwner}
        />
      ) : null}
    </Modal>
  )
}
