import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessId } from '@akasha/hooks'
import { SKILLS_CATALOG } from '@akasha/skills'
import { probeDaemon } from '../daemon/lifecycle.js'
import { AKASHA_VERSION } from '../daemon/serve.js'
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SHELL_PORTS,
  parsePortList,
  resolveAkashaHome,
} from '../daemon/state.js'

export const SUPPORTED_HARNESSES: readonly HarnessId[] = [
  'claude-code',
  'antigravity',
  'codex',
  'cursor',
]

export interface HarnessPaths {
  harness: HarnessId
  targetDir: string
  skillsDir: string
  mcpConfigPath: string
  mcpFormat: 'json' | 'toml'
  hooksConfigPath: string
  manifestPath: string
}

// 解析各 CLI Harness 的原生配置文件路径与格式：
// - claude-code: 用户级 MCP 在 ~/.claude.json，项目级（显式 --dir）在 <dir>/.mcp.json；Hooks 在 settings.json
// - codex: MCP 在 ~/.codex/config.toml（TOML [mcp_servers.akasha]）；Hooks 在 hooks.json
// - cursor: MCP 在 ~/.cursor/mcp.json；Hooks 在 ~/.cursor/hooks.json（version: 1 + hooks.<event> 数组）
// - antigravity: MCP 在 ~/.gemini/antigravity/mcp_config.json；Hooks 在 hooks.json
export function resolveHarnessPaths(
  harness: HarnessId,
  options: { targetDir?: string; homeDir?: string } = {},
): HarnessPaths {
  const userHome = path.resolve(options.homeDir ?? os.homedir())
  const defaultSubdir: Record<HarnessId, string> = {
    'claude-code': '.claude',
    antigravity: path.join('.gemini', 'antigravity'),
    codex: '.codex',
    cursor: '.cursor',
  }
  const hasCustomDir = Boolean(options.targetDir)
  const targetDir = path.resolve(options.targetDir ?? path.join(userHome, defaultSubdir[harness]))

  let mcpConfigPath: string
  let mcpFormat: 'json' | 'toml' = 'json'
  if (harness === 'claude-code') {
    mcpConfigPath = hasCustomDir
      ? path.join(targetDir, '.mcp.json')
      : path.join(userHome, '.claude.json')
  } else if (harness === 'codex') {
    mcpConfigPath = path.join(targetDir, 'config.toml')
    mcpFormat = 'toml'
  } else if (harness === 'antigravity') {
    mcpConfigPath = path.join(targetDir, 'mcp_config.json')
  } else {
    mcpConfigPath = path.join(targetDir, 'mcp.json')
  }

  const hooksFilename = harness === 'claude-code' ? 'settings.json' : 'hooks.json'

  return {
    harness,
    targetDir,
    skillsDir: path.join(targetDir, 'skills'),
    mcpConfigPath,
    mcpFormat,
    hooksConfigPath: path.join(targetDir, hooksFilename),
    manifestPath: path.join(targetDir, 'akasha-plugin.json'),
  }
}

