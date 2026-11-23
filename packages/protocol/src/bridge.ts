import { z } from 'zod'
import { DesignLayersSchema } from './artboard-layers.js'
import { EditOpSchema, ElementRectSchema, ElementRefSchema, JsonPatchOpSchema } from './domain.js'
import { ArtifactTypeSchema, PROTOCOL_VERSION } from './primitives.js'
import { ArtifactStorageOperationSchema } from './storage.js'

const LayerIdSchema = z.string().min(1).max(1024)
const CanvasLayerSchema = z.object({
  // 同一沙盒的 DOM 节点标识；重排时不会指向占据旧位置的其他节点
  id: LayerIdSchema,
  parentId: LayerIdSchema.optional(),
  selector: z.string().min(1).max(1024),
  tag: z.string().min(1).max(80),
  label: z.string().max(120).optional(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  // 仅由实际的原生图层渲染器发出；不是作者 HTML 中的选择器
  designId: z.string().min(1).max(96).optional(),
  // 作者为本节点声明、在同一画板内唯一的 data-ak-block；不会回退到祖先。
  blockId: z.string().min(1).max(512).optional(),
  // 仅确定静态节点时给出，行列相对该画板的源码片段
  sourceLoc: z
    .string()
    .regex(/^\d{1,8}:\d{1,8}$/)
    .optional(),
})

/** 检查器可见的渲染节点。几何量以固有画板视口 CSS 像素计。 */
export type CanvasLayer = z.infer<typeof CanvasLayerSchema>

/**
 * 外壳与沙盒热更新时共享的视图与控件保态快照。
 *
 * @remarks 沙盒经 `viewState.snapshot` 上报，外壳在下次 `render` 时原样带回。
 */
export const PreservedViewStateSchema = z.object({
  // 当前查看的页签或子页标识
  activePage: z.string().optional(),
  // 沙盒内的滚动偏移，单位 CSS 像素
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  // 缩放倍率
  zoom: z.number().positive().optional(),
  // 以保态键为索引的控件值
  controls: z.record(z.string(), z.unknown()).optional(),
})
export type PreservedViewState = z.infer<typeof PreservedViewStateSchema>

// Bridge 消息信封：`v` 为协议版本；`nonce` 是外壳为每个沙盒 iframe 会话生成的随机串
const BridgeEnvelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  nonce: z.string().min(1),
}

