import { ARTBOARD_GEOMETRY_LIMITS } from '@akasha/protocol'
import { Input } from '@akasha/ui/input'
import { useId } from 'react'
import type { CanvasBounds } from './canvas-camera'

const titles = { x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' } as const
const keys = ['x', 'y', 'width', 'height'] as const

/** 只有实际坐标或视口变化才能提交编辑。 */
export function sameGeometry(a: CanvasBounds, b: CanvasBounds) {
  return keys.every((field) => a[field] === b[field])
}

/** 四个值都以固有 CSS 像素计；空输入保持待填，不会被转为零。 */
export function CanvasGeometryFields({
  value,
  onChange,
}: {
  value: CanvasBounds
  onChange: (bounds: CanvasBounds) => void
}) {
  const prefix = useId()
  const { coordinate, viewport } = ARTBOARD_GEOMETRY_LIMITS
  return (
    <div className="grid grid-cols-2 gap-2">
      {keys.map((field) => {
        const position = field === 'x' || field === 'y'
        const id = `${prefix}-${field}`
        return (
          <div key={field} className="space-y-1 text-xs text-ink-muted">
            <label htmlFor={id}>{titles[field]}</label>
            <Input
              id={id}
              type="number"
              controlSize="sm"
              required
              value={Number.isNaN(value[field]) ? '' : value[field]}
              min={position ? -coordinate : 1}
              max={position ? coordinate : viewport}
              step={position ? 'any' : 1}
              onChange={(event) => onChange({ ...value, [field]: event.target.valueAsNumber })}
            />
          </div>
        )
      })}
    </div>
  )
}
