import type {
  AnnotationThread,
  ElementRef,
  Feedback,
  FeedbackKind,
  ReviewRound,
  Verdict,
} from '@akasha/protocol'
import { requestJson } from '../../../shared/api/request'

/** 写到指定作品版本的批注、修改记录或诊断。 */
export interface SubmitFeedbackInput {
  project?: string
  version: number
  /** 绑定草拟轮次时按该轮的提交规则公开；无轮次可省略。 */
  roundId?: string | null
  groupId?: string | null
  kind: FeedbackKind
  /** `agent` 表示面向 Agent；有轮次的草稿在提交本轮后才可被消费。 */
  audience?: Feedback['audience']
  /** 省略或为 `null` 表示针对整个版本，不绑定页面元素。 */
  element?: ElementRef | null
  body: string
}

/** 给指定版本写批注、修改记录或运行错误；返回反馈记录，不表示 Agent 已消费。 */
export async function submitArtifactFeedback(
  id: string,
  input: SubmitFeedbackInput,
): Promise<{ feedback: Feedback }> {
  return requestJson<{ feedback: Feedback }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 读取服务端授权的反馈和讨论线程；请求包含当前调用者可读取的草稿。 */
export async function fetchArtifactFeedback(
  id: string,
): Promise<{ items: Feedback[]; threads: Record<string, AnnotationThread> }> {
  return requestJson<{ items: Feedback[]; threads: Record<string, AnnotationThread> }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/feedback?includeDrafts=true`,
  )
}

/** 可在任意已授权的历史版本下继续讨论，不改变 Agent 消费状态。 */
export type AnnotationThreadAction =
  | { kind: 'reply'; body: string }
  | { kind: 'resolve'; resolved: boolean }

/** 在原线程回复或解决讨论；不新建 Agent 反馈，也不改变该线程对应的版本。 */
export async function updateAnnotationThread(
  artifactId: string,
  id: string,
  action: AnnotationThreadAction,
): Promise<unknown> {
  return requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/feedback/${encodeURIComponent(id)}/${action.kind === 'reply' ? 'replies' : 'resolve'}`,
    {
      method: 'POST',
      body: JSON.stringify(
        action.kind === 'reply' ? { body: action.body } : { resolved: action.resolved },
      ),
    },
  )
}

/** 提交本轮，使面向 Agent 的轮次反馈可被消费。不等待 Agent 回复。 */
export async function submitReviewRound(
  id: string,
  roundId: string,
  projectId?: string,
): Promise<{ round: ReviewRound }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/rounds/${encodeURIComponent(roundId)}/submit${query}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

/** 将轮次退回草拟状态；已经提交的反馈不会被删除。 */
export async function withdrawReviewRound(
  id: string,
  roundId: string,
  projectId?: string,
): Promise<{ round: ReviewRound }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/rounds/${encodeURIComponent(roundId)}/withdraw${query}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

/** 写入评审分组的人工决定；选择题传 `choice`，验收题传 `verdict`。 */
export interface RecordHumanDecisionInput {
  project?: string
  roundId: string
  groupId: string
  choice?: string
  verdict?: Verdict
  note?: string
  /** 为 `true` 时在记录决定后提交整轮；默认只记录本项。 */
  submitRound?: boolean
}

/** 记录人的选择或验收结论；只有显式设定 `submitRound` 才同时提交轮次。 */
export async function recordHumanDecision(
  id: string,
  input: RecordHumanDecisionInput,
): Promise<{ round: ReviewRound }> {
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/verdict`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, fromAgent: false }),
    },
  )
}
