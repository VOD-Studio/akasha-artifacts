import { describe, expect, it } from 'vitest'
import {
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
    })
    expect(report.passed).toBe(true)
    expect(report.cases).toHaveLength(2)
  })
})
