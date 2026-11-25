import { describe, expect, it } from 'vitest'
import {
  AgentDesignInputSchema,
  AgentMessageInputSchema,
  ApplyRequestedTweaksInputSchema,
  ArtifactAwaitFeedbackInputSchema,
  ArtifactPublishInputSchema,
  ArtifactSchema,
  ArtifactUpdateInputSchema,
  AuthorSchema,
  CheckResultSchema,
  EditOpSchema,
  ElementRefSchema,
  ErrorEnvelopeSchema,
  FeedbackSchema,
  JsonPatchOpSchema,
  PROTOCOL_VERSION,
  ProjectSchema,
  PublicIdSchema,
  RealtimeClientMessageSchema,
  RealtimeServerEventSchema,
  ReceiptSchema,
  ReviewRoundSchema,
  runContractTests,
  SandboxToShellMessageSchema,
  ShellToSandboxMessageSchema,
  SlugSchema,
  StatePatchSchema,
  VersionSchema,
} from '../src/index.js'

const NOW = '2026-11-22T09:00:00.000Z'
const PUB_ID = 'Akasha0123456789abcde'

it('参数申请只随续接消息发送；工具不接受模型重选基准或目标', () => {
  const message = '采用当前调整'
  const target = { artifactId: PUB_ID, projectId: 'design', version: 4, boardId: 'phone' }
  const tweakApplication = { boardId: 'phone', targetIds: ['tablet'], values: { duration: 2 } }
  const input = { message, target, tweakApplication }
  expect(AgentMessageInputSchema.parse(input)).toEqual(input)
  expect(
    AgentDesignInputSchema.safeParse({ message, projectId: 'design', tweakApplication }).success,
  ).toBe(false)
  expect(ApplyRequestedTweaksInputSchema.safeParse({}).success).toBe(true)
  expect(
    ApplyRequestedTweaksInputSchema.safeParse({ baseVersion: 5, tweakApplication }).success,
  ).toBe(false)
})

