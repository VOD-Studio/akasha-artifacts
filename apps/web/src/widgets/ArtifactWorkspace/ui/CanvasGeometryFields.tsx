import { ARTBOARD_GEOMETRY_LIMITS } from '@akasha/protocol'
import type { CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import { InspectorNumberInput } from './inspector-controls'

const titles = { x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' } as const
const prefixes = { x: 'X', y: 'Y', width: 'W', height: 'H' } as const
const keys = ['x', 'y', 'width', 'height'] as const

/** 只有实际坐标或视口变化才能提交编辑。 */
export function sameGeometry(a: CanvasBounds, b: CanvasBounds) {
  return keys.every((field) => a[field] === b[field])
}

interface GeometryFieldsProps {
  /** 固有 CSS 像素坐标；NaN 表示该字段清空或输入未完成。 */
  value: CanvasBounds
  /** 只更新本地表单；调用方须等显式提交再保存整组值。 */
  onChange: (bounds: CanvasBounds) => void
}

/** 四个值都以固有 CSS 像素计；空输入保持待填，不会被转为零。 */
export function CanvasGeometryFields({ value, onChange }: GeometryFieldsProps) {
  const { t } = useMessages(canvasToolsMessages)
  const { coordinate, viewport } = ARTBOARD_GEOMETRY_LIMITS
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {keys.map((field) => {
        const position = field === 'x' || field === 'y'
        return (
          <InspectorNumberInput
            key={field}
            prefix={prefixes[field]}
            label={t(titles[field])}
            required
            value={value[field]}
            min={position ? -coordinate : 1}
            max={position ? coordinate : viewport}
            step={position ? 'any' : 1}
            onChange={(event) => onChange({ ...value, [field]: event.target.valueAsNumber })}
          />
        )
      })}
    </div>
  )
}
