import { createLocalContainer } from '../src/app/create-local-container.js'
import type { AgentRunnerLaunch } from '../src/domain/agent-runner.js'

/** HTTP、授权和版本存储均走本机容器；只替代模型进程以控制回执时序。 */
export function sessionFixture() {
  const launch: { request: AgentRunnerLaunch; reply: (text: string) => void }[] = []
  const container = createLocalContainer({
    dbPath: 'memory',
    agentRunner: {
      check: async () => undefined,
      run: (request) =>
        new Promise<string>((reply) => {
          request.onThread(request.threadId ?? '29f7e3f3-cfe3-497e-a080-ee5fd08780ec')
          launch.push({ request, reply })
        }),
    },
  })
  const cli = { Authorization: `Bearer ${container.token}` }
  const browser = { Cookie: `akasha_session=${container.token}`, Origin: 'http://127.0.0.1:24321' }
  const request = (path: string, method: string, headers: Record<string, string>, body?: unknown) =>
    container.app.request(`http://127.0.0.1:24321/api/v1${path}`, {
      method,
      headers: { Host: '127.0.0.1:24321', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { container, launch, cli, browser, request }
}
