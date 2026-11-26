import { parseDesignSystem } from '@akasha/kit'
import { useMemo } from 'react'
import { ReactRenderer } from '../formats/react'
import type { RendererProps } from '../registry'
import { ParseErrorCard } from './parse-error'

/** 只执行固定快照的构建输出，不在沙盒中解释来源目录或重新构建。 */
export function DesignSystemRenderer(props: RendererProps) {
  const result = useMemo(() => parseDesignSystem(props.source), [props.source])
  if (!result.ok) return <ParseErrorCard typeLabel="Design System" error={result.error} />
  return <ReactRenderer {...props} source={result.data.previewSource} />
}
