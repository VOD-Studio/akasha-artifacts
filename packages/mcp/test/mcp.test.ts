import { startNodeServer } from '@akasha/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { AkashaHttpClient } from '../src/client.js'
import { createAkashaMcpServer } from '../src/server.js'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) await close()
  }
})

function extractText(result: unknown): string {
  const content =
    result && typeof result === 'object' && 'content' in result
      ? (result as { content?: unknown }).content
      : undefined
  const items = Array.isArray(content) ? (content as Array<{ type: string; text?: string }>) : []
  return items.map((i) => i.text ?? '').join('\n')
}

describe('@akasha/mcp stdio tools integration', () => {
  it('supports spec, check, publish, incremental update, 409 conflict guidance, state push, feedback receipt/ack, await, and verdict sync', async () => {
    const srv = await startNodeServer({ dbPath: ':memory:', port: 0 })
    closers.push(srv.close)

    const opened: string[] = []
    const mcpServer = createAkashaMcpServer({
      baseUrl: srv.baseUrl,
      token: srv.token,
      defaultProject: 'proj-mcp',
      onFirstPublish: (url) => {
        opened.push(url)
      },
    })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    const client = new Client({ name: 'test-client', version: '0.1.0' })
    await client.connect(clientTransport)
    closers.push(async () => {
      await client.close()
      await mcpServer.close()
    })

    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'artifact_ack_feedback',
      'artifact_await_feedback',
      'artifact_check',
      'artifact_get',
      'artifact_publish',
      'artifact_pull_feedback',
      'artifact_push_state',
      'artifact_read_handoff',
      'artifact_record_verdict',
      'artifact_spec',
      'artifact_update',
    ])

    // 1. 按需 spec 与 check 门禁
    const specRes = await client.callTool({ name: 'artifact_spec', arguments: { type: 'mermaid' } })
    expect(extractText(specRes)).toContain('@violetjs/inkline')

    const badCheck = await client.callTool({
      name: 'artifact_check',
      arguments: { type: 'react', source: "import fs from 'node:fs'\nexport default () => null" },
    })
    expect(extractText(badCheck)).toContain('DISALLOWED_IMPORT')

    // 2. 发布 v1（触发 onFirstPublish）
    const pub1 = await client.callTool({
      name: 'artifact_publish',
      arguments: {
        slug: 'html/mcp-demo',
        title: 'MCP Demo',
        type: 'html',
        source: '<h1>v1</h1>\n<button>Submit</button>',
      },
    })
    expect(pub1.isError).not.toBe(true)
    expect(opened).toHaveLength(1)
    const pub1Json = JSON.parse(extractText(pub1).split('\n\n')[1] ?? '{}') as {
      publicId: string
      version: number
      url: string
    }
    expect(pub1Json.version).toBe(1)
    expect(pub1Json.url).toBe(`${srv.baseUrl}/a/${pub1Json.publicId}`)

    // 3. 人类先改出 v2，随后 Agent 以过期 baseVersion=1 调用 artifact_update → 返回友好 409 diff 指引
    await srv.service.publish({
      projectId: 'proj-mcp',
      slug: 'html/mcp-demo',
      title: 'MCP Demo',
      type: 'html',
      source: '<h1>v1 human</h1>\n<button>Submit</button>',
      baseVersion: 1,
      author: 'human:sun',
    })

    const conflict = await client.callTool({
      name: 'artifact_update',
      arguments: {
        id: pub1Json.publicId,
        baseVersion: 1,
        edits: [{ old_str: '<button>Submit</button>', new_str: '<button>Go</button>' }],
      },
    })
    expect(conflict.isError).toBe(true)
    const conflictText = extractText(conflict)
    expect(conflictText).toContain('409')
    expect(conflictText).toContain('human:sun')
    expect(conflictText).toContain('+<h1>v1 human</h1>')

    // 4. Agent 调用 artifact_get 后以 baseVersion=2 合并并成功增量更新到 v3
    const got = await client.callTool({
      name: 'artifact_get',
      arguments: { id: pub1Json.publicId },
    })
    expect(extractText(got)).toContain('<h1>v1 human</h1>')

    const upd = await client.callTool({
      name: 'artifact_update',
      arguments: {
        id: pub1Json.publicId,
        baseVersion: 2,
        edits: [{ old_str: '<button>Submit</button>', new_str: '<button>Go</button>' }],
      },
    })
    expect(upd.isError).not.toBe(true)
    expect(extractText(upd)).toContain('v3')

    const handoff = {
      artifactId: pub1Json.publicId,
      projectId: 'proj-mcp',
      version: 1,
      pageId: '',
      boardId: 'main',
      element: { selector: 'button', textPreview: 'Submit' },
    }
    const readHandoff = (target: typeof handoff) =>
      client.callTool({ name: 'artifact_read_handoff', arguments: { handoff: target } })
    const original = await readHandoff(handoff)
    expect(original.isError).not.toBe(true)
    expect(JSON.parse(extractText(original))).toMatchObject({
      projectId: 'proj-mcp',
      artifactId: pub1Json.publicId,
      version: 1,
      source: '<h1>v1</h1>\n<button>Submit</button>',
      selection: { boardId: 'main', element: { selector: 'button' } },
    })
    const mismatch = await readHandoff({ ...handoff, projectId: 'unrelated-project' })
    expect(mismatch.isError).toBe(true)
    expect(extractText(mismatch)).not.toContain('<h1>')
    expect((await readHandoff({ ...handoff, boardId: 'another-board' })).isError).toBe(true)

    // 5. push_state 零闪烁更新
    const pushed = await client.callTool({
      name: 'artifact_push_state',
      arguments: {
        id: pub1Json.publicId,
        patch: [{ op: 'add', path: '/ready', value: true }],
      },
    })
    expect(pushed.isError).not.toBe(true)
    expect(extractText(pushed)).toContain('seq=1')

    // 6. 评审轮次 + 终端裁决回写 + 反馈拉取与 receipt ack
    const round = await srv.service.openRound({
      id: pub1Json.publicId,
      groups: [{ id: 'q1', title: '按钮文案', kind: 'choose', options: ['a', 'b'] }],
    })
    const fb = await srv.service.submitFeedback({
      id: pub1Json.publicId,
      version: 3,
      roundId: round.id,
      groupId: 'q1',
      kind: 'comment',
      element: { loc: '2:1' },
      body: '按钮改蓝色',
      author: 'human:sun',
    })

    const synced = await client.callTool({
      name: 'artifact_record_verdict',
      arguments: {
        id: pub1Json.publicId,
        roundId: round.id,
        groupId: 'q1',
        choice: 'b',
        submitRound: true,
      },
    })
    expect(synced.isError).not.toBe(true)
    expect(extractText(synced)).toContain('submitted')

    const pulled = await client.callTool({
      name: 'artifact_pull_feedback',
      arguments: { id: pub1Json.publicId, detail: true },
    })
    const pulledJson = JSON.parse(extractText(pulled)) as {
      items: Array<{ id: string }>
      receipt?: string
    }
    expect(pulledJson.items.map((i) => i.id)).toEqual([fb.id])
    expect(pulledJson.receipt).toBeTruthy()

    const acked = await client.callTool({
      name: 'artifact_ack_feedback',
      arguments: { receipt: pulledJson.receipt, resolveIds: [fb.id] },
    })
    expect(acked.isError).not.toBe(true)
    expect(extractText(acked)).toContain('解决 1 条')

    // 7. artifact_await_feedback 超时返回 pending（带 cursor）
    const pending = await client.callTool({
      name: 'artifact_await_feedback',
      arguments: { id: pub1Json.publicId, after: '1', timeoutSec: 1 },
    })
    expect(extractText(pending)).toContain('pending')
  })

  it('automatically refreshes credentials via resolveConnection when shared Daemon rotates token on replacement', async () => {
    const srv = await startNodeServer({ dbPath: ':memory:', port: 0 })
    closers.push(srv.close)

    let refreshedCount = 0
    const httpClient = new AkashaHttpClient({
      baseUrl: srv.baseUrl,
      token: 'stale-old-token',
      resolveConnection: async () => {
        refreshedCount += 1
        return { baseUrl: srv.baseUrl, token: srv.token }
      },
    })

    const res = await httpClient.publish({
      slug: 'html/auto-refresh',
      title: 'Auto Refresh',
      type: 'html',
      source: '<p>ok</p>',
    })
    expect(refreshedCount).toBe(1)
    expect(res.version.version).toBe(1)
  })
})
