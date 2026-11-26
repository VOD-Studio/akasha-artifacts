import fs from 'node:fs/promises'
import path from 'node:path'
import { CodingSessionClient, runCodingSessionMcp } from '@akasha/mcp'
import {
  ArtifactReadHandoffInputSchema,
  CodingSessionGrantSchema,
  CodingSessionIdSchema,
  ErrorEnvelopeSchema,
} from '@akasha/protocol'
import { ensureDaemon } from '../daemon/lifecycle.js'
import { resolveAkashaHome } from '../daemon/state.js'
import { parseHubOrigin, readHubLogin } from '../hub/login.js'

/** 签入需要作者凭证，其他动作仅从项目外的私有文件恢复已授权的会话。 */
export async function runCodingCommand(
  action: string | undefined,
  flag: (key: string) => string | undefined,
) {
  const home = resolveAkashaHome(flag('home'))
  const workspace = await fs.realpath(flag('project') ?? process.cwd())
  const sessions = path.join(home, 'coding-sessions')
  if (action === 'connect') {
    const file = flag('handoff')
    if (!file) throw new Error('请用 --handoff 指定交接 JSON 文件')
    const { handoff: reference } = ArtifactReadHandoffInputSchema.parse(
      JSON.parse(await fs.readFile(file, 'utf8')),
    )
    const hub = flag('hub')
    let origin: string
    let ownerToken: string
    let projectId: string | undefined
    if (hub) {
      origin = parseHubOrigin(hub)
      const login = readHubLogin(home)
      if (login?.origin !== origin) throw new Error(`请先运行 akasha login --hub ${origin}`)
      ownerToken = login.token
      projectId = flag('project-id')
      if (!projectId) throw new Error('请用 --project-id 明确授权当前工作区对应的 Hub 项目')
    } else {
      const daemon = await ensureDaemon({ projectDir: workspace, homeDir: home })
      origin = daemon.baseUrl
      ownerToken = daemon.state.token
      projectId = daemon.projectId
    }
    if (projectId !== reference.projectId) throw new Error('交接不属于此编码工作区绑定的项目')
    const response = await fetch(
      new URL(`/api/v1/projects/${encodeURIComponent(projectId)}/coding-sessions`, origin),
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reference, label: flag('label') ?? path.basename(workspace) }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    )
    const data = await response.json()
    if (!response.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(data)
      throw new Error(parsed.success ? parsed.data.error.message : `签入失败（${response.status}）`)
    }
    const grant = CodingSessionGrantSchema.parse(data)
    await fs.mkdir(sessions, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(sessions, `${grant.id}.json`),
      JSON.stringify({ ...grant, workspace, origin, projectId }),
      { mode: 0o600, flag: 'wx' },
    )
    console.log(`会话 ${grant.id} · ${projectId} · 有效至 ${grant.expiresAt}`)
    return 0
  }
  if (action !== 'read' && action !== 'mcp') throw new Error('用法：akasha coding connect|read|mcp')
  const id = CodingSessionIdSchema.parse(flag('session'))
  const saved = JSON.parse(await fs.readFile(path.join(sessions, `${id}.json`), 'utf8'))
  const grant = CodingSessionGrantSchema.parse(saved)
  if (saved.workspace !== workspace || id !== grant.id || Date.parse(grant.expiresAt) <= Date.now())
    throw new Error('会话不属于当前工作区或已过期')
  const client = new CodingSessionClient({
    id,
    token: grant.token,
    origin: parseHubOrigin(saved.origin),
    projectId: saved.projectId,
  })
  if (action === 'mcp') await runCodingSessionMcp(client)
  else console.log(JSON.stringify(await client.read(), null, 2))
  return 0
}
