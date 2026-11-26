import type {
  AgentReferenceInput,
  AgentReferencePreview,
  AgentReferenceScope,
} from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

const path = '/api/v1/agent/references'

/** 暂存已选文件的字节；返回实际交付内容的限时预览，不启动轮次。 */
export function stageReference(scope: AgentReferenceScope, file: AgentReferenceInput) {
  return requestJson<AgentReferencePreview>(path, {
    method: 'POST',
    body: JSON.stringify({ scope, file }),
  })
}

/** 只撤回原作用域中的临时标识；成功后不能再将它交付给轮次。 */
export function revokeReference(scope: AgentReferenceScope, id: string) {
  return requestJson<void>(path, { method: 'DELETE', body: JSON.stringify({ scope, id }) })
}
