import { describe, expect, it } from 'vitest'
import {
  AmbiguousMatchError,
  applyJsonPatch,
  applyTextEdits,
  createMemoryContainer,
  InvalidReceiptError,
  MatchNotFoundError,
  RoundLockedError,
  StatePatchError,
  VersionConflictError,
} from '../src/index.js'

describe('Artifact immutable versions & conflict detection', () => {
  it('creates deeply frozen immutable versions and enforces baseVersion with 409 diff', async () => {
    const { service } = createMemoryContainer()

    const v1 = await service.publish({
      slug: 'pr-walkthrough/auth',
      title: 'Auth Session Refactor',
      type: 'pr-walkthrough',
      source: 'line 1\nline 2\nline 3',
      author: 'agent:claude-1',
    })

    expect(v1.version.version).toBe(1)
    expect(v1.version.parentVersion).toBeNull()
    expect(Object.isFrozen(v1.version)).toBe(true)
    expect(() => {
      ;(v1.version as { source: string }).source = 'tampered'
    }).toThrow(TypeError)

    // 人类编辑生成 v2
    const v2 = await service.publish({
      slug: 'pr-walkthrough/auth',
      title: 'Auth Session Refactor (Human Edit)',
      type: 'pr-walkthrough',
      source: 'line 1\nline 2 human\nline 3',
      baseVersion: 1,
      visibility: 'team',
      author: 'human:sun',
    })
    expect(v2.version.version).toBe(2)
    expect(v2.version.parentVersion).toBe(1)
    expect(v2.artifact.visibility).toBe('team')

    // Agent 拿着过期的 baseVersion=1 发布，必须抛出 409 并携带人类改动 diff 与作者
    let caught: unknown
    try {
      await service.publish({
        slug: 'pr-walkthrough/auth',
        title: 'Stale Agent Write',
        type: 'pr-walkthrough',
        source: 'line 1\nline 2 agent\nline 3',
        baseVersion: 1,
        author: 'agent:claude-1',
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(VersionConflictError)
    const conflict = caught as VersionConflictError
    expect(conflict.code).toBe('VERSION_CONFLICT')
    expect(conflict.details.baseVersion).toBe(1)
    expect(conflict.details.headVersion).toBe(2)
    expect(conflict.details.authors).toEqual(['human:sun'])
    expect(conflict.details.diff).toContain('-line 2')
    expect(conflict.details.diff).toContain('+line 2 human')

    // v1 源码从未被修改
    const history = await service.getHistory(v1.artifact.publicId)
    expect(history).toHaveLength(2)
    expect(history[0]?.source).toBe('line 1\nline 2\nline 3')
  })

  it('supports old_str -> new_str incremental update and fails clearly on 0 or multiple matches', async () => {
    const { service } = createMemoryContainer()
    const { artifact } = await service.publish({
      slug: 'html/bench',
      title: 'Bench',
      type: 'html',
      source: '<div>alpha</div>\n<button>Save</button>\n<div>alpha</div>',
      author: 'agent:codex',
    })

    const v2 = await service.update({
      id: artifact.publicId,
      baseVersion: 1,
      edits: [{ old_str: '<button>Save</button>', new_str: '<button>Apply</button>' }],
      author: 'agent:codex',
    })
    expect(v2.version.version).toBe(2)
    expect(v2.version.source).toContain('<button>Apply</button>')

    // 零匹配
    expect(() =>
      applyTextEdits(v2.version.source, [{ old_str: 'not-here', new_str: 'x' }]),
    ).toThrow(MatchNotFoundError)

    // 多处匹配，报错需包含行号
    let multiErr: unknown
    try {
      applyTextEdits(v2.version.source, [{ old_str: 'alpha', new_str: 'beta' }])
    } catch (err) {
      multiErr = err
    }
    expect(multiErr).toBeInstanceOf(AmbiguousMatchError)
    expect((multiErr as AmbiguousMatchError).details).toMatchObject({
      matchCount: 2,
      lines: [1, 3],
    })
  })

  it('creates a new version when reverting to history without mutating existing versions', async () => {
    const { service } = createMemoryContainer()
    const v1 = await service.publish({
      slug: 'document/spec',
      title: 'Spec v1',
      type: 'document',
      source: '<doc><p id="a">v1</p></doc>',
      author: 'agent:agy',
    })
    await service.publish({
      slug: 'document/spec',
      title: 'Spec v2',
      type: 'document',
      source: '<doc><p id="a">v2</p></doc>',
      baseVersion: 1,
      author: 'agent:agy',
    })

    const v3 = await service.revert({
      id: v1.artifact.publicId,
      targetVersion: 1,
      baseVersion: 2,
      author: 'human:sun',
    })
    expect(v3.version.version).toBe(3)
    expect(v3.version.parentVersion).toBe(2)
    expect(v3.version.source).toBe('<doc><p id="a">v1</p></doc>')
    expect(await service.getHistory(v1.artifact.publicId)).toHaveLength(3)
  })
})

describe('StateStream RFC 6902 JSON Patch & replay', () => {
  it('applies all 6 RFC 6902 ops, replays to arbitrary seq, and rolls back atomically on failure', async () => {
    const { service } = createMemoryContainer()
    const { artifact } = await service.publish({
      slug: 'live-timeline/incident-9',
      title: 'Incident #9',
      type: 'live-timeline',
      source: '{}',
      author: 'agent:agy',
    })

    const s1 = await service.pushState({
      id: artifact.publicId,
      ops: [
        { op: 'add', path: '/steps', value: [{ name: 'triage', done: false }] },
        { op: 'add', path: '/meta', value: { 'a/b': 1, 'c~d': 2 } },
      ],
    })
    expect(s1.seq).toBe(1)

    const s2 = await service.pushState({
      id: artifact.publicId,
      ops: [
        { op: 'test', path: '/steps/0/done', value: false },
        { op: 'replace', path: '/steps/0/done', value: true },
        { op: 'add', path: '/steps/-', value: { name: 'mitigate', done: false } },
        { op: 'copy', from: '/meta/a~1b', path: '/copied' },
        { op: 'move', from: '/meta/c~0d', path: '/moved' },
      ],
    })
    expect(s2.seq).toBe(2)
    expect(s2.snapshot).toEqual({
      steps: [
        { name: 'triage', done: true },
        { name: 'mitigate', done: false },
      ],
      meta: { 'a/b': 1 },
      copied: 1,
      moved: 2,
    })

    const s3 = await service.pushState({
      id: artifact.publicId,
      ops: [{ op: 'remove', path: '/copied' }],
    })
    expect(s3.seq).toBe(3)
    expect(s3.snapshot.copied).toBeUndefined()

    // 回放到任意历史 seq 与当时快照完全一致
    const replayed1 = await service.getStateAt({ id: artifact.publicId, seq: 1 })
    expect(replayed1.seq).toBe(1)
    expect(replayed1.snapshot).toEqual(s1.snapshot)

    const replayed2 = await service.getStateAt({ id: artifact.publicId, seq: 2 })
    expect(replayed2.seq).toBe(2)
    expect(replayed2.snapshot).toEqual(s2.snapshot)

    // 路径失效或 test 失败时原子回滚，不修改原快照也不推进 seq
    await expect(
      service.pushState({
        id: artifact.publicId,
        ops: [
          { op: 'add', path: '/temp', value: 123 },
          { op: 'replace', path: '/nonexistent/deep', value: 456 },
        ],
      }),
    ).rejects.toThrow(StatePatchError)

    const latest = await service.getArtifact({ id: artifact.publicId })
    expect(latest.state.seq).toBe(3)
    expect(latest.state.snapshot.temp).toBeUndefined()
    // 确认独立 applyJsonPatch 不原地修改输入
    const frozen = Object.freeze({ x: 1 })
    expect(applyJsonPatch(frozen, [{ op: 'replace', path: '/x', value: 2 }])).toEqual({ x: 2 })
    expect(frozen.x).toBe(1)
  })
})

describe('ReviewRound anti-interruption drafts & Feedback receipt/ack', () => {
  it('holds comments as drafts during drafting round, promotes on submit, and enforces receipt/ack', async () => {
    const { service, realtime } = createMemoryContainer()
    const { artifact } = await service.publish({
      slug: 'artboard/settings',
      title: 'Settings Artboard',
      type: 'artboard',
      source: '{}',
      author: 'agent:claude',
    })

    const round = await service.openRound({
      id: artifact.publicId,
      groups: [
        { id: 'q1', title: '布局', kind: 'choose', options: ['a', 'b'], recommended: 'b' },
        { id: 'v1', title: '对比验收', kind: 'verify' },
      ],
    })

    // 未提交轮次内写评论 → 自动标为草稿，不广播 feedback.created 唤醒
    const eventsBefore = realtime.events.length
    const draftFb = await service.submitFeedback({
      id: artifact.publicId,
      version: 1,
      roundId: round.id,
      groupId: 'q1',
      kind: 'comment',
      element: { blockId: 'board-b', textPreview: '通知开关' },
      body: '间距再宽 4px',
      author: 'human:sun',
    })
    expect(draftFb.draft).toBe(true)
    expect(realtime.events.length).toBe(eventsBefore)

    // 默认拉取看不到草稿
    const beforeSubmit = await service.pullFeedback({ id: artifact.publicId })
    expect(beforeSubmit.items).toHaveLength(0)
    expect(beforeSubmit.receipt).toBeUndefined()

    // 选择方案并提交本轮 → 锁定轮次，草稿转为正式待消费反馈
    await service.recordDecision({
      id: artifact.publicId,
      roundId: round.id,
      groupId: 'q1',
      choice: 'b',
    })
    const submitted = await service.submitRound({ id: artifact.publicId, roundId: round.id })
    expect(submitted.status).toBe('submitted')

    // 锁定后人工不可直接修改选择
    await expect(
      service.recordDecision({
        id: artifact.publicId,
        roundId: round.id,
        groupId: 'q1',
        choice: 'a',
      }),
    ).rejects.toThrow(RoundLockedError)

    // 仅预览（detail=false）不发放回执
    const preview = await service.pullFeedback({ id: artifact.publicId, detail: false })
    expect(preview.items).toHaveLength(1)
    expect(preview.receipt).toBeUndefined()

    // 完整拉取发放回执，凭回执 ack 并解决线程
    const full = await service.pullFeedback({ id: artifact.publicId, detail: true })
    expect(full.receipt).toBeTruthy()
    const receipt = full.receipt ?? ''
    const acked = await service.ackFeedback({
      receipt,
      resolveIds: [draftFb.id],
    })
    expect(acked).toEqual({ acknowledged: 1, resolved: 1 })

    // 重复消费同一回执必须拒绝
    await expect(service.ackFeedback({ receipt })).rejects.toThrow(InvalidReceiptError)

    // 开启新一轮时旧轮次自动关闭
    const round2 = await service.openRound({
      id: artifact.publicId,
      groups: [{ id: 'q2', title: '配色', kind: 'choose', options: ['light', 'dark'] }],
    })
    const state = await service.getArtifact({ id: artifact.publicId })
    expect(state.rounds.find((r) => r.id === round.id)?.status).toBe('closed')
    expect(state.rounds.find((r) => r.id === round2.id)?.status).toBe('drafting')
  })
})