function readJsonObjectOrEmpty(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `配置文件 "${filePath}" 不是合法 JSON，为避免覆盖现有配置已中止安装：${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`配置文件 "${filePath}" 根节点必须为 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

function writeJsonFormatted(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function buildAkashaCommand(commandPrefix: string, subArgs: string): string {
  return `${commandPrefix} ${subArgs}`
}

// 幂等合并 Codex 原生 TOML 配置：仅新增或更新 [mcp_servers.akasha] 表，保留用户其它表与注释。
export function upsertCodexMcpToml(existingText: string): string {
  const block = [
    '[mcp_servers.akasha]',
    'command = "npx"',
    'args = ["-y", "akasha-artifacts", "mcp"]',
  ].join('\n')

  if (!existingText.trim()) {
    return `${block}\n`
  }

  const lines = existingText.replace(/\r\n/g, '\n').split('\n')
  const startIdx = lines.findIndex((line) => /^\s*\[mcp_servers\.akasha\]\s*(?:#.*)?$/.test(line))
  if (startIdx === -1) {
    const trimmedEnd = existingText.replace(/\r\n/g, '\n').trimEnd()
    return `${trimmedEnd}\n\n${block}\n`
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[i] ?? '')) {
      endIdx = i
      break
    }
  }

  const before = lines.slice(0, startIdx)
  const after = lines.slice(endIdx)
  const needsGapAfter = after.length > 0 && (after[0] ?? '').trim() !== ''
  const rebuilt = [...before, block, ...(needsGapAfter ? [''] : []), ...after]
  return `${rebuilt.join('\n').replace(/\n+$/, '')}\n`
}

function hasCodexAkashaMcpToml(content: string): boolean {
  const match = /^\s*\[mcp_servers\.akasha\]\s*(?:#.*)?$/m.exec(content)
  if (!match) return false
  const rest = content.slice(match.index + match[0].length)
  const nextSection = /^\s*\[[^\]]+\]\s*(?:#.*)?$/m.exec(rest)
  const sectionBody = nextSection ? rest.slice(0, nextSection.index) : rest
  return /^\s*command\s*=\s*"[^"]+"/m.test(sectionBody)
}

function mergeClaudeCodeHooks(
  existing: Record<string, unknown>,
  commandPrefix: string,
): Record<string, unknown> {
  const existingHooks =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? ({ ...(existing.hooks as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  const desired: Record<string, string> = {
    UserPromptSubmit: buildAkashaCommand(commandPrefix, 'hook prompt --harness claude-code'),
    PreToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PreToolUse'),
    PostToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PostToolUse'),
    SessionEnd: buildAkashaCommand(commandPrefix, 'hook activity --event SessionEnd'),
  }

  for (const [eventName, cmd] of Object.entries(desired)) {
    const currentList = Array.isArray(existingHooks[eventName])
      ? [...(existingHooks[eventName] as unknown[])]
      : []
    const alreadyRegistered = currentList.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const inner = (entry as { hooks?: unknown }).hooks
      if (!Array.isArray(inner)) return false
      return inner.some(
        (h) =>
          h &&
          typeof h === 'object' &&
          typeof (h as { command?: unknown }).command === 'string' &&
          ((h as { command: string }).command.includes('akasha-artifacts hook') ||
            (h as { command: string }).command === cmd),
      )
    })
    if (!alreadyRegistered) {
      currentList.push({
        matcher: '*',
        hooks: [{ type: 'command', command: cmd }],
      })
    }
    existingHooks[eventName] = currentList
  }

  return { ...existing, hooks: existingHooks }
}

// 遵循 Cursor 原生 hooks.json 契约（version: 1 + 嵌套 hooks 对象与命令数组），保留用户已有钩子。
function mergeCursorHooks(
  existing: Record<string, unknown>,
  commandPrefix: string,
): Record<string, unknown> {
  const existingHooks =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? ({ ...(existing.hooks as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  const desired: Record<string, string> = {
    beforeSubmitPrompt: buildAkashaCommand(commandPrefix, 'hook prompt --harness cursor'),
    preToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PreToolUse'),
    postToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PostToolUse'),
    sessionEnd: buildAkashaCommand(commandPrefix, 'hook activity --event SessionEnd'),
  }

  for (const [eventName, cmd] of Object.entries(desired)) {
    const currentList = Array.isArray(existingHooks[eventName])
      ? [...(existingHooks[eventName] as unknown[])]
      : []
    const alreadyRegistered = currentList.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { command?: unknown }).command === 'string' &&
        ((entry as { command: string }).command.includes('akasha-artifacts hook') ||
          (entry as { command: string }).command === cmd),
    )
    if (!alreadyRegistered) {
      currentList.push({ command: cmd })
    }
    existingHooks[eventName] = currentList
  }

  return {
    ...existing,
    version: typeof existing.version === 'number' ? existing.version : 1,
    hooks: existingHooks,
  }
}

function mergeSimpleHooks(
  existing: Record<string, unknown>,
  harness: HarnessId,
  commandPrefix: string,
): Record<string, unknown> {
  return {
    ...existing,
    PreInvocation: buildAkashaCommand(commandPrefix, `hook prompt --harness ${harness}`),
    PreToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PreToolUse'),
    PostToolUse: buildAkashaCommand(commandPrefix, 'hook activity --event PostToolUse'),
    SessionEnd: buildAkashaCommand(commandPrefix, 'hook activity --event SessionEnd'),
  }
}

export interface InstallHarnessOptions {
  harness: HarnessId
  targetDir?: string
  homeDir?: string
  commandPrefix?: string
}

export interface InstallHarnessResult {
  harness: HarnessId
  targetDir: string
  writtenFiles: string[]
  skillsInstalled: string[]
  mcpConfigPath: string
  hooksConfigPath: string
}

// 为指定 CLI Harness 幂等安装 Akasha 原生格式 MCP 配置、Hook 挂载与轻量化 Skills（绝不覆盖用户既有条目）。
export function installHarnessPlugin(options: InstallHarnessOptions): InstallHarnessResult {
  const paths = resolveHarnessPaths(options.harness, {
    targetDir: options.targetDir,
    homeDir: options.homeDir,
  })
  const commandPrefix = options.commandPrefix ?? 'npx -y akasha-artifacts'
  const writtenFiles: string[] = []
  const skillsInstalled: string[] = []

  fs.mkdirSync(paths.targetDir, { recursive: true })

  // 1. 写入轻量化 Skills 文档
  for (const skill of SKILLS_CATALOG) {
    const dest = path.join(paths.skillsDir, skill.filename)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, skill.content, 'utf8')
    writtenFiles.push(dest)
    skillsInstalled.push(skill.id)
  }

  // 2. 按各客户端原生路径与格式合并 MCP Server 配置（保留用户已有其它 MCP）
  if (paths.mcpFormat === 'toml') {
    const existingToml = fs.existsSync(paths.mcpConfigPath)
      ? fs.readFileSync(paths.mcpConfigPath, 'utf8')
      : ''
    fs.mkdirSync(path.dirname(paths.mcpConfigPath), { recursive: true })
    fs.writeFileSync(paths.mcpConfigPath, upsertCodexMcpToml(existingToml), 'utf8')
  } else {
    const mcpDoc = readJsonObjectOrEmpty(paths.mcpConfigPath)
    const existingServers =
      mcpDoc.mcpServers &&
      typeof mcpDoc.mcpServers === 'object' &&
      !Array.isArray(mcpDoc.mcpServers)
        ? { ...(mcpDoc.mcpServers as Record<string, unknown>) }
        : {}
    existingServers.akasha = {
      command: 'npx',
      args: ['-y', 'akasha-artifacts', 'mcp'],
    }
    writeJsonFormatted(paths.mcpConfigPath, { ...mcpDoc, mcpServers: existingServers })
  }
  writtenFiles.push(paths.mcpConfigPath)

  // 3. 按各客户端原生格式合并 Harness Hooks 配置（保持幂等）
  const hooksDoc = readJsonObjectOrEmpty(paths.hooksConfigPath)
  const mergedHooks =
    options.harness === 'claude-code'
      ? mergeClaudeCodeHooks(hooksDoc, commandPrefix)
      : options.harness === 'cursor'
        ? mergeCursorHooks(hooksDoc, commandPrefix)
        : mergeSimpleHooks(hooksDoc, options.harness, commandPrefix)
  writeJsonFormatted(paths.hooksConfigPath, mergedHooks)
  writtenFiles.push(paths.hooksConfigPath)

  // 4. 写入插件清单摘要供 akasha doctor 自检
  writeJsonFormatted(paths.manifestPath, {
    name: 'akasha',
    version: AKASHA_VERSION,
    harness: options.harness,
    skills: skillsInstalled,
    mcpConfig: paths.mcpConfigPath,
    hooksConfig: paths.hooksConfigPath,
  })
  writtenFiles.push(paths.manifestPath)

  return {
    harness: options.harness,
    targetDir: paths.targetDir,
    writtenFiles,
    skillsInstalled,
    mcpConfigPath: paths.mcpConfigPath,
    hooksConfigPath: paths.hooksConfigPath,
  }
}

export type DoctorCheckStatus = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  status: DoctorCheckStatus
  message: string
  details?: Record<string, unknown>
}

export interface DoctorReport {
  ok: boolean
  version: string
  checks: DoctorCheck[]
}

export interface DoctorOptions {
  akashaHome?: string
  homeDir?: string
  harness?: HarnessId
  targetDir?: string
  host?: string
  shellPorts?: readonly number[]
  sandboxPorts?: readonly number[]
  fetchImpl?: typeof fetch
}

function checkPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', () => resolve(false))
    srv.listen(port, host, () => {
      srv.close(() => resolve(true))
    })
  })
}