describe('@akasha/protocol primitives & domain', () => {
  it('validates Author, PublicId, and Slug with positive and negative cases', () => {
    expect(AuthorSchema.safeParse('agent:claude-1').success).toBe(true)
    expect(AuthorSchema.safeParse('human:sun').success).toBe(true)
    expect(AuthorSchema.safeParse('bot:123').success).toBe(false)
    expect(AuthorSchema.safeParse('human:').success).toBe(false)

    expect(PublicIdSchema.safeParse(PUB_ID).success).toBe(true)
    expect(PublicIdSchema.safeParse('short').success).toBe(false)
    expect(PublicIdSchema.safeParse('bad_char_01234567890').success).toBe(false)

    expect(SlugSchema.safeParse('document/retry-policy').success).toBe(true)
    expect(SlugSchema.safeParse('pr-142').success).toBe(true)
    expect(SlugSchema.safeParse('UpperCase').success).toBe(false)
    expect(SlugSchema.safeParse('/leading-slash').success).toBe(false)
  })

  it('validates Project, Artifact, and Version schemas', () => {
    expect(
      ProjectSchema.safeParse({
        id: 'proj-1',
        rootPath: '/repo/akasha',
        name: 'akasha',
        lastActiveAt: NOW,
      }).success,
    ).toBe(true)

    expect(
      ArtifactSchema.safeParse({
        publicId: PUB_ID,
        slug: 'pr-walkthrough/auth',
        projectId: 'proj-1',
        title: 'Auth Refactor',
        type: 'pr-walkthrough',
        visibility: 'private',
        headVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true)

    expect(
      VersionSchema.safeParse({
        artifactId: PUB_ID,
        version: 2,
        parentVersion: 1,
        author: 'human:sun',
        title: 'v2',
        source: '<h1>Hello</h1>',
        createdAt: NOW,
      }).success,
    ).toBe(true)

    expect(
      VersionSchema.safeParse({
        artifactId: PUB_ID,
        version: 0,
        parentVersion: null,
        author: 'agent:cli',
        title: 'bad',
        source: '',
        createdAt: NOW,
      }).success,
    ).toBe(false)
  })

  it('validates RFC 6902 JsonPatchOp and StatePatch', () => {
    expect(
      StatePatchSchema.safeParse({
        artifactId: PUB_ID,
        ops: [
          { op: 'add', path: '/steps/0', value: { done: true } },
          { op: 'replace', path: '/a~1b/c~0d', value: 42 },
          { op: 'remove', path: '/obsolete' },
          { op: 'move', from: '/a', path: '/b' },
          { op: 'copy', from: '/b', path: '/c' },
          { op: 'test', path: '/c', value: 1 },
        ],
      }).success,
    ).toBe(true)

    // 非法 JSON Pointer（缺少前导斜杠或非法转义 ~2）
    expect(JsonPatchOpSchema.safeParse({ op: 'add', path: 'no-slash', value: 1 }).success).toBe(
      false,
    )
    expect(JsonPatchOpSchema.safeParse({ op: 'remove', path: '/bad~2escape' }).success).toBe(false)
    expect(StatePatchSchema.safeParse({ artifactId: PUB_ID, ops: [] }).success).toBe(false)
  })

  it('validates ElementRef requires at least one locator and valid loc format', () => {
    expect(ElementRefSchema.safeParse({ blockId: 'p-123' }).success).toBe(true)
    expect(ElementRefSchema.safeParse({ loc: '12:4' }).success).toBe(true)
    expect(
      ElementRefSchema.safeParse({ loc: '12:4-15:8', selector: 'button.primary' }).success,
    ).toBe(true)
    expect(ElementRefSchema.safeParse({}).success).toBe(false)
    expect(ElementRefSchema.safeParse({ loc: 'invalid' }).success).toBe(false)
  })

  it('validates ReviewRound, Feedback, Receipt, EditOp, and CheckResult', () => {
    expect(
      ReviewRoundSchema.safeParse({
        id: 'round-1',
        artifactId: PUB_ID,
        status: 'drafting',
        groups: [
          { id: 'q1', title: '布局方向', kind: 'choose', options: ['a', 'b'], recommended: 'b' },
          { id: 'v1', title: '按钮验收', kind: 'verify', verdict: 'pass' },
        ],
        submittedAt: null,
        createdAt: NOW,
      }).success,
    ).toBe(true)

    expect(
      FeedbackSchema.safeParse({
        id: 'fb-1',
        artifactId: PUB_ID,
        version: 1,
        roundId: 'round-1',
        groupId: 'q1',
        kind: 'comment',
        element: { loc: '4:2', textPreview: '提交按钮' },
        body: '颜色调深一点',
        author: 'human:sun',
        draft: true,
        status: 'pending',
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true)

    expect(
      ReceiptSchema.safeParse({
        receipt: 'rcpt-1',
        artifactId: PUB_ID,
        cursor: 'fb-1',
        feedbackIds: ['fb-1'],
        issuedAt: NOW,
      }).success,
    ).toBe(true)

    expect(EditOpSchema.safeParse({ kind: 'text', loc: '3:5', value: '新标题' }).success).toBe(true)
    expect(
      EditOpSchema.safeParse({ kind: 'move', loc: '3:5', targetParentLoc: '1:0', index: -1 })
        .success,
    ).toBe(false)

    expect(
      CheckResultSchema.safeParse({
        ok: false,
        errors: [
          { severity: 'error', code: 'DISALLOWED_IMPORT', message: '不允许导入 fs', line: 1 },
        ],
        warnings: [],
      }).success,
    ).toBe(true)
  })
})

describe('@akasha/protocol MCP, HTTP, Realtime, and Bridge', () => {
  it('validates MCP inputs and enforces await timeout ceiling', () => {
    expect(
      ArtifactPublishInputSchema.safeParse({
        slug: 'artboard/settings',
        title: '设置页方案',
        type: 'artboard',
        source: '{}',
      }).success,
    ).toBe(true)

    expect(
      ArtifactUpdateInputSchema.safeParse({
        id: PUB_ID,
        baseVersion: 1,
        edits: [{ old_str: 'old', new_str: 'new' }],
      }).success,
    ).toBe(true)
    expect(
      ArtifactUpdateInputSchema.safeParse({
        id: PUB_ID,
        baseVersion: 1,
        edits: [],
      }).success,
    ).toBe(false)

    expect(ArtifactAwaitFeedbackInputSchema.safeParse({ id: PUB_ID, timeoutSec: 50 }).success).toBe(
      true,
    )
    expect(ArtifactAwaitFeedbackInputSchema.safeParse({ id: PUB_ID, timeoutSec: 51 }).success).toBe(
      false,
    )
  })

  it('validates ErrorEnvelope, Realtime events, and Bridge messages', () => {
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: { code: 'VERSION_CONFLICT', message: '版本冲突', details: { headVersion: 3 } },
      }).success,
    ).toBe(true)

    expect(
      RealtimeServerEventSchema.safeParse({
        v: PROTOCOL_VERSION,
        seq: 1,
        timestamp: NOW,
        type: 'agent.activity',
        projectId: 'proj-1',
        state: 'editing',
      }).success,
    ).toBe(true)
    expect(
      RealtimeClientMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: 'subscribe',
        artifactId: PUB_ID,
        lastSeq: 5,
      }).success,
    ).toBe(true)

    expect(
      ShellToSandboxMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        nonce: 'n-1',
        type: 'render',
        artifactType: 'react',
        version: 1,
        source: 'export default () => null',
        state: {},
        preservedState: { scrollY: 120, controls: { stiffness: 200 } },
      }).success,
    ).toBe(true)

    expect(
      SandboxToShellMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        nonce: 'n-1',
        type: 'viewState.snapshot',
        state: { activePage: 'review', controls: { damping: 24 } },
      }).success,
    ).toBe(true)

    expect(
      SandboxToShellMessageSchema.safeParse({
        v: 99,
        nonce: 'n-1',
        type: 'ready',
      }).success,
    ).toBe(false)
  })

  it('只有一次性 PNG 导出可以放大到 2×，总览捕获仍限固有尺寸以内', () => {
    const capture = {
      type: 'capture.png',
      v: PROTOCOL_VERSION,
      nonce: 'export',
      version: 2,
      width: 720,
      height: 520,
      scale: 2,
    }
    expect(ShellToSandboxMessageSchema.safeParse(capture).success).toBe(true)
    expect(ShellToSandboxMessageSchema.safeParse({ ...capture, scale: 3 }).success).toBe(false)
    expect(
      ShellToSandboxMessageSchema.safeParse({ ...capture, requestId: 'preview' }).success,
    ).toBe(false)
    expect(
      ShellToSandboxMessageSchema.safeParse({ ...capture, requestId: 'preview', scale: 0.25 })
        .success,
    ).toBe(true)
  })

  it('流式打印按固定版本与页序传送一张 PNG，不接受含糊的末页或无效纸型', () => {
    const envelope = { v: PROTOCOL_VERSION, nonce: 'print', version: 3 }
    const render = { ...envelope, type: 'render', artifactType: 'html', state: {}, source: '' }
    const page = { ...envelope, type: 'capture.print', page: 0 }
    expect(ShellToSandboxMessageSchema.parse({ ...render, printPaper: 'letter' })).toMatchObject({
      printPaper: 'letter',
    })
    expect(ShellToSandboxMessageSchema.safeParse({ ...render, printPaper: 'custom' }).success).toBe(
      false,
    )
    expect(ShellToSandboxMessageSchema.parse(page)).toEqual(page)
    expect(ShellToSandboxMessageSchema.safeParse({ ...page, page: -1 }).success).toBe(false)
    const result = {
      ...page,
      type: 'capture.print.result',
      last: true,
      png: new Blob(['png'], { type: 'image/png' }),
    }
    expect(SandboxToShellMessageSchema.parse(result)).toEqual(result)
    expect(SandboxToShellMessageSchema.safeParse({ ...result, last: undefined }).success).toBe(
      false,
    )
    expect(SandboxToShellMessageSchema.safeParse({ ...result, png: [result.png] }).success).toBe(
      false,
    )
  })

  it('保留总览控制、独立选区消息和单板参数预览', () => {
    const envelope = { v: PROTOCOL_VERSION, nonce: 'board-frame' }
    const messages = [
      {
        type: 'render',
        artifactType: 'html',
        boardId: 'payment',
        overviewAnimation: false,
        version: 2,
        renderId: 1,
        source: '<main>付款</main>',
        boardAppearance: { background: '#f0f0f0', cornerRadius: 18 },
        boardTweaks: { density: 'compact' },
        state: {},
      },
      { type: 'animation.set', version: 2, animate: true },
      {
        type: 'board.tweaks.preview',
        boardId: 'payment',
        version: 2,
        values: { density: 'roomy' },
      },
      { type: 'capture.cancel', requestId: 'capture-1' },
      { type: 'inspect.at', purpose: 'select', requestId: 'select-1', version: 2, x: 8, y: 9 },
    ]
    for (const message of messages) {
      const payload = { ...envelope, ...message }
      expect(ShellToSandboxMessageSchema.parse(payload)).toEqual(payload)
    }
  })

  it('runs black-box HTTP contract test runner against a compliant mock fetch', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/health')) {
        return new Response(JSON.stringify({ ok: true, version: '0.1.0' }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }),
        { status: 404 },
      )
    }

    const report = await runContractTests({
      baseUrl: 'http://127.0.0.1:24321',
      fetchImpl: mockFetch,
      suite: 'core',
    })
    expect(report.passed).toBe(true)
    expect(report.cases).toHaveLength(2)
  })
})
