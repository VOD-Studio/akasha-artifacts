import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Textarea } from '@akasha/ui/textarea'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { loadVersionMembers, replaceVersionMembers } from '../api/version-members'
import { messages } from '../messages'

interface VersionMembersProps {
  projectId: string
  id: string
  version: number
}

/** 编辑当前显示版本的名单；读取失败时不允许把未知名单当作空名单保存。 */
export function VersionMembers({ projectId, id, version }: VersionMembersProps) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const queryKey = ['system-version-members', projectId, id, version] as const
  const members = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadVersionMembers(projectId, id, version, signal),
    retry: false,
    gcTime: 0,
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const stored = members.data?.logins.join('\n') ?? ''
  const save = async () => {
    if (!members.isSuccess || draft === null || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await cache.cancelQueries({ queryKey, exact: true })
      const logins = draft
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const updated = await replaceVersionMembers(projectId, id, version, logins)
      cache.setQueryData(queryKey, updated)
      setDraft(null)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="space-y-2 border-t border-border pt-3" disabled={busy}>
      <legend className="font-medium">
        {t('共享此版本')} · v{version}
      </legend>
      {members.isPending && <p role="status">{t('正在读取')}</p>}
      {members.isError && (
        <div role="alert">
          {t('无法读取名单')}{' '}
          <Button variant="outline" onClick={() => void members.refetch()}>
            {t('重试')}
          </Button>
        </div>
      )}
      {members.isSuccess && (
        <>
          {members.data.logins.length === 0 && <p role="status">{t('尚未点名共享')}</p>}
          <Field
            label={t('GitHub 登录名')}
            hint={t('每行一名当前成员，最多 32 名。清空后保存会移除此版本的点名授权。')}
          >
            <Textarea
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              value={draft ?? stored}
              onChange={(event) => {
                setDraft(event.target.value)
                setFailed(false)
              }}
            />
          </Field>
          {failed && <p role="alert">{t('未保存。请检查成员登录名后重试。')}</p>}
          <Button
            loading={busy}
            disabled={draft === null || draft === stored}
            onClick={() => void save()}
          >
            {t('保存名单')}
          </Button>
        </>
      )}
    </fieldset>
  )
}
