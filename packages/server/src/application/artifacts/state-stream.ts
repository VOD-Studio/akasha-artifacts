import type { JsonPatchOp, PublicId, StateStreamSnapshot } from '@akasha/protocol'
import { DomainError } from '../../domain/errors.js'
import type { Clock, RealtimePublisher, StateRepository } from '../../domain/ports.js'
import { applyJsonPatch, replayStateStream } from '../../domain/state/index.js'
import { KeyedAsyncLock } from '../keyed-lock.js'
import type { ArtifactReference, ResolveArtifact } from './queries.js'

interface StateStreamPorts {
  states: StateRepository
  clock: Clock
  realtime: RealtimePublisher
}

export interface PushStateInput extends ArtifactReference {
  ops: readonly JsonPatchOp[]
}

export interface StateQuery extends ArtifactReference {
  seq?: number
}

/** 补丁和快照共享按制品串行的状态锁，独立于源码版本的写锁。 */
export class ArtifactStateStream {
  private readonly stateLocks = new KeyedAsyncLock()

  constructor(
    private readonly deps: StateStreamPorts,
    private readonly resolveArtifact: ResolveArtifact,
  ) {}

  async pushState(input: PushStateInput): Promise<StateStreamSnapshot> {
    if (input.ops.length === 0) {
      throw new DomainError('BAD_REQUEST', '状态补丁 ops 不能为空')
    }
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    return this.stateLocks.run(artifact.publicId, async () => {
      const now = this.deps.clock.now()
      const current = (await this.deps.states.getSnapshot(artifact.publicId)) ?? {
        artifactId: artifact.publicId,
        seq: 0,
        snapshot: {},
        updatedAt: now,
      }
      const nextData = applyJsonPatch(current.snapshot, input.ops)
      const nextSeq = current.seq + 1
      const nextSnapshot: StateStreamSnapshot = {
        artifactId: artifact.publicId,
        seq: nextSeq,
        snapshot: nextData,
        updatedAt: now,
      }
      await this.deps.states.appendPatch(artifact.publicId, {
        seq: nextSeq,
        ops: structuredClone(input.ops) as JsonPatchOp[],
        createdAt: now,
      })
      await this.deps.states.saveSnapshot(nextSnapshot)
      await this.deps.realtime.publish(
        {
          type: 'state.patched',
          artifactId: artifact.publicId,
          stateSeq: nextSeq,
          ops: structuredClone(input.ops) as JsonPatchOp[],
        },
        { projectId: artifact.projectId },
      )
      return nextSnapshot
    })
  }

  async getStateAt(
    input: StateQuery,
  ): Promise<{ artifactId: PublicId; seq: number; snapshot: Record<string, unknown> }> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const patches = await this.deps.states.getPatches(artifact.publicId)
    const replayed = replayStateStream(patches, input.seq)
    return { artifactId: artifact.publicId, ...replayed }
  }
}
