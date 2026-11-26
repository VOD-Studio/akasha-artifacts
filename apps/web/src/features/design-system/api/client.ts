import {
  type DesignSystemPreviewInput,
  DesignSystemPreviewOutputSchema,
  type DesignSystemPublishInput,
  DesignSystemWriteOutputSchema,
} from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

function send(projectId: string, action: string, input: unknown) {
  return requestJson<unknown>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/design-systems/${action}`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 编译本次许可的草稿，不创建作品；预览代码只能交给隔离沙盒。 */
export async function previewSystem(projectId: string, input: DesignSystemPreviewInput) {
  return DesignSystemPreviewOutputSchema.parse(await send(projectId, 'preview', input))
}

/** 同步写入必须提交审阅时的基准版本和逐项确认的移除项。 */
export async function publishSystem(projectId: string, input: DesignSystemPublishInput) {
  return DesignSystemWriteOutputSchema.parse(await send(projectId, 'publish', input))
}
