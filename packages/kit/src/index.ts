import { registerKitTemplate } from './registry.js'
import { ARTBOARD_TEMPLATE } from './templates/artboard.js'
import { DATA_STORY_TEMPLATE } from './templates/data-story.js'
import { DOCUMENT_TEMPLATE } from './templates/document.js'
import { LIVE_TIMELINE_TEMPLATE } from './templates/live-timeline.js'
import { OPTION_COMPARE_TEMPLATE } from './templates/option-compare.js'
import { PR_WALKTHROUGH_TEMPLATE } from './templates/pr-walkthrough.js'
import { VERIFY_TEMPLATE } from './templates/verify.js'

export const PACKAGE_KIT_VERSION = '0.3.0'

let builtinsRegistered = false

/** 向注册中心登记全部内置模板；重复调用无效果。 */
export function registerBuiltinKitTemplates(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  registerKitTemplate(LIVE_TIMELINE_TEMPLATE)
  registerKitTemplate(OPTION_COMPARE_TEMPLATE)
  registerKitTemplate(ARTBOARD_TEMPLATE)
  registerKitTemplate(DOCUMENT_TEMPLATE)
  registerKitTemplate(VERIFY_TEMPLATE)
  registerKitTemplate(PR_WALKTHROUGH_TEMPLATE)
  registerKitTemplate(DATA_STORY_TEMPLATE)
}

// 导入本包即注册内置模板，渲染器与校验门禁不需要再手动调用
registerBuiltinKitTemplates()

export { composeCatalogBoard } from './catalog-board.js'
export {
  designSystemPreviewSource,
  generateDesignSystemBoard,
  parseDesignSystem,
} from './design-system.js'
export {
  buildPropsJsonSchema,
  getKitTemplate,
  type KitParseResult,
  type KitPropControlType,
  type KitPropField,
  type KitPropOption,
  type KitTemplateDefinition,
  listKitTemplates,
  registerKitTemplate,
  resolveEffectiveProps,
} from './registry.js'
export {
  ARTBOARD_PROP_FIELDS,
  ARTBOARD_TEMPLATE,
} from './templates/artboard.js'
export {
  DATA_STORY_TEMPLATE,
  type DataStoryData,
  type StoryChart,
  type StoryRow,
  type StoryTable,
} from './templates/data-story.js'
export {
  DOCUMENT_PROP_FIELDS,
  DOCUMENT_TEMPLATE,
  type DocumentData,
  type DocumentParagraph,
  type DocumentQuestion,
  type DocumentSection,
  type HtmlDocumentData,
  parseDocument,
  type StructuredDocumentData,
} from './templates/document.js'
export {
  applyLiveTimelineState,
  LIVE_TIMELINE_PROP_FIELDS,
  LIVE_TIMELINE_TEMPLATE,
  type LiveTimelineData,
  type LiveTimelineStep,
  parseLiveTimeline,
  type TimelineStepStatus,
} from './templates/live-timeline.js'
export {
  type CompareDimension,
  type CompareOption,
  OPTION_COMPARE_PROP_FIELDS,
  OPTION_COMPARE_TEMPLATE,
  type OptionCompareData,
  parseOptionCompare,
} from './templates/option-compare.js'
export {
  PR_WALKTHROUGH_TEMPLATE,
  type PrWalkthroughData,
  type WalkthroughDiffMode,
  type WalkthroughFile,
  type WalkthroughLine,
} from './templates/pr-walkthrough.js'
export {
  applyVerifyState,
  parseVerify,
  VERIFY_PROP_FIELDS,
  VERIFY_TEMPLATE,
  type VerifyClaim,
  type VerifyClaimStatus,
  type VerifyData,
  type VerifyScreenComparison,
  type VerifyUnverifiedItem,
} from './templates/verify.js'
