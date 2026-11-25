# Changelog

## [0.5.0](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.4.2...v0.5.0) (2026-11-25)


### 新增

* **core:** 按固定版本读取画板布局和正文 ([0efaae7](https://github.com/VOD-Studio/akasha-artifacts/commit/0efaae7f798189a892cadcfe64860d2de1a3a811))
* **export:** 保留固定画板的外观与默认参数 ([4b65559](https://github.com/VOD-Studio/akasha-artifacts/commit/4b65559a1b1a8e9a91e01745f7239d3f0d65f050))
* **protocol:** 允许定版画板请求双倍 PNG ([7801be6](https://github.com/VOD-Studio/akasha-artifacts/commit/7801be697bdb17b2f7a07e89c4941e781734a16a))
* **protocol:** 定义画板外观与预览参数 ([350d72d](https://github.com/VOD-Studio/akasha-artifacts/commit/350d72dcdf409e0b449bd48a9ddeb65fce4b3376))
* **protocol:** 拆分画板布局索引与正文 ([9e709a8](https://github.com/VOD-Studio/akasha-artifacts/commit/9e709a82f10243641bbd4cc4fcc33351b5b2bd38))
* **renderer:** 调度画板预览的动画与快照 ([e5b1dc5](https://github.com/VOD-Studio/akasha-artifacts/commit/e5b1dc538b9d1794f13c9762dd3096bd1a961b53))
* **sandbox:** 仅在试玩中手动播放内嵌媒体 ([004d96b](https://github.com/VOD-Studio/akasha-artifacts/commit/004d96b7fd63a48a299e9529f3cf7f285d6bd02a)), closes [#106](https://github.com/VOD-Studio/akasha-artifacts/issues/106)
* **sandbox:** 独立渲染单板外观和参数 ([24aeeb2](https://github.com/VOD-Studio/akasha-artifacts/commit/24aeeb2fc2ca91a87c770a586d76930d3f8938ee))
* **sandbox:** 读取选中图层的样式来源 ([9dd29ae](https://github.com/VOD-Studio/akasha-artifacts/commit/9dd29ae2538fda353ae4a82a6c27062efff55e76))
* **web:** 区分画板展开与交互播放 ([c7b3b89](https://github.com/VOD-Studio/akasha-artifacts/commit/c7b3b89583af4b9c928c91b67a88926fbb12bddf)), closes [#106](https://github.com/VOD-Studio/akasha-artifacts/issues/106)
* **web:** 合并画板动效与原型播放 ([33029da](https://github.com/VOD-Studio/akasha-artifacts/commit/33029dab226494b3a419a11f580e9aece050c2de))
* **web:** 合并画板检查器与参数预览 ([cc25d24](https://github.com/VOD-Studio/akasha-artifacts/commit/cc25d242f5a9e2c495cd94056f77eccec76e3405))
* **web:** 在图层检查器区分本层与继承样式 ([#141](https://github.com/VOD-Studio/akasha-artifacts/issues/141)) ([dea6822](https://github.com/VOD-Studio/akasha-artifacts/commit/dea682268cabf7dec7d223cb3f6127526af8fe03))
* **web:** 在图层源码面板区分本层与继承声明 ([27e83ba](https://github.com/VOD-Studio/akasha-artifacts/commit/27e83ba658b355aa8b60b1f66cd6870e02f04377))
* **web:** 按选区检查画板并预览参数 ([a0febe7](https://github.com/VOD-Studio/akasha-artifacts/commit/a0febe761e2549d44d993223ffaf12ed4c2b72fd)), closes [#103](https://github.com/VOD-Studio/akasha-artifacts/issues/103)
* **web:** 支持画板选区 PDF 和双倍 PNG 导出 ([dd9229c](https://github.com/VOD-Studio/akasha-artifacts/commit/dd9229cb1d6744b47b7b9e94d09595310d91d6bb))
* **web:** 支持画板选区 PDF 和双倍 PNG 导出 ([e120c13](https://github.com/VOD-Studio/akasha-artifacts/commit/e120c1308c87b55750d8f917e41a35dec2245fb7))


### 修复

* **canvas:** 保留历史画板标识和旧批注归属 ([2b59508](https://github.com/VOD-Studio/akasha-artifacts/commit/2b59508df38ca77c1aaf0ae623f6ce85ba7542c5))
* **canvas:** 基准正文读取失败时保留布局输入 ([2e242ca](https://github.com/VOD-Studio/akasha-artifacts/commit/2e242ca5858f56953a94781bc3ababa5a1fe7898))
* **canvas:** 检查器和画布共用定版画板资源 ([6f62af0](https://github.com/VOD-Studio/akasha-artifacts/commit/6f62af06f2b2a110953da2b82d3c8cb317823cca))
* **sandbox:** 保留原生弹出层的旧稿试玩入口 ([f25f84e](https://github.com/VOD-Studio/akasha-artifacts/commit/f25f84e09eabcbc43ea81d10f6e744129c075aab)), closes [#106](https://github.com/VOD-Studio/akasha-artifacts/issues/106)
* **sandbox:** 在实际绘制前响应预览取消 ([a79d5b3](https://github.com/VOD-Studio/akasha-artifacts/commit/a79d5b31f264a95cf38bbc96b16f65b4a67fc801))
* **ui:** 关闭抽屉时立即停用交互 ([c3484c0](https://github.com/VOD-Studio/akasha-artifacts/commit/c3484c0b9dfafc45c37617af9687a93508f5bc50))
* **web:** 保留删除页面后的键盘焦点 ([19f7661](https://github.com/VOD-Studio/akasha-artifacts/commit/19f7661391c9956e24e0bab7c87479ab85e1fa39))
* **web:** 切版读取完成前不暴露旧版编辑器 ([44e5d67](https://github.com/VOD-Studio/akasha-artifacts/commit/44e5d670fd7b54b64c3e761833c1324937bd51ce))
* **web:** 区分页面导航与画板选区 ([7715756](https://github.com/VOD-Studio/akasha-artifacts/commit/7715756df70327fa8db2939f15dac9712036e906))
* **web:** 区分页面导航与画板选区 ([#143](https://github.com/VOD-Studio/akasha-artifacts/issues/143)) ([169686d](https://github.com/VOD-Studio/akasha-artifacts/commit/169686d0750c719a703093f3a529fe5ec47c81fe))
* **web:** 将绘制和批注归回对应的画布工具 ([b13d739](https://github.com/VOD-Studio/akasha-artifacts/commit/b13d739fe0d4c56b641d71015e1261937ae3c0e6))
* **web:** 按打开导出面板时的画布排列生成 PDF ([5077743](https://github.com/VOD-Studio/akasha-artifacts/commit/5077743660ca330e920ca900993e6bee93a41829))
* **web:** 用选择工具直接定位画板图层 ([2107512](https://github.com/VOD-Studio/akasha-artifacts/commit/21075121857ef56f76810fa7d9200b68843d6837))
* **web:** 统一作品工作台的交互与实现 ([#134](https://github.com/VOD-Studio/akasha-artifacts/issues/134)) ([22c74f1](https://github.com/VOD-Studio/akasha-artifacts/commit/22c74f12285b3c278676561fbba74ae4a72bb701)), closes [#133](https://github.com/VOD-Studio/akasha-artifacts/issues/133)
* **web:** 统一品牌徽标与加载动效 ([c684180](https://github.com/VOD-Studio/akasha-artifacts/commit/c684180326f2787621780423d516f60de1b8828c))
* **web:** 让普通滚动平移画布 ([522cde9](https://github.com/VOD-Studio/akasha-artifacts/commit/522cde929796e750c0d081fffb09bf2e1fcbf089))


### 性能优化

* **canvas:** 平移时不重复遍历关闭的导航 ([f229624](https://github.com/VOD-Studio/akasha-artifacts/commit/f2296247ed5c817a080b04fdaf9fbf194937d8fe))
* **web:** 合并多画板视域加载 ([ce735d2](https://github.com/VOD-Studio/akasha-artifacts/commit/ce735d2fa90db0b3981f720444f2a68808d88be2))
* **web:** 按视域规划画板预览预算 ([5395ee6](https://github.com/VOD-Studio/akasha-artifacts/commit/5395ee63f1055c6978dddc1342268dedb9c1a771))
* **web:** 让工作区优先加载可见画板 ([564f88b](https://github.com/VOD-Studio/akasha-artifacts/commit/564f88b32f8d7fc33f62705b4d2b0eda77614562))
* **web:** 限制画板请求与预览缓存 ([7bee1cc](https://github.com/VOD-Studio/akasha-artifacts/commit/7bee1cc8e279384e84607f8a4e3eeb3453aa7c43))


### 重构

* **web:** 移除已无消费方的完整详情缓存 ([68687a7](https://github.com/VOD-Studio/akasha-artifacts/commit/68687a7f5a6e468e4b721129dea5e9b10df2dd42))

## [0.4.2](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.4.1...v0.4.2) (2026-11-24)


### 修复

* **dev:** 修复本地开发环境的热更新 ([fa2d51e](https://github.com/VOD-Studio/akasha-artifacts/commit/fa2d51e9e5e56ab9f81234550a34239d3d0a7c62))

## [0.4.1](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.4.0...v0.4.1) (2026-11-23)


### 新增

* **canvas:** 在画板就地编辑文字和便签 ([d44fb90](https://github.com/VOD-Studio/akasha-artifacts/commit/d44fb90f65e3373cfde208cdbefa74ba357299d0)), closes [#59](https://github.com/VOD-Studio/akasha-artifacts/issues/59)
* **canvas:** 在画板绘制图形与笔迹 ([50a2d77](https://github.com/VOD-Studio/akasha-artifacts/commit/50a2d77b1d8cfd9597133c30a55dc51216b1c08e)), closes [#59](https://github.com/VOD-Studio/akasha-artifacts/issues/59)
* **canvas:** 支持检查器编排原生图层 ([4fcc95e](https://github.com/VOD-Studio/akasha-artifacts/commit/4fcc95e0fc2e56e4e6b527ab112d8b149473758d)), closes [#58](https://github.com/VOD-Studio/akasha-artifacts/issues/58)
* **export:** 交付固定版的离线可试玩 HTML ([9f04d58](https://github.com/VOD-Studio/akasha-artifacts/commit/9f04d58f74eac27859130b8ec35368bb787911a0)), closes [#65](https://github.com/VOD-Studio/akasha-artifacts/issues/65)
* **export:** 导出固定版本的画板图像与 PDF ([e8fab25](https://github.com/VOD-Studio/akasha-artifacts/commit/e8fab255df5ac0f69b661b42fdb10c2770da5465)), closes [#64](https://github.com/VOD-Studio/akasha-artifacts/issues/64)
* **library:** 从制品库派发真实的新建设计 ([7e7c4fe](https://github.com/VOD-Studio/akasha-artifacts/commit/7e7c4fe71a70481c7d367293f2e5e99d574827a5)), closes [#62](https://github.com/VOD-Studio/akasha-artifacts/issues/62)
* **review:** 分离讨论批注和 Agent 投递 ([6e40e88](https://github.com/VOD-Studio/akasha-artifacts/commit/6e40e8811ec86ab8476efaca5e7ae4f16c50963d)), closes [#60](https://github.com/VOD-Studio/akasha-artifacts/issues/60)
* **review:** 定位、回复与解决批注线程 ([7c84c67](https://github.com/VOD-Studio/akasha-artifacts/commit/7c84c6736435a3c7e8f01e28eff06590c5134b3a)), closes [#60](https://github.com/VOD-Studio/akasha-artifacts/issues/60)
* **review:** 按原快照恢复未发送批注 ([274462e](https://github.com/VOD-Studio/akasha-artifacts/commit/274462ed9f219218e88646e153443366a04b89bb)), closes [#60](https://github.com/VOD-Studio/akasha-artifacts/issues/60)
* **share:** 限制分享角色、固定版本和试玩入口 ([81e0551](https://github.com/VOD-Studio/akasha-artifacts/commit/81e055109e15e27fbb7d8e47c85e06ee74a5c476)), closes [#63](https://github.com/VOD-Studio/akasha-artifacts/issues/63)
* **web:** 在检查器中定位画板图层与源码 ([9e1af69](https://github.com/VOD-Studio/akasha-artifacts/commit/9e1af693dfc098c14221cb0cfcf5eb6e99d64ad1)), closes [#57](https://github.com/VOD-Studio/akasha-artifacts/issues/57)
* **web:** 多选对齐并编组画板 ([7b9de3a](https://github.com/VOD-Studio/akasha-artifacts/commit/7b9de3ade907f7d69fb2a9f803b04603b323869f)), closes [#58](https://github.com/VOD-Studio/akasha-artifacts/issues/58)
* **web:** 将制品工作区改为独立多画板画布 ([4d082e1](https://github.com/VOD-Studio/akasha-artifacts/commit/4d082e1dacb10ed2e48b944599000da396355728)), closes [#53](https://github.com/VOD-Studio/akasha-artifacts/issues/53)
* **web:** 拖动画板并撤销版本布局 ([99ed269](https://github.com/VOD-Studio/akasha-artifacts/commit/99ed2697d90b3e2bc05e2b27e3af0e5f1d1da14c)), closes [#58](https://github.com/VOD-Studio/akasha-artifacts/issues/58)
* **web:** 按授权快照渲染制品库真实封面 ([66ddcca](https://github.com/VOD-Studio/akasha-artifacts/commit/66ddcca3e438d0e9ce77e156648d5c911e6b8746)), closes [#54](https://github.com/VOD-Studio/akasha-artifacts/issues/54)
* **web:** 按版本保存画板管理与布局 ([ef00ff4](https://github.com/VOD-Studio/akasha-artifacts/commit/ef00ff4d2bacc8934430f88fa71769c4e7a93a9c)), closes [#58](https://github.com/VOD-Studio/akasha-artifacts/issues/58)
* **web:** 支持从画布导航创建独立页面 ([05f8d78](https://github.com/VOD-Studio/akasha-artifacts/commit/05f8d780e4e8c0e7e242f3b3c6ae64a1afb0f257))
* **web:** 支持单画板只读聚焦 ([fc7427a](https://github.com/VOD-Studio/akasha-artifacts/commit/fc7427a7c37d42ba947bfc4b7b955900b8d1fbac)), closes [#56](https://github.com/VOD-Studio/akasha-artifacts/issues/56)
* **web:** 支持重命名和安全删除画布页面 ([f5b41b3](https://github.com/VOD-Studio/akasha-artifacts/commit/f5b41b30a2bbff06331ed42a152e34ce46479980))
* **web:** 显式试玩并沿画板流程导航 ([510bcd5](https://github.com/VOD-Studio/akasha-artifacts/commit/510bcd5464bd576b66e8869ee46d8b7af5e360f4)), closes [#56](https://github.com/VOD-Studio/akasha-artifacts/issues/56)
* **web:** 独立检查器定位画板与版本源码 ([33b3fe1](https://github.com/VOD-Studio/akasha-artifacts/commit/33b3fe19144e3c4f645f1a55dc6d0e4934e71568)), closes [#57](https://github.com/VOD-Studio/akasha-artifacts/issues/57)
* **web:** 统一制品库搜索筛选与返回视图 ([1e3193f](https://github.com/VOD-Studio/akasha-artifacts/commit/1e3193fc2ff96226cb800e3a971eb720ae99d05b)), closes [#54](https://github.com/VOD-Studio/akasha-artifacts/issues/54)
* **workspace:** 可恢复撤下制品并撤销已有分享 ([5929cb5](https://github.com/VOD-Studio/akasha-artifacts/commit/5929cb5070256509037a213fdceb8d581aca0bd9)), closes [#69](https://github.com/VOD-Studio/akasha-artifacts/issues/69)
* **workspace:** 在标题菜单管理定位、改名和重读 ([6b240f0](https://github.com/VOD-Studio/akasha-artifacts/commit/6b240f076bb7f3fd9e544cc2b18e8a089b8b9cf7)), closes [#67](https://github.com/VOD-Studio/akasha-artifacts/issues/67)
* **workspace:** 复制固定快照并在授权项目间移动制品 ([fc3c9b6](https://github.com/VOD-Studio/akasha-artifacts/commit/fc3c9b6c47d8ee1003112166b88e792cf5dd0d43)), closes [#68](https://github.com/VOD-Studio/akasha-artifacts/issues/68)
* **workspace:** 将固定快照和所选对象移交给 CLI ([24dfe6e](https://github.com/VOD-Studio/akasha-artifacts/commit/24dfe6ea3533e5e0f2cfe0210a347cb266081bfc)), closes [#66](https://github.com/VOD-Studio/akasha-artifacts/issues/66)
* **workspace:** 收藏制品并显示当前存储用量 ([484eacc](https://github.com/VOD-Studio/akasha-artifacts/commit/484eacce48441157e88dc2389cf9852aae685a0a)), closes [#67](https://github.com/VOD-Studio/akasha-artifacts/issues/67)
* **workspace:** 续接制品的真实 Codex 发布会话 ([d6db0d9](https://github.com/VOD-Studio/akasha-artifacts/commit/d6db0d9cfbe8a85cafe265e87ab38262b85f7228)), closes [#61](https://github.com/VOD-Studio/akasha-artifacts/issues/61)
* 支持画布直改与 Cloud Hub 自托管 ([#51](https://github.com/VOD-Studio/akasha-artifacts/issues/51)) ([a4b50fb](https://github.com/VOD-Studio/akasha-artifacts/commit/a4b50fbd22ac92827d985528e94c9914b6c9cb14))


### 修复

* **agent:** 从已落库首版恢复原发布会话 ([254580f](https://github.com/VOD-Studio/akasha-artifacts/commit/254580f17d6b26164a7fffd18180a050e0e95a19))


### 文档

* 补全代码注释规范并按规范补齐注释 ([74c4ddd](https://github.com/VOD-Studio/akasha-artifacts/commit/74c4ddd5fb7d1d93b490c8cc52b53b36327cfba1))

## [0.4.0](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.3.0...v0.4.0) (2026-11-23)


### 新增

* **kit:** 实现模板注册机制决策形态与属性面板 ([dcceab4](https://github.com/VOD-Studio/akasha-artifacts/commit/dcceab4e864a5704bc3b0f02e415a68a4929102e))
* **server:** 实现项目内原生文件目录存储 ([515fbad](https://github.com/VOD-Studio/akasha-artifacts/commit/515fbad87f6dbcb7cb5c10a20082e2178b80d0fd))
* **web:** 实现分栏代码编辑与版本冲突处理界面 ([9ab14df](https://github.com/VOD-Studio/akasha-artifacts/commit/9ab14df28893558a49e0038aca857d450be9844b))

## [0.3.0](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.2.0...v0.3.0) (2026-11-22)


### 新增

* **hooks:** 实现多端钩子技能插件与端到端回归测试 ([f8b27e1](https://github.com/VOD-Studio/akasha-artifacts/commit/f8b27e1eb3d6ba84149370eaf47eb88c168f2df7))
* **sandbox:** 实现源码位置注入与运行时错误回路 ([#43](https://github.com/VOD-Studio/akasha-artifacts/issues/43)) ([92b291d](https://github.com/VOD-Studio/akasha-artifacts/commit/92b291db3482ca6f6f9c3ed57e6977b7fc8f687b))
* **web:** 实现元素指认叠层与批注评审闭环 ([#45](https://github.com/VOD-Studio/akasha-artifacts/issues/45)) ([a5f51ad](https://github.com/VOD-Studio/akasha-artifacts/commit/a5f51adefe7a9d8297336ee45d31324c47a5e0e9))

## [0.2.0](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.1.0...v0.2.0) (2026-11-22)


### 新增

* **cli:** 实现整机单例 Daemon 与 MCP 全量工具 ([#40](https://github.com/VOD-Studio/akasha-artifacts/issues/40)) ([e375943](https://github.com/VOD-Studio/akasha-artifacts/commit/e375943b7b90bd263b131d317b7799a90a37d9bc))
* **core:** 初始化 Akasha 项目与双模 Artifact 核心协议 ([8651a5e](https://github.com/VOD-Studio/akasha-artifacts/commit/8651a5ef6f20ca69d2db18a469fb4e4aba740a22))
* **core:** 落地 M0 工作区基建与核心协议领域层 ([#37](https://github.com/VOD-Studio/akasha-artifacts/issues/37)) ([655b3ed](https://github.com/VOD-Studio/akasha-artifacts/commit/655b3edf17991baf8c5b543ac0907b9b0b259d29))
* **hub:** 实现 Hono 服务端与 SQLite 实时通道 ([#39](https://github.com/VOD-Studio/akasha-artifacts/issues/39)) ([ba8af0c](https://github.com/VOD-Studio/akasha-artifacts/commit/ba8af0c8172ed313f56f4d2723c48b842c4cef86))
* **sandbox:** 实现隔离沙盒运行时与外壳工作台 ([#41](https://github.com/VOD-Studio/akasha-artifacts/issues/41)) ([fd7382c](https://github.com/VOD-Studio/akasha-artifacts/commit/fd7382c3ab5dace02170bfbd6abef6e86622654b))


### 修复

* **cli:** 动态读取包版本并排除自动生成变更日志 ([#42](https://github.com/VOD-Studio/akasha-artifacts/issues/42)) ([9562dd5](https://github.com/VOD-Studio/akasha-artifacts/commit/9562dd59a003cb9581d6867b44f6d71eca866636))

## Changelog

All notable changes to this project will be documented in this file.
