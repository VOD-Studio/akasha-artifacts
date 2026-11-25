import { requestJson } from '@/shared/api/request'

/** 只有当前浏览器会话符合授权对象才返回作品 ID；接受邀请不签发持有者链接。 */
export function acceptInvitation(id: string): Promise<{ artifactId: string }> {
  return requestJson(
    `/api/v1/invitations/${encodeURIComponent(id)}/accept`,
    { method: 'POST' },
    'workbench',
  )
}