function checkBuiltAsset(relFromWorkspace: string): boolean {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../assets', path.basename(path.dirname(relFromWorkspace))),
    path.resolve(here, '../../../..', relFromWorkspace),
  ]
  return candidates.some((dir) => fs.existsSync(path.join(dir, 'index.html')))
}

function verifyHarnessHooksInstalled(harness: HarnessId, hooksPath: string): boolean {
  if (!fs.existsSync(hooksPath)) return false
  try {
    const doc = readJsonObjectOrEmpty(hooksPath)
    if (harness === 'claude-code') {
      const hooks = doc.hooks as Record<string, unknown> | undefined
      return Boolean(
        hooks && Array.isArray(hooks.UserPromptSubmit) && hooks.UserPromptSubmit.length > 0,
      )
    }
    if (harness === 'cursor') {
      const hooks = doc.hooks as Record<string, unknown> | undefined
      return Boolean(
        typeof doc.version === 'number' &&
          hooks &&
          Array.isArray(hooks.beforeSubmitPrompt) &&
          hooks.beforeSubmitPrompt.length > 0,
      )
    }
    return typeof doc.PreInvocation === 'string' && doc.PreInvocation.includes('akasha-artifacts')
  } catch {
    return false
  }
}

// 运行环境、安装完整性、Daemon 连通性与候选端口冲突自检。
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []
  const host = options.host ?? '127.0.0.1'
  const akashaHome = resolveAkashaHome(options.akashaHome)
  const fetchImpl = options.fetchImpl ?? fetch

  // 1. Node.js 版本检查
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  checks.push({
    id: 'node-version',
    status: major >= 24 ? 'ok' : 'error',
    message:
      major >= 24
        ? `Node.js v${process.versions.node} 满足 >= 24 要求`
        : `Node.js v${process.versions.node} 过低，需要 >= 24`,
  })

  // 2. Daemon 连通性与健康探测
  const probed = await probeDaemon(akashaHome, fetchImpl)
  if (probed) {
    let healthOk = false
    try {
      const hRes = await fetchImpl(`${probed.baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(1500),
      })
      healthOk = hRes.ok
    } catch {
      healthOk = false
    }
    checks.push({
      id: 'daemon',
      status: healthOk ? 'ok' : 'error',
      message: healthOk
        ? `Daemon 运行正常（pid=${probed.state.pid}，${probed.baseUrl}，sandbox=${probed.state.sandboxPort}）`
        : `Daemon 状态文件存在但 /api/v1/health 探测失败（${probed.baseUrl}）`,
      details: {
        pid: probed.state.pid,
        version: probed.state.version,
        port: probed.state.port,
        sandboxPort: probed.state.sandboxPort,
      },
    })
  } else {
    checks.push({
      id: 'daemon',
      status: 'warn',
      message: 'Local Daemon 当前未运行（首次调用 akasha mcp 或 akasha serve 时将自动拉起）',
    })
  }

  // 3. 候选端口冲突检查
  const shellPorts =
    options.shellPorts ?? parsePortList(process.env.AKASHA_PORTS, DEFAULT_SHELL_PORTS)
  const sandboxPorts =
    options.sandboxPorts ?? parsePortList(process.env.AKASHA_SANDBOX_PORTS, DEFAULT_SANDBOX_PORTS)

  if (probed) {
    checks.push({
      id: 'ports',
      status: 'ok',
      message: `Daemon 已绑定外壳端口 ${probed.state.port} 与沙盒端口 ${probed.state.sandboxPort}`,
    })
  } else {
    const freeShell: number[] = []
    for (const p of shellPorts) {
      if (await checkPortFree(p, host)) freeShell.push(p)
    }
    const freeSandbox: number[] = []
    for (const p of sandboxPorts) {
      if (await checkPortFree(p, host)) freeSandbox.push(p)
    }
    const portsOk = freeShell.length > 0 && freeSandbox.length > 0
    checks.push({
      id: 'ports',
      status: portsOk ? 'ok' : 'error',
      message: portsOk
        ? `候选端口可用（Shell: ${freeShell.join(', ')}；Sandbox: ${freeSandbox.join(', ')}）`
        : `检测到端口冲突：可用 Shell 端口 [${freeShell.join(', ')}]，可用 Sandbox 端口 [${freeSandbox.join(', ')}]`,
      details: { shellPorts, freeShell, sandboxPorts, freeSandbox },
    })
  }

  // 4. Web 外壳与沙盒构建产物检查
  const webBuilt = checkBuiltAsset('apps/web/dist')
  const sandboxBuilt = checkBuiltAsset('apps/sandbox/dist')
  checks.push({
    id: 'assets',
    status: webBuilt && sandboxBuilt ? 'ok' : 'warn',
    message:
      webBuilt && sandboxBuilt
        ? 'Web 外壳与独立沙盒静态构建产物就绪'
        : `缺少部分静态构建产物（web=${webBuilt ? 'ok' : 'missing'}, sandbox=${sandboxBuilt ? 'ok' : 'missing'}），请运行 make build`,
  })

  // 5. Harness 插件、原生 MCP 与 Hooks 安装完整性检查
  if (options.harness) {
    const paths = resolveHarnessPaths(options.harness, {
      targetDir: options.targetDir,
      homeDir: options.homeDir,
    })
    const missing: string[] = []
    for (const skill of SKILLS_CATALOG) {
      if (!fs.existsSync(path.join(paths.skillsDir, skill.filename))) {
        missing.push(`skills/${skill.filename}`)
      }
    }

    let mcpOk = false
    if (fs.existsSync(paths.mcpConfigPath)) {
      try {
        if (paths.mcpFormat === 'toml') {
          mcpOk = hasCodexAkashaMcpToml(fs.readFileSync(paths.mcpConfigPath, 'utf8'))
        } else {
          const doc = readJsonObjectOrEmpty(paths.mcpConfigPath)
          const servers = doc.mcpServers as Record<string, unknown> | undefined
          mcpOk = Boolean(servers && typeof servers === 'object' && 'akasha' in servers)
        }
      } catch {
        mcpOk = false
      }
    }
    if (!mcpOk) missing.push(path.basename(paths.mcpConfigPath))
    if (!verifyHarnessHooksInstalled(options.harness, paths.hooksConfigPath)) {
      missing.push(path.basename(paths.hooksConfigPath))
    }

    checks.push({
      id: `harness:${options.harness}`,
      status: missing.length === 0 ? 'ok' : 'error',
      message:
        missing.length === 0
          ? `${options.harness} 插件、MCP 与 Skills 安装完整（${paths.targetDir}）`
          : `${options.harness} 安装不完整，缺少或配置异常：${missing.join(', ')}`,
      details: {
        targetDir: paths.targetDir,
        mcpConfigPath: paths.mcpConfigPath,
        hooksConfigPath: paths.hooksConfigPath,
        missing,
      },
    })
  }

  return {
    ok: checks.every((c) => c.status !== 'error'),
    version: AKASHA_VERSION,
    checks,
  }
}
