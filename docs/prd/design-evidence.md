# 版本基线：哪些属于 Design，哪些属于后续产品

取证日 **2026-11-24**。比较对象是 Artifacts 内的 **Design**。用 OMP 原生 `zhipu-coding-plan/glm-5.4` 复核了六个公开的官方页面；作者另外对照官方教程、权限说明、Figma Learn 和[授权新版实机记录](https://github.com/VOD-Studio/akasha-artifacts/blob/0f4113b9c28a4f439cdf8358ce0249c20ec87812/docs/design/workspace-next/research.md)。GLM 只收到公开链接。模型归纳不是证据：例如它称“Data 全计划”，现行帮助明确不是 Free；同时编辑的依据是学院实操和帮助的已知限制，而不是工具栏的一张图。

| 证据 | 对范围有影响的事实 | 不能据此声称 |
| --- | --- | --- |
| [Design 帮助](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) · [产品页](https://claude.com/product/design) | 对话、库、CLI 都能开始；移动端可创作／查看／编辑，分享设置在网页或桌面改。支持截图、图片、文件、代码库、设计资料，支持直接编辑、布局、键盘和可访问的选区浮栏；面板关闭才出现选区浮栏。 | “保存当前方向再探索”不是完整历史面板；帮助把缺少版本历史列为限制。Akasha 的不可变版本是要保留的自身能力。 |
| [官方实作课程](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux) · [现行设计系统帮助](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design) · [建立系统的实作](https://academy.claude.com/tutorials/create-a-design-system-with-claude) | 设计系统本身可审阅、编辑和共享；可从 Figma 等授权参考、品牌文件或代码／真实组件生成；重新同步保留使用说明。团队默认、个人覆盖和选择多个系统，与发布前按规范检查均在 Design 范围。 | 导入 Figma 参考不等于能无损写回 `.fig`；使用真实组件不等于已具备 Figma 的主组件／实例编辑器。 |
| [授权实机](https://github.com/VOD-Studio/akasha-artifacts/blob/0f4113b9c28a4f439cdf8358ce0249c20ec87812/docs/design/workspace-next/research.md#授权现行网页版走查画布与操作栏) · [选中文字后的记录](https://github.com/VOD-Studio/akasha-artifacts/issues/103#issuecomment-7123514532) | 同一作品两页 19／8 板。19 板页有 19 个全窗、6 个板级 Tweaks；8 板页是 7 个全窗、1 个试玩。顶栏 Play 列静态板；总览中同一节点横向往返。八工具与缩放分列。右栏是 Properties／Code／Tweaks，文字层有字重、字号、宽高、定位；另一选区给主题／颜色／速度。 | 没有对用户作品写入。Code 保存粒度、Tweaks 刷新／导出语义、整页自动定时翻板均未获实证。Flow／Fixed、纸型、辅助线的入口可见，不等于掌握内部算法。 |
| [同一官方课程的团队走查](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#5-review-it-with-your-team) · [分享](https://support.claude.com/en/articles/9547008-share-artifacts) · [现行管理员指南](https://support.claude.com/en/articles/16994751-artifacts-admin-guide-for-team-and-enterprise-plans) | 邀请、三种角色、组织／组、外部链接及其策略；编辑者可同时编辑并看到对方更改，另有在场状态。帮助同时说明多人编辑仍较基础，可能不可靠。 | 未授权样本不能完成分享不代表产品没有分享；“对方在线”也不等于编辑会收敛。 |
| [现行 Design 帮助：交付](https://support.claude.com/en/articles/14604416-get-started-with-claude-design#:~:text=Export%20and%20share) · [官方学院：工程交接](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#6-continue-in-claude-code) | 单板 PNG／PDF／HTML ZIP、整份 HTML／PDF；另有 ZIP、PPTX、Google Slides、下列目的地和本机／Web 编码 Agent。学院明确从同一对话可将设计转成 deck。 | 各导出不保证可逆、保留所有动画或全部元素可编辑；所有合作方的账户、API 和可导入载体尚未逐个实测。 |
| [首发说明（独立版）](https://www.anthropic.com/news/claude-design-anthropic-labs) | 作者调参和“请 Agent 应用到全稿”是两步；曾演示网页抓取、语音／视频／3D 等作品。 | 不能把独立版的网页抓取入口、媒体权限、自动演示乃至 Code 编辑形式不加核验地移植为新版事实；首版对照票负责核对。 |

### 设计交付目的地

下表按 **Akasha 工单的用户任务** 分组，不是宣称各服务有相同 API。来自[现行官方清单](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)与[产品页合作方说明](https://claude.com/product/design)。另列的 Google Slides 是真实演示稿交付，不计入这 15 个产品目的地。

| 要把设计交到哪里 | 目的地 | 合格的结果 |
| --- | --- | --- |
| 视觉协作 | Canva、Gamma、Hyperframes、Miro | 在所选账号／空间打开本次设计的目标内容，可继续编辑或制作。 |
| 品牌与营销 | Adobe Experience Manager、Adobe for Creativity、Adobe Journey Optimizer、HubSpot | 能打开对应素材或草稿；转交不等于发送活动或向公众发布。 |
| 应用搭建 | Base44、Lovable、Replit、v0、Wix | 目的工程或构建会话实际接收设计内容，可辨认所选版本，不是产品首页。 |
| 部署 | Netlify、Vercel | 指定项目拿到预览结果及其地址；生产发布须另行授权。 |

### 后续对标的一手资料

- [Artifacts 现行模板总表](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)：Design 以外还有 Docs、Slides、Data、Sheets、Whiteboards、Motion；后三者标为 beta。AI 调用、外部应用授权、个人／共享存储和文件是通用能力，不是新的 Design 检查器页签。
- [Sheets、Whiteboards、Data 发布说明](https://claude.com/resources/articles/sheets-whiteboards-data)：跨表公式、协作白板与可核对来源的动态数据分别是不同工作流。[Motion](https://support.claude.com/en/articles/17454997-get-started-with-claude-motion) 独立制作视频；不要为让 Design 的板在总览里动而要求建 Motion 项目。
- Figma Design：[Auto Layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout-in-Figma)、[组件变体](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)、[变量／集合／模式](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)、[矢量网络](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)、[布尔运算](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)、[原型流程](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma)、[Smart Animate](https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames)、[原型表达式](https://help.figma.com/hc/en-us/articles/15253194385943-Use-expressions-in-prototypes)、[Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode-in-Figma)。依据是能否响应内容、传播组件变更、搭建流程并交付工程，不是检查器看起来像不像 Figma。