/** 外壳 → 沙盒的 Bridge 消息。 */
export const ShellToSandboxMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('render'),
    artifactType: ArtifactTypeSchema,
    // HTML 画板的 id；给出时整段源码作为一个画板块渲染
    boardId: z.string().min(1).optional(),
    // 仅显式试玩启用原型导航；缺省仍是设计视图
    playback: z.literal(true).optional(),
    version: z.number().int().min(1),
    source: z.string(),
    designLayers: DesignLayersSchema.optional(),
    // 完整的初始状态快照
    state: z.record(z.string(), z.unknown()),
    // 上一次沙盒上报的保态快照
    preservedState: PreservedViewStateSchema.optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 增量状态补丁；只更新数据，不重新渲染
    type: z.literal('state'),
    seq: z.number().int().min(1),
    ops: z.array(JsonPatchOpSchema).min(1),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.start'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.stop'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('highlight'),
    // null 表示清除高亮
    element: ElementRefSchema.nullable(),
    // 用户显式从树或批注定位时，允许沙盒把目标滚入视口
    reveal: z.literal(true).optional(),
    layer: z.object({ id: LayerIdSchema, version: z.number().int().min(1) }).optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('pins.track'),
    pins: z.array(
      z.object({
        id: z.string().min(1),
        element: ElementRefSchema,
      }),
    ),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 让沙盒乐观预览一次直改；`source` 是预览后的完整源码
    type: z.literal('apply.preview'),
    op: EditOpSchema,
    version: z.number().int().positive(),
    source: z.string(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 预览取消后让沙盒回到指定版本
    type: z.literal('apply.rollback'),
    version: z.number().int().positive(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 开关可视化直改的点击选取
    type: z.literal('visual.inspect'),
    active: z.boolean(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 对 `storage.request` 的应答；`ok` 为 false 时 `error` 说明原因
    type: z.literal('storage.response'),
    requestId: z.string().min(1),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('capture.png'),
    version: z.number().int().min(1),
    // 保持固有 CSS 视口；scale 只决定输出位图大小
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    scale: z.number().positive().max(1),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.layers.watch'),
    // 关闭检查器或换板即停止；只订阅本帧
    active: z.boolean(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 双击命中测试；坐标是沙盒视口 CSS 像素，不派发原型的点击事件。
    type: z.literal('inspect.text.at'),
    requestId: z.string().min(1).max(64),
    version: z.number().int().positive(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
  }),
])
export type ShellToSandboxMessage = z.infer<typeof ShellToSandboxMessageSchema>

/** 沙盒 → 外壳的 Bridge 消息。 */
export const SandboxToShellMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEnvelopeBase,
    // 沙盒加载完成后发出的第一条消息；此前外壳下发的指令会被缓存
    type: z.literal('ready'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 一次渲染完成；`height` 是内容高度，供外壳自适应
    type: z.literal('rendered'),
    version: z.number().int().min(1),
    height: z.number().nonnegative().optional(),
    // 该版本的沙盒内容包含至少一个可操作控件
    playable: z.boolean().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('prototype.navigate'),
    version: z.number().int().min(1),
    // 源码里的目标画板 id；外壳按当前画板的流程边验证
    target: z.string().min(1).max(1024),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('prototype.exit'),
    version: z.number().int().min(1),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('prototype.availability'),
    version: z.number().int().min(1),
    // 当前渲染 DOM 的可用控件变化；不代表整份源码重绘
    playable: z.boolean(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('capture.png.result'),
    version: z.number().int().min(1),
    // 通过结构化克隆发送 Blob，不把 PNG 放进 JSON 或源码
    png: z
      .instanceof(Blob)
      .refine(
        (blob) => blob.type === 'image/png' && blob.size > 0 && blob.size <= 32 * 1024 * 1024,
      ),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('capture.png.failure'),
    version: z.number().int().min(1),
    message: z.string().min(1),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 编译或运行错误
    type: z.literal('error'),
    phase: z.enum(['compile', 'runtime']),
    message: z.string().min(1),
    stack: z.string().optional(),
    loc: z.string().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('resize'),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 保态快照有变化时上报
    type: z.literal('viewState.snapshot'),
    state: PreservedViewStateSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 指认模式下的悬停；`element` 为 null 表示没有悬停目标
    type: z.literal('inspect.hover'),
    element: ElementRefSchema.nullable(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.select'),
    element: ElementRefSchema,
    // 区分用户真实点击选中（click）与滚动/缩放/高亮触发的几何坐标同步（sync）
    reason: z.enum(['click', 'sync']).optional(),
    layerId: LayerIdSchema.optional(),
    // 图层定位和坐标同步使用精确选择器，不回退到祖先的块标识
    layerSelector: z.string().min(1).max(1024).optional(),
    // 点击节点自身经唯一性检查的声明块；祖先块只属于普通批注定位。
    layerBlockId: z.string().min(1).max(512).optional(),
    version: z.number().int().min(1).optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.layers.snapshot'),
    version: z.number().int().min(1),
    layers: z.array(CanvasLayerSchema).max(240),
    truncated: z.boolean(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 被跟踪图钉的当前矩形，键为图钉 id；元素不可见时为 null
    type: z.literal('pins.rects'),
    rects: z.record(z.string(), ElementRectSchema.nullable()),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('storage.request'),
    requestId: z.string().min(1).max(64),
    operation: ArtifactStorageOperationSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 模板内部发起的批注请求
    type: z.literal('annotation.request'),
    version: z.number().int().positive(),
    element: ElementRefSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    // 直改模式下选中的元素；`loc` 只在该元素有唯一的静态位置时给出
    type: z.literal('visual.select'),
    version: z.number().int().positive(),
    element: ElementRefSchema,
    loc: z.string().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.text.target'),
    requestId: z.string().min(1).max(64),
    version: z.number().int().positive(),
    // 未命中元素时为空；有元素但不能安全改写时只提供批注定位。
    element: ElementRefSchema.nullable(),
    // 仅为命中节点自身唯一的静态源码位置，不沿祖先查找。
    loc: z
      .string()
      .regex(/^\d{1,8}:\d{1,8}$/)
      .optional(),
  }),
])
export type SandboxToShellMessage = z.infer<typeof SandboxToShellMessageSchema>
