import { useCallback, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'

type Capabilities = { playable?: boolean; animated?: boolean }

type Observation = {
  artifactId: string
  version: number
  source: string | null
  boards: ReadonlyMap<string, Capabilities>
}

/** 显式声明优先；仅在当前制品、版本和编辑快照里复用旧稿的实际能力。 */
export function useBoardCapabilities(artifactId: string, version: number, source: string | null) {
  const [observation, setObservation] = useState<Observation>()
  const observed =
    observation?.artifactId === artifactId &&
    observation.version === version &&
    observation.source === source
      ? observation.boards
      : undefined
  const onObserve = useCallback(
    (id: string, renderedVersion: number, report: Capabilities) => {
      if (version !== renderedVersion) return
      setObservation((previous) => {
        const boards =
          previous?.artifactId === artifactId &&
          previous.version === version &&
          previous.source === source
            ? previous.boards
            : undefined
        const old = boards?.get(id)
        const animated = report.animated ?? old?.animated
        const playable = report.playable ?? old?.playable
        if (
          Boolean(playable) === Boolean(old?.playable) &&
          Boolean(animated) === Boolean(old?.animated)
        ) {
          return previous
        }
        const next = new Map(boards)
        if (playable || animated) next.set(id, { animated, playable })
        else next.delete(id)
        return { artifactId, version, source, boards: next }
      })
    },
    [artifactId, version, source],
  )
  const canPlay = useCallback(
    (board: CanvasBoard) => {
      if (board.type !== 'html' && board.type !== 'react') return false
      return board.presentation?.interactive ?? Boolean(observed?.get(board.id)?.playable)
    },
    [observed],
  )
  const canAnimate = useCallback(
    (board: CanvasBoard) =>
      board.presentation?.animation ?? Boolean(observed?.get(board.id)?.animated),
    [observed],
  )
  return { canPlay, canAnimate, onObserve }
}
