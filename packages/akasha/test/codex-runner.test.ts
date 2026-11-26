import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunnerLaunch } from '@akasha/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCodexRunner } from '../src/agent/codex.js'

const threadId = '00000000-0000-4000-a000-000000000111'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8Dwn4GBgYEJRIAwAB8XAgICR7MUAAAAAElFTkSuQmCC',
  'base64',
)
let home: string
let root: string
let request: AgentRunnerLaunch
const runner = createCodexRunner('/akasha/cli.js')

interface Invocation {
  args: string[]
  cwd: string
  mode: number
  files: string[]
  images: { name: string; data: string; mode: number }[]
  token: string
  staleToken?: string
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'akasha-codex-test-'))
  root = join(home, 'project')
  const bin = join(home, 'bin')
  await Promise.all([mkdir(bin), mkdir(root), mkdir(join(home, '.codex'))])
  await writeFile(join(root, '不得交付.txt'), '只属于项目')
  // 替身只记录 CLI 收到的参数和当时可见的文件，不调用模型或读取真实登录状态。
  await writeFile(
    join(bin, 'codex'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
const images = args.flatMap((arg, i) => arg === '--image' ? [args[i + 1]] : []);
fs.writeFileSync(${JSON.stringify(join(home, 'invocation.json'))}, JSON.stringify({
  args, cwd: process.cwd(), mode: fs.statSync('.').mode & 511, files: fs.readdirSync('.'),
  images: images.map(name => ({name, data: fs.readFileSync(name).toString('base64'), mode: fs.statSync(name).mode & 511})),
  token: process.env.AKASHA_TURN_TOKEN, staleToken: process.env.AKASHA_DAEMON_TOKEN
}));
const emit = data => console.log(JSON.stringify(data));
emit({type: 'thread.started', thread_id: ${JSON.stringify(threadId)}});
if (prompt === '中止') fs.watch('.');
else if (prompt === '失败') process.exitCode = 1;
else {
  emit({type: 'item.completed', item: {type: 'agent_message', text: 'CLI 测试回执'}});
  emit({type: 'turn.completed'});
}
`,
    { mode: 0o700 },
  )
  vi.stubEnv('HOME', home)
  vi.stubEnv('CODEX_HOME', join(home, '.codex'))
  vi.stubEnv('PATH', bin)
  vi.stubEnv('AKASHA_DAEMON_TOKEN', '不可传递')
  request = {
    root,
    projectId: 'project',
    baseUrl: 'http://127.0.0.1:4444',
    token: '仅限本轮',
    requestedTweaksOnly: false,
    prompt: '提交',
    signal: new AbortController().signal,
    onThread: vi.fn(),
  }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

async function invocation(): Promise<Invocation> {
  return JSON.parse(await readFile(join(home, 'invocation.json'), 'utf8'))
}

it('新建和恢复同一线程只附加本轮图片，下一轮不沿用临时目录或附件', async () => {
  const firstImage = { extension: 'png', bytes: png } as const
  await expect(runner.run({ ...request, images: [firstImage, firstImage] })).resolves.toBe(
    'CLI 测试回执',
  )
  expect(request.onThread).toHaveBeenCalledWith(threadId)
  const first = await invocation()
  expect(first.args[0]).toBe('exec')
  expect(first.args).not.toContain('resume')
  expect(first.images.map((image) => image.data)).toEqual([
    png.toString('base64'),
    png.toString('base64'),
  ])
  expect(first.images.every((image) => image.mode === 0o400)).toBe(true)
  expect(first.files).toHaveLength(2)
  expect(first.mode).toBe(0o700)
  expect(first.cwd).not.toBe(await realpath(root))
  await expect(realpath(first.cwd)).rejects.toMatchObject({ code: 'ENOENT' })

  const nextImage = await readFile(new URL('../../../docs/assets/icon.png', import.meta.url))
  await runner.run({ ...request, threadId, images: [{ extension: 'png', bytes: nextImage }] })
  const next = await invocation()
  expect(next.args.slice(0, 2)).toEqual(['exec', 'resume'])
  expect(next.args.slice(-2)).toEqual([threadId, '-'])
  expect(next.images.map((image) => image.data)).toEqual([nextImage.toString('base64')])
  expect(next.files).toHaveLength(1)
  expect(next.cwd).not.toBe(first.cwd)
  await expect(realpath(next.cwd)).rejects.toMatchObject({ code: 'ENOENT' })

  await runner.run({ ...request, threadId })
  const empty = await invocation()
  expect(empty.images).toEqual([])
  expect(empty.files).toEqual([])
  expect(empty.args.slice(-2)).toEqual([threadId, '-'])
  await expect(realpath(empty.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([false, true])('不授权 shell、外部读取或其他项目工具（仅调参=%s）', async (only) => {
  await runner.run({ ...request, requestedTweaksOnly: only })
  const { cwd, args, token, staleToken } = await invocation()
  expect(args).not.toContain(root)
  expect(token).toBe(request.token)
  expect(staleToken).toBeUndefined()
  expect(args).toEqual(
    expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--strict-config']),
  )
  expect(args).toContain('default_permissions="akasha"')
  expect(args).toContain(`permissions.akasha.filesystem={${JSON.stringify(cwd)}="read"}`)
  expect(args).toContain('permissions.akasha.network.enabled=false')
  expect(args).toContain('project_root_markers=[]')
  expect(args).toContain('approval_policy="never"')
  expect(args).toContain('mcp_servers.akasha.required=true')
  expect(args).toContain('web_search="disabled"')
  for (const name of [
    'shell_tool',
    'multi_agent',
    'hooks',
    'plugins',
    'apps',
    'browser_use',
    'computer_use',
  ]) {
    expect(args).toContain(`features.${name}=false`)
  }
  const exposed = only
    ? ['artifact_read_handoff', 'artifact_apply_requested_tweaks']
    : [
        'artifact_spec',
        'artifact_check',
        'artifact_publish',
        'artifact_update',
        'artifact_get',
        'artifact_read_handoff',
      ]
  expect(args).toContain(`mcp_servers.akasha.enabled_tools=${JSON.stringify(exposed)}`)
})

it.each(['失败', '中止'])('CLI %s 后也删除所有本轮附件', async (prompt) => {
  const controller = new AbortController()
  const onThread = () => {
    if (prompt === '中止') controller.abort()
  }
  await expect(
    runner.run({
      ...request,
      prompt,
      signal: controller.signal,
      onThread,
      images: [{ extension: 'png', bytes: png }],
    }),
  ).rejects.toThrow()
  const { cwd, images } = await invocation()
  expect(images).toHaveLength(1)
  await expect(realpath(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('即使 Codex 进程未能启动也不会留下图片', async () => {
  vi.stubEnv('TMPDIR', home)
  vi.stubEnv('PATH', root)
  const previousFiles = await readdir(home)
  await expect(
    runner.run({ ...request, images: [{ extension: 'png', bytes: png }] }),
  ).rejects.toThrow()
  expect(await readdir(home)).toEqual(previousFiles)
})
