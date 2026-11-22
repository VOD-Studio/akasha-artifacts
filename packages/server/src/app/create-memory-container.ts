import { ArtifactService } from '../application/artifact-service.js'
import type { Clock, IdGenerator } from '../domain/ports.js'
import {
  CryptoIdGenerator,
  InMemoryArtifactRepository,
  InMemoryFeedbackRepository,
  InMemoryProjectRepository,
  InMemoryRealtimeBus,
  InMemoryReceiptRepository,
  InMemoryRoundRepository,
  InMemoryStateRepository,
  SystemClock,
} from '../infrastructure/storage/memory/index.js'

export interface MemoryContainerOptions {
  clock?: Clock
  ids?: IdGenerator
}

// 手工装配内存容器：用于单元测试与无持久化场景，不引入 DI 框架。
export function createMemoryContainer(options: MemoryContainerOptions = {}) {
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new CryptoIdGenerator()
  const projects = new InMemoryProjectRepository()
  const artifacts = new InMemoryArtifactRepository()
  const states = new InMemoryStateRepository()
  const rounds = new InMemoryRoundRepository()
  const feedbacks = new InMemoryFeedbackRepository()
  const receipts = new InMemoryReceiptRepository()
  const realtime = new InMemoryRealtimeBus(clock)

  const service = new ArtifactService({
    projects,
    artifacts,
    states,
    rounds,
    feedbacks,
    receipts,
    realtime,
    clock,
    ids,
  })

  return {
    service,
    realtime,
    repositories: { projects, artifacts, states, rounds, feedbacks, receipts },
  }
}
