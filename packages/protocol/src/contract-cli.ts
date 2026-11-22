#!/usr/bin/env node
import { runContractTests } from './contract.js'

function parseArgs(argv: string[]): { baseUrl?: string; token?: string } {
  let baseUrl: string | undefined
  let token: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base-url') {
      baseUrl = argv[++i]
    } else if (arg?.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length)
    } else if (arg === '--token') {
      token = argv[++i]
    } else if (arg?.startsWith('--token=')) {
      token = arg.slice('--token='.length)
    }
  }
  return { baseUrl, token }
}

const { baseUrl, token } = parseArgs(process.argv.slice(2))
if (!baseUrl) {
  console.error('用法：test:contract --base-url <http://host:port> [--token <token>]')
  process.exit(2)
}

const report = await runContractTests({ baseUrl, token })
for (const c of report.cases) {
  console.log(`${c.passed ? '✓' : '✗'} ${c.name}${c.error ? ` — ${c.error}` : ''}`)
}
if (!report.passed) {
  process.exit(1)
}
