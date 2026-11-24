import type { ElementRef } from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/**
 * 把浏览器当前的选区与未提交草稿同步到本机 Daemon，供终端 Hook 在用户发消息时注入上下文。
 *
 * @param input - `element: null` 表示未选中元素；此时若草稿缺省或仅含空白，则清除项目选区。
 * 传入 `artifactId` 以关联当前项目内的活动制品；省略时不绑定制品。
 * @remarks 同步失败时静默返回，不阻断浏览器里的交互；不能据此确认 Daemon 已收到更新。
 */
export async function syncProjectSelection(
  projectId: string,
  input: { artifactId?: string; element: ElementRef | null; draftText?: string },
): Promise<void> {
  try {
    await requestJson(`/api/v1/projects/${encodeURIComponent(projectId)}/selection`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch {
    // 选区同步失败不阻断浏览器交互
  }
}
