import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { devDaemonPort, devSandboxPort, devWorkbenchPort } from './dev-endpoints.ts'

if (
  !Number.isInteger(devDaemonPort) ||
  devDaemonPort < 1 ||
  devDaemonPort > 65535 ||
  devDaemonPort === devWorkbenchPort ||
  devDaemonPort === devSandboxPort
) {
  console.error('AKASHA_DEV_DAEMON_PORT 必须是与 Vite 不同的有效端口')
  process.exit(2)
}

const entry = new URL('./dev-daemon-entry.mjs', import.meta.url)
const config = fileURLToPath(new URL('../packages/akasha/tsconfig.build.json', import.meta.url))
const sessionToken = randomBytes(24).toString('hex')
let daemon
let closing = false
let reloading = false
let pending = false

const reportWatchStatus = ts.createWatchStatusReporter(ts.sys, false)
// Solution Builder 只传结束诊断，不传 WatchStatusReporter 的可选 errorCount。
const buildSucceeded = ts.createCompilerDiagnostic(
  ts.Diagnostics.Found_0_errors_Watching_for_file_changes,
  0,
)
const host = ts.createSolutionBuilderWithWatchHost(
  ts.sys,
  undefined,
  ts.createDiagnosticReporter(ts.sys, Boolean(process.stdout.isTTY)),
  undefined,
  (diagnostic, newLine, options) => {
    reportWatchStatus(diagnostic, newLine, options)
    if (
      diagnostic.code === buildSucceeded.code &&
      diagnostic.messageText === buildSucceeded.messageText
    ) {
      void reload().catch(fail)
    }
  },
)
const builder = ts.createSolutionBuilderWithWatch(host, [config], {
  noEmitOnError: true,
  preserveWatchOutput: true,
  stopBuildOnErrors: true,
})

async function stopDaemon() {
  const child = daemon
  if (!child) return
  daemon = undefined
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}

function startDaemon() {
  const child = fork(entry, { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  daemon = child
  child.on('error', (error) => {
    if (daemon !== child) return
    daemon = undefined
    fail(error)
  })
  child.once('exit', (code, signal) => {
    if (daemon !== child) return
    daemon = undefined
    fail(new Error(`开发 Daemon 已退出（${signal ?? code}）`))
  })
  child.send(sessionToken)
}

async function reload() {
  pending = true
  if (reloading) return
  reloading = true
  try {
    while (pending && !closing) {
      await stopDaemon()
      // 等旧进程退出期间可能有新产物；一次启动直接使用最新的一轮构建。
      pending = false
      if (!closing) startDaemon()
    }
  } finally {
    reloading = false
  }
}

async function shutdown() {
  if (closing) return
  closing = true
  builder.close()
  await stopDaemon()
}

function fail(error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
  void shutdown()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
builder.build()
