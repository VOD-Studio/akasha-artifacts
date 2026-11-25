import {
  type DesignLayer,
  type DesignLayerFontWeight,
  resolveDesignLayerColors,
} from '@akasha/protocol'
import { type CSSProperties, useId } from 'react'
import type { CanvasBoard } from '@/entities/artifact'

const FONT_WEIGHTS: Record<DesignLayerFontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

interface OverflowProps {
  board: CanvasBoard
  layers?: readonly DesignLayer[]
  scale: number
  interactive: boolean
  onSelectLayer?: (boardId: string, layerId: string) => void
}

function crossesBoardEdge(layer: DesignLayer, width: number, height: number): boolean {
  return (
    layer.x < 0 || layer.y < 0 || layer.x + layer.width > width || layer.y + layer.height > height
  )
}

/**
 * 渲染跨越画板边界的原生图层外部溢出部分，画板内部仍由隔离沙盒绘制。
 *
 * @remarks 仅当图层几何超出 `[0, width] × [0, height]` 时挂载；不改变单板导出的视口裁剪契约。
 */
export function BoardOverflowLayers({
  board,
  layers,
  scale,
  interactive,
  onSelectLayer,
}: OverflowProps) {
  const maskId = useId()
  const overflowing = layers?.filter((layer) => crossesBoardEdge(layer, board.width, board.height))
  if (!overflowing?.length) return null

  let minX = 0
  let minY = 0
  let maxX = board.width
  let maxY = board.height
  for (const layer of overflowing) {
    minX = Math.min(minX, layer.x - 4)
    minY = Math.min(minY, layer.y - 4)
    maxX = Math.max(maxX, layer.x + layer.width + 4)
    maxY = Math.max(maxY, layer.y + layer.height + 4)
  }
  const spanWidth = Math.max(1, maxX - minX)
  const spanHeight = Math.max(1, maxY - minY)
  const boardBackground = board.appearance?.background ?? '#ffffff'

  return (
    <div
      data-testid={`board-overflow-layers-${board.id}`}
      className="pointer-events-none absolute top-0 left-0 z-1"
      style={{
        width: board.width,
        height: board.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      <svg
        aria-hidden="true"
        viewBox={`${minX} ${minY} ${spanWidth} ${spanHeight}`}
        style={{
          position: 'absolute',
          left: minX,
          top: minY,
          width: spanWidth,
          height: spanHeight,
          overflow: 'visible',
        }}
        className="pointer-events-none block"
      >
        <defs>
          <mask id={maskId}>
            <rect x={minX} y={minY} width={spanWidth} height={spanHeight} fill="white" />
            <rect x={0} y={0} width={board.width} height={board.height} fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          {overflowing.map((layer) => {
            const { foreground, surface } = resolveDesignLayerColors(layer, boardBackground)
            const cx = layer.x + layer.width / 2
            const cy = layer.y + layer.height / 2
            const transform =
              layer.flipX || layer.flipY
                ? `translate(${cx} ${cy}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
                : undefined
            const hitProps =
              interactive && onSelectLayer
                ? {
                    className: 'pointer-events-auto cursor-pointer',
                    onClick: (event: React.MouseEvent) => {
                      event.stopPropagation()
                      onSelectLayer(board.id, layer.id)
                    },
                  }
                : undefined
            if (layer.kind === 'ellipse') {
              return (
                <ellipse
                  key={layer.id}
                  data-overflow-layer={layer.id}
                  cx={cx}
                  cy={cy}
                  rx={layer.width / 2}
                  ry={layer.height / 2}
                  fill={surface ?? foreground}
                  transform={transform}
                  {...hitProps}
                />
              )
            }
            if (layer.kind === 'rectangle') {
              return (
                <rect
                  key={layer.id}
                  data-overflow-layer={layer.id}
                  x={layer.x}
                  y={layer.y}
                  width={layer.width}
                  height={layer.height}
                  fill={surface ?? foreground}
                  transform={transform}
                  {...hitProps}
                />
              )
            }
            if (layer.kind === 'stroke') {
              const points = layer.points
                .map(([ux, uy]) => `${layer.x + ux * layer.width},${layer.y + uy * layer.height}`)
                .join(' ')
              return (
                <polyline
                  key={layer.id}
                  data-overflow-layer={layer.id}
                  points={points}
                  fill="none"
                  stroke={foreground}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  transform={transform}
                  {...hitProps}
                />
              )
            }
            const textStyle: CSSProperties = {
              width: '100%',
              height: '100%',
              color: foreground,
              backgroundColor: surface,
              borderRadius: layer.kind === 'note' ? 4 : undefined,
              padding: layer.kind === 'note' ? 10 : undefined,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              overflow: 'hidden',
              fontFamily: 'system-ui, sans-serif',
              fontSize: layer.fontSize ?? 16,
              fontWeight: FONT_WEIGHTS[layer.fontWeight ?? 'normal'],
              textAlign: layer.textAlign ?? 'left',
              lineHeight: 1.4,
            }
            return (
              <foreignObject
                key={layer.id}
                data-overflow-layer={layer.id}
                x={layer.x}
                y={layer.y}
                width={layer.width}
                height={layer.height}
                transform={transform}
                {...hitProps}
              >
                <div style={textStyle}>{layer.text}</div>
              </foreignObject>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
