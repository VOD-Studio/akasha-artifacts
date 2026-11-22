#!/usr/bin/env node
import { createMemoryContainer } from '@akasha/server'

export function formatCliBanner(): string {
  return 'Akasha Terminal — Open-Source Live Web Artifacts for CLI Agents (v0.1.0)'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const container = createMemoryContainer()
  void container
  console.log(formatCliBanner())
}
