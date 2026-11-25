import { HtmlRenderer } from './formats/html'
import { MarkdownRenderer } from './formats/markdown'
import { MermaidRenderer } from './formats/mermaid'
import { ReactRenderer } from './formats/react'
import { SvgRenderer } from './formats/svg'
import { registerRenderer } from './registry'
import { ArtboardRenderer } from './templates/artboard'
import { DataStoryRenderer } from './templates/data-story'
import { DocumentRenderer } from './templates/document'
import { LiveTimelineRenderer } from './templates/live-timeline'
import { OptionCompareRenderer } from './templates/option-compare'
import { PrWalkthroughRenderer } from './templates/pr-walkthrough'
import { VerifyRenderer } from './templates/verify'

let builtinsRegistered = false

/**
 * 注册 html、markdown、mermaid、svg、react 五类内置渲染器，以及全部 Kit 模板渲染器。
 *
 * @remarks 重复调用无效果。
 */
export function registerBuiltinRenderers(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  registerRenderer('html', (props) => <HtmlRenderer {...props} />)
  registerRenderer('markdown', (props) => <MarkdownRenderer {...props} />)
  registerRenderer('mermaid', (props) => <MermaidRenderer {...props} />)
  registerRenderer('svg', (props) => <SvgRenderer {...props} />)
  registerRenderer('react', (props) => <ReactRenderer {...props} />)
  // M3 @akasha/kit 工程与高阶决策模板渲染器
  registerRenderer('document', (props) => <DocumentRenderer {...props} />)
  registerRenderer('artboard', (props) => <ArtboardRenderer {...props} />)
  registerRenderer('verify', (props) => <VerifyRenderer {...props} />)
  registerRenderer('live-timeline', (props) => <LiveTimelineRenderer {...props} />)
  registerRenderer('option-compare', (props) => <OptionCompareRenderer {...props} />)
  registerRenderer('pr-walkthrough', (props) => <PrWalkthroughRenderer {...props} />)
  registerRenderer('data-story', (props) => <DataStoryRenderer {...props} />)
}
