import type { ArtboardAppearance, ArtboardTweakValues } from '@akasha/protocol'
import type { CSSProperties } from 'react'

/** 样式只用于当前画板的内容根节点，不修改 document 或其他画板。 */
export function artboardStyle(
  appearance?: ArtboardAppearance,
  tweaks?: ArtboardTweakValues,
): CSSProperties | undefined {
  if (!appearance && !tweaks) return undefined
  const style: CSSProperties & Record<`--akasha-tweak-${string}`, string> = {
    backgroundColor: appearance?.background,
    borderRadius: appearance?.cornerRadius,
    overflow: appearance?.cornerRadius ? 'clip' : undefined,
  }
  if (tweaks) {
    for (const [id, value] of Object.entries(tweaks)) {
      style[`--akasha-tweak-${id}`] = String(typeof value === 'boolean' ? Number(value) : value)
    }
  }
  return style
}
