import type { Project } from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/** 读取当前服务可见的项目；`dormant` 按读取时距最近活动是否超过七天计算。 */
export async function fetchProjects(): Promise<{ projects: Project[] }> {
  return requestJson<{ projects: Project[] }>('/api/v1/projects')
}

/**
 * 取消项目登记并清除服务端保存的项目选区；回执中的 `id` 为已移除的登记标识。
 *
 * @throws 项目不存在时拒绝并返回 `NOT_FOUND`，重复移除不视为成功。
 */
export async function removeProject(id: string): Promise<{ ok: true; id: string }> {
  return requestJson<{ ok: true; id: string }>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
