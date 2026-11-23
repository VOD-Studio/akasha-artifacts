import { DESIGN_LAYER_BLOCK_PREFIX, type DesignLayer } from '@akasha/protocol'
import type { CSSProperties } from 'react'
import { bindDesignLayer } from '../inspector/layers'

const palette = {
  ink: { foreground: '#202733', surface: '#dce2eb' },
  blue: { foreground: '#174f8f', surface: '#cfe6ff' },
  rose: { foreground: '#a02a45', surface: '#ffd7df' },
  amber: { foreground: '#71400f', surface: '#fff1b3' },
  mint: { foreground: '#146356', surface: '#cef6e8' },
} satisfies Record<NonNullable<DesignLayer['color']>, { foreground: string; surface: string }>

const names: Record<DesignLayer['kind'], string> = {
  text: '文本',
  note: '便签',
  rectangle: '矩形',
  ellipse: '椭圆',
  stroke: '画笔标记',
}

function layerStyle(layer: DesignLayer, interactive: boolean): CSSProperties {
  const swatch = palette[layer.color ?? (layer.kind === 'note' ? 'amber' : 'ink')]
  const text = layer.kind === 'text' || layer.kind === 'note'
  return {
    position: 'absolute',
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    pointerEvents: interactive ? 'auto' : 'none',
    color: swatch.foreground,
    backgroundColor: layer.kind === 'stroke' || layer.kind === 'text' ? undefined : swatch.surface,
    borderRadius: layer.kind === 'ellipse' ? '50%' : layer.kind === 'note' ? 4 : undefined,
    padding: layer.kind === 'note' ? 10 : undefined,
    whiteSpace: text ? 'pre-wrap' : undefined,
    overflowWrap: text ? 'anywhere' : undefined,
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 16,
    lineHeight: 1.4,
  }
}

interface SceneProps {
  /** 从底到顶渲染；坐标相对裁剪容器，而不是作者内容的滚动区域。 */
  layers: readonly DesignLayer[]
  /** 关闭后不截取点击、不登记沙盒内的定位标识；用于试玩或整板总览。 */
  interactive: boolean
}

/** 原生设计数据与作者 HTML 为独立同级树，不改变已有 HTML 批注或源码的结构路径。 */
export function DesignLayerScene({ layers, interactive }: SceneProps) {
  return (
    <aside
      data-ak-renderer="design"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      aria-label="设计图层"
    >
      {layers.map((layer) => (
        <div
          key={layer.id}
          data-ak-block={interactive ? `${DESIGN_LAYER_BLOCK_PREFIX}${layer.id}` : undefined}
          ref={
            interactive
              ? (element) => {
                  if (element) bindDesignLayer(element, layer.id)
                }
              : undefined
          }
          title={
            layer.kind === 'text' || layer.kind === 'note'
              ? layer.text.trim().slice(0, 120) || names[layer.kind]
              : names[layer.kind]
          }
          style={layerStyle(layer, interactive)}
        >
          {layer.kind === 'text' || layer.kind === 'note' ? layer.text : null}
          {layer.kind === 'stroke' ? (
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none block size-full"
            >
              <polyline
                points={layer.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </div>
      ))}
    </aside>
  )
}
