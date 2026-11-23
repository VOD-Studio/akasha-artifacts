import { registerBuiltinKitTemplates } from './templates.js'

export const PACKAGE_KIT_VERSION = '0.3.0'

registerBuiltinKitTemplates()

export {
  DATA_STORY_TEMPLATE,
  type DataStoryData,
  type StoryChart,
  type StoryRow,
  type StoryTable,
} from './data-story.js'
export {
  PR_WALKTHROUGH_TEMPLATE,
  type PrWalkthroughData,
  type WalkthroughDiffMode,
  type WalkthroughFile,
  type WalkthroughLine,
} from './pr-walkthrough.js'

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
  type ArtboardBoard,
  type ArtboardData,
  type ArtboardFlow,
  type ArtboardPage,
  applyLiveTimelineState,
  applyVerifyState,
  type CompareDimension,
  type CompareOption,
  DOCUMENT_PROP_FIELDS,
  DOCUMENT_TEMPLATE,
  type DocumentData,
  type DocumentParagraph,
  type DocumentQuestion,
  type DocumentSection,
  type HtmlDocumentData,
  LIVE_TIMELINE_PROP_FIELDS,
  LIVE_TIMELINE_TEMPLATE,
  type LiveTimelineData,
  type LiveTimelineStep,
  OPTION_COMPARE_PROP_FIELDS,
  OPTION_COMPARE_TEMPLATE,
  type OptionCompareData,
  parseArtboard,
  parseDocument,
  parseLiveTimeline,
  parseOptionCompare,
  parseVerify,
  registerBuiltinKitTemplates,
  type StructuredDocumentData,
  type TimelineStepStatus,
  VERIFY_PROP_FIELDS,
  VERIFY_TEMPLATE,
  type VerifyClaim,
  type VerifyClaimStatus,
  type VerifyData,
  type VerifyScreenComparison,
  type VerifyUnverifiedItem,
} from './templates.js'
