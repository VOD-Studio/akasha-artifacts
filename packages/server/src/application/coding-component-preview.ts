const renderPrefix =
  "\nexport default function WorkspacePreview() { return React.createElement(React.Fragment, null, result.css && React.createElement('style', null, result.css), React.createElement(result.component, "
const renderSuffix = ')); }\n'

/** 入口模块与渲染调用固定，只有最后一个 JSON 对象是作者可独立修改的示例属性。 */
export function renderCodingComponent(
  module: string,
  props: Record<string, string | number | boolean>,
): string {
  return `import * as React from 'react';\nconst result = ${module};${renderPrefix}${JSON.stringify(props)}${renderSuffix}`
}

/** 仅对已存储工程入口的基线调用。不能证明实现一致时，宁可只交接整稿。 */
export function retainsCodingComponent(base: string, source: string): boolean {
  if (base === source) return true
  const render = base.lastIndexOf(renderPrefix)
  if (render < 0 || !base.endsWith(renderSuffix) || !source.endsWith(renderSuffix)) return false
  const props = render + renderPrefix.length
  if (!source.startsWith(base.slice(0, props))) return false
  try {
    const value: unknown = JSON.parse(source.slice(props, -renderSuffix.length))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}
