import { useMemo } from 'react'
import type { CanvasBounds, CanvasDocument } from '@/entities/artifact'
import type { Camera } from '../lib/canvas-camera'

interface CanvasFlowLinesProps {
  document: CanvasDocument
  bounds: ReadonlyMap<string, CanvasBounds>
  moved?: ReadonlyMap<string, CanvasBounds>
  camera: Camera
}

/** 跨板连线随拖动预览移动；隐藏重复连线、自环和不在本页的端点。 */
export function CanvasFlowLines({ document, bounds, moved, camera }: CanvasFlowLinesProps) {
  const flows = useMemo(() => {
    if (!document.showFlows) return []
    const unique = new Map<string, CanvasDocument['flows'][number]>()
    for (const flow of document.flows) {
      if (flow.from === flow.to || !bounds.has(flow.from) || !bounds.has(flow.to)) {
        continue
      }
      unique.set(JSON.stringify([flow.from, flow.to, flow.label]), flow)
    }
    return Array.from(unique)
  }, [document.flows, document.showFlows, bounds])
  if (!flows.length) return null
  const boundsFor = (id: string) => moved?.get(id) ?? bounds.get(id)
  return (
    <svg
      aria-hidden="true"
      className="artifact-canvas-flows"
      data-hand-drawn={document.handDrawnFlows}
    >
      {flows.map(([key, { from, to, label }]) => {
        const start = boundsFor(from)
        const end = boundsFor(to)
        if (!start || !end) return null
        const sameRow = start.y === end.y
        const forward = sameRow ? start.x < end.x : start.y < end.y
        const x1 =
          camera.x + (start.x + start.width * (sameRow ? Number(forward) : 0.5)) * camera.scale
        const x2 =
          camera.x + (end.x + end.width * (sameRow ? Number(!forward) : 0.5)) * camera.scale
        const y1 =
          camera.y + (start.y + start.height * (sameRow ? 0.5 : Number(forward))) * camera.scale
        const y2 =
          camera.y + (end.y + end.height * (sameRow ? 0.5 : Number(!forward))) * camera.scale
        return (
          <g key={key}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            {label ? (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}>
                {label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
