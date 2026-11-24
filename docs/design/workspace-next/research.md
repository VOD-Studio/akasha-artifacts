# 截至 2026-11-24：Claude Design 的公开证据与未证实项

**对象是从 Artifacts 新建的 Design，不是旧式聊天制品、独立站或 Motion 模板。** 本次复核使用 OMP 原生 `zhipu-coding-plan/glm-5.4`；已核对最终响应的 `provider=zhipu-coding-plan`、`model=glm-5.4` 和 `stopReason=stop`。模型发起 44 次读取、16 次检索；这些是调用次数，不是那么多份独立有效证据。首轮检索到时限后，用同一 OMP 会话与同一模型收束已有材料。规划作者另行比对了官方配图、第三方录屏的实际帧、目标右栏截图和 Akasha 主线；没有把任何私有作品交给研究模型。本报告不冒称对当前账号的整套界面已逐项操作过；检索日不等于功能发布日期。

**不采纳模型结论中的一项排他性说法**：集成版官方手册点名 Properties，不等于原生「只有 Properties」，也不能证明 Code 与 Tweaks 只属于独立版。用户提供的目标界面明确出现这三个同级入口。对照下列实物可区分控件和所属版本；对未展开的页签不猜读写行为。

## 什么是「最新」

- [9 月 16 日发布记录](https://support.claude.com/en/articles/12138966-release-notes#:~:text=Create%20designs%2C%20decks%2C%20and%20docs%20in%20any%20conversation)：Design 进入对话、Claude Code 和 Artifacts，不再把独立站首页当参考入口。
- [10 月 8 日公告](https://claude.com/resources/articles/dashboards-and-motion)：`Docs, Slides, and Design are out of beta`，Motion 则是另外的模板。以这条有明确日期的公告和现行帮助为准，不把早期文章里的 beta 套回今天。
- 本次查到的[帮助中心更新记录](https://support.claude.com/en/articles/12138966-release-notes)最近一栏标为 **11 月 20 日**，内容是移动端外观和 Computer use，不是检查器升级。未查到 11 月重新定义 Design 右栏页签的公告，不等于所有账号绝无灰度差异。[现行指南](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)仍将 12 月 14 日列为独立站关闭日。

## 独立找到的实拍：哪些属于新版，哪些不是

| 来源与界面 | 实际能复核什么 | 适用边界 |
| --- | --- | --- |
| **集成版**：[11 月 11 日第三方逐步实操](https://sfaiconsultants.com/guides/how-to-use-claude-design)，[完成设计时的原图](https://sfaiconsultants.com/guides/how-to-use-claude-design/images/W10-design-05b.webp)。 | 已逐图查看：左为对话，右为真实画布；标题旁有分享与评论；工作区顶栏有选择、抓手、文字等工具和播放、缩放；单板标题旁另有调节、放大和下载图标。 | **这张图没有展开右侧检查器**。可以据它验证整体布局，不能从图标猜出 Code 的读写权限，也不把发布日视为构建号。 |
| **同场景另一组控件**：[11 月分享／导出展开原图](https://sfaiconsultants.com/guides/how-to-use-claude-design/images/W10-design-07b.webp)。 | 确认有 **Share / Export** 切换、复制分享链接、邀请、HTML 独立网页、打印／分享用 PDF、PNG、更多格式与应用。 | 这是交付弹层的标签，不是设计检查器的第四或第五栏；某个账户能邀请谁仍由实际权限决定。 |
| **另一套 Edit 界面，不作为新版右栏**：[作者的 Code 实拍](https://www.aiuxdesign.guide/images/guides/claude-design-learning-path/lesson-5/edit-mode.webp)与[操作说明](https://www.aiuxdesign.guide/guides/claude-design-learning-path/inline-comments-and-direct-edits)。 | 左边确实是 **Simple / Pro / Code / Tweaks**。选中 Heading 时 Code 展示 `font-size: 52px`、`font-weight: 800`、颜色与尺寸，框下写着一行一条声明，`@name` 编辑属性；上方有 Save / Discard。它不是仓库文件树。 | 作者页面 4 月首发、10 月更新；不能把「10 月更新」当成录到新 UI 的日期。这排四项不等于右侧 Properties / Code / Tweaks 有第四项。 |
| **同一套非目标 UI 的真实调参流程**：[40.5 秒录屏](https://www.aiuxdesign.guide/images/guides/claude-design-learning-path/lesson-6/tweaks-add.mp4)，[作者说明](https://www.aiuxdesign.guide/guides/claude-design-learning-path/tweaks-explore-variations-without-chat)。 | 已从公开视频取帧：**00:01** Tweaks 显示作品尚无可调控件，并提供 `Describe a tweak…` 和 `Ideas`；**00:26** 画布上方出现 `headline / detail / badges`；**00:39** 成品标题已变，侧边列出三个参数各自控制什么。说明页另述改选项会原地刷新。 | 这是作品专属控件，不是所有作品固定三项。不能推出新版控制条在同一侧、点击后持久化方式相同，或预览参数默认进入导出包。 |
| **官方设计师自己的工作样例**：[Nate Parrott 的原文与录屏入口](https://claude.com/resources/articles/how-the-product-designer-who-built-claude-design-uses-it-to-explore-ideas-before-building-them)。 | 本人描述用[地铁示例](https://www.youtube.com/watch?v=bR8FyicJynE)调动画物理效果，用[配色示例](https://www.youtube.com/watch?v=4_mkm1-4F6c)调滑块和预设；这是设计作品的具体能力，不只是营销词。 | 文章 7 月发布；这里据作者原文，不冒称对两个 YouTube 视频逐帧验证。其「重做编辑器」样例作者明确写了不会照稿上线，不能拿来作生产版截图。 |

## 授权现行网页版走查：画布与操作栏

以下由规划作者在 **2026-11-24 用户正在使用的 Chrome 标签页**实查。没有采用旧版截图推断这些结果。实际打开页面菜单、Play 菜单、导出、批注和会话；在该标签页的浏览器无障碍树中另读了两页的板头、当前面板和键盘提示。未改作品、未发送消息、未签发分享，也没把私有链接、截图或设计源码放进仓库。以下是该份作品的样本，不是所有模板的硬编码配置。

| 操作范围 | 实机所见 | 不能混为一谈的行为 |
| --- | --- | --- |
| 页面及作品 | 页面选择器列出两页，分别 **19 和 8 张**；每行有页面操作，底部有 New page。作品查看页可进 Chat with Claude；到了对话里的工作区才看到 Pages、Play、Properties、Export 一组操作。 | 打开作品链接与带对话的编辑工作区是两个场景。页和板不是一一对应。 |
| 画布工具栏 | `Canvas tools` 依次是 Select `V`、Hand `H`（也可按住空格）、Text `T`、Artboard `A`、Note `N`、Pencil `P`、Shapes `R`、Comment `⌥C`。`R` 切换上次使用的形状，批注按钮可带数量。 | Artboard 与 Shapes 是两个工具。`Zoom` 是独立工具栏：`⌘0` 或 `⇧1` 适合全图，`⇧2` 适合选区，`⌘+` / `⌘−` 分档缩放。这些是控件真实声明的快捷键，未声称逐一绘制和撤销。 |
| 画板标题 | 19 板页：19 个全窗打开、19 个单板导出、6 个板级 Tweaks。8 板页：7 个全窗打开、1 个 `Play prototype`、8 个单板导出、1 个板级 Tweaks。板上 Return 进入，Tab 遍历层，Esc 回板头。 | 全窗看一板不是试玩。标题上出现哪些动作取决于板的能力，不应因作品中有个播放图标就给所有板加试玩。 |
| 播放与动效 | 实际打开顶栏 Play，19 板页出现 `Static artboards` 分组，十九个目标均列出。另在没有启动单板试玩的三次总览快照中，一块动效板的同一内部节点横坐标从 580 到 160 再回到 580，大小不变。 | **静态板可以进全局 Play 选择器；有动效不等于已进试玩。** 这组样本不是帧率或音轨实测，不证明所有板自动播，也没有验证自动翻页。 |
| 检查器 | 当前右栏 `Panel view` 确有三个同级标签：Properties、Code、Tweaks；Layers 列表和侧栏有各自的拖动分隔条。没选对象时显示 Nothing selected。切到另一页时，真实打开的 Tweaks 内是主题开关、颜色按钮和 `1x / 0.5x / 0.25x` 单选，而非固定宽高表单。 | 只能说这个选区有这组参数。Code 页签已实见；没有写入或保存源码，不能宣称它有整稿编辑能力。 |
| 评审和交付 | `More comment options → Show all comments` 打开真实线程列表，有本页／全页、显示已解决、解决和线程菜单。导出弹层列 HTML、PDF、PNG；More formats 另列 ZIP。未获分享资格时，分享项禁用，导出仍可用且会说明原因。 | 评论、会话、分享、导出均不是检查器子标签；能看到导出项不等于实际导出了私有设计。 |

## 按行为区分证据

| 问题 | 能确认 | 不能从中推出 |
| --- | --- | --- |
| 有几个检查器页签？ | 目标右栏原屏同级有 **Properties、Code、Tweaks**。层级列表在 Properties 内；[键盘指南](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)称其为该面板的 list of layers。 | 未证实目标右栏还有第四项；已有独立证据表明另一套左侧 Edit 面板曾有四项，不可混用。顶栏、会话、批注、浮动工具栏、聚焦和试玩都不算同级页签。 |
| Properties 有哪些值？ | 原屏选中整张画板：390 × 844 px，Flow / Fixed 选 Fixed，Letter / A4 在该帧灰显，背景 #FFFFFF、Radius 0、Layout guide `+`。[官方教程](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#4-refine-on-the-artboards)明确 `Properties shows the settings for the element you selected`；帮助另证字体、文字取色及对比度反馈。[查看者](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#5-review-it-with-your-team)可以检查尺寸、间距、颜色，但不能修改。 | `…` 的菜单内容、Flow 的分页算法、辅助线的具体类型、图层和整板有同一套字段，均不能从这张图断言。 |
| Code 能直接编辑吗？ | 目标右栏存在 Code，公开旧 Edit 实录另证曾可调选中元素的 CSS。集成版[官方教程](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#5-review-it-with-your-team)确认可导出单板 HTML ZIP 和整份 HTML，[工程交接](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#6-continue-in-claude-code)是另一操作。 | 尚未找到同一新版右侧 Code 的公开展开／写入实录。不能断言它只读、可改整篇 HTML／JS、或提供文件树。[通用帮助](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)中的查看／复制控件特指 Legacy artifacts。 |
| Tweaks 可以调什么？ | [现行产品页](https://claude.com/product/design)说明为作品制作间距和配色控件；[独立版官方原图](https://assets.claude.com/27d189475a69c8d847540d09821db517a2f7c66d.jpg?w=1450&q=85&fm=webp&fit=max)有弧线宽度、脉冲速度与城市显隐；[首发说明](https://www.anthropic.com/news/claude-design-anthropic-labs)把即时调整和要求 Claude 推广至全稿分为两步。 | 独立录屏与官方原图都表明 **Design 有 Tweaks，不是 Motion 独有**。当前右栏按层、板还是作品绑定，是否写回源码、刷新和导出后保留哪些值，仍未查到通用规则。 |
| 画板会动是不是已进入试玩？ | 用户的总览示例明确标注「画板内自动循环播放」；[官方教程](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#if-something-looks-off)把 Play 放在可点击的单板上；[Motion](https://support.claude.com/en/articles/17454997-get-started-with-claude-motion)是可导出 MP4 的另一制品模板。 | 不能推出每板自动有 Play、同时播音频、画布自动翻页、任意 iframe 安全常驻，或 Claude 使用某种视域算法。 |
| 从哪进、怎么分享？ | [新建设计](https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux#1-start-a-design)始于库或对话；[Design 指南](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)列出截图、文件、代码库等参考上下文；[设计系统](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design)可被复用；[分享说明](https://support.claude.com/en/articles/9547008-share-artifacts)区分查看、批注、编辑，默认私有。 | 这些不是本机 Akasha 已有邮箱邀请、组织设计系统或共享光标的证据。账号套餐、管理员开关、内部调度不作为本期产品需求。 |

截图仅作事实参照，不存入公开仓库。实施次序、权限选择、打印语义和性能预算见[实施规划](README.md)，均为 Akasha 的决定，不是推测 Claude 内部架构。
