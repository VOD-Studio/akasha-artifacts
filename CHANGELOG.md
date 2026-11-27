# Changelog

## [0.6.0](https://github.com/VOD-Studio/akasha-artifacts/compare/v0.5.0...v0.6.0) (2026-11-27)


### 新增

* **agent:** 将已预览的参考材料交付给授权轮次 ([244058a](https://github.com/VOD-Studio/akasha-artifacts/commit/244058a28cbd6c097a5f10eae78594e1f3628104))
* **cli:** 在授权编码会话读取设计并发布新版本 ([6c090ff](https://github.com/VOD-Studio/akasha-artifacts/commit/6c090ff07bb2797699c1856c3f6480b371b1c6f7))
* **cli:** 在编码会话中续接固定设计 ([669c80a](https://github.com/VOD-Studio/akasha-artifacts/commit/669c80a3395ce427c1f2ba3ed058f094c605ae8c))
* **cli:** 将工程变更发布回交接作品 ([bef5f6b](https://github.com/VOD-Studio/akasha-artifacts/commit/bef5f6b4a4984e88ef7e33c026b8a4d13a3bcce2))
* **design:** 设置画板打印版式、纸型与布局辅助线 ([c8b3c57](https://github.com/VOD-Studio/akasha-artifacts/commit/c8b3c579d15cfeaa90a5f94aa328f39fcecc3199))
* **hub:** 从个人或团队固定系统组合新设计 ([221d7be](https://github.com/VOD-Studio/akasha-artifacts/commit/221d7be6fc3bac07d11c1b6c16f434a038933423))
* **hub:** 发布团队固定系统并管理默认版本 ([b78e102](https://github.com/VOD-Studio/akasha-artifacts/commit/b78e102df656a3ea580cb5c538ef4aacee187c43))
* **hub:** 合并协作者对同一画布的改动 ([0ee175c](https://github.com/VOD-Studio/akasha-artifacts/commit/0ee175c3d98da7dc559d1f66b2b4a1fd76714c86))
* **hub:** 在协作画布显示同页编辑者的光标 ([3fba033](https://github.com/VOD-Studio/akasha-artifacts/commit/3fba03315fb1019bc27514a19ef9778415926e54))
* **hub:** 按固定系统校正候选设计并保留业务文案 ([76d251a](https://github.com/VOD-Studio/akasha-artifacts/commit/76d251a0c6ba2a34f8a9f1c01c9c2b68ce2a53be))
* **hub:** 按当前身份授予并撤回制品访问权 ([d6aaa35](https://github.com/VOD-Studio/akasha-artifacts/commit/d6aaa35147e90cde08f7c9474ac602fd2525193d))
* **hub:** 按成员共享已审阅的系统版本 ([7f9bccf](https://github.com/VOD-Studio/akasha-artifacts/commit/7f9bccf59708adf98518b655b9795a8c44128c5b))
* **hub:** 支持多人共同编辑设计画布 ([05e59cb](https://github.com/VOD-Studio/akasha-artifacts/commit/05e59cb46b0c6e2159b51bbb11492fe762de04f0))
* **hub:** 支持按身份邀请设计协作者 ([#153](https://github.com/VOD-Studio/akasha-artifacts/issues/153)) ([ecb2195](https://github.com/VOD-Studio/akasha-artifacts/commit/ecb2195c2361726cb04c29987c8a6a99801e2e84))
* **hub:** 让团队按固定设计系统起稿 ([7f763b1](https://github.com/VOD-Studio/akasha-artifacts/commit/7f763b15aa08f0691cc79a67b4db2358177f2366))
* **kit:** 从固定设计系统版本生成带来源的独立画板 ([c1f4375](https://github.com/VOD-Studio/akasha-artifacts/commit/c1f4375ee802cf9d4d58eb98321a54cc8a143988))
* **kit:** 从授权组件与品牌资料建立可重同步的设计系统 ([d93c477](https://github.com/VOD-Studio/akasha-artifacts/commit/d93c47727fcb91753edaa9b2bef56cacc3ba5cfc))
* **kit:** 预览授权品牌素材和真实组件 ([30e69e3](https://github.com/VOD-Studio/akasha-artifacts/commit/30e69e37f1b87aac640a7d8b4bfb8d220cee4e03))
* **protocol:** 为画布元素探测增加悬停用途 ([8b9e962](https://github.com/VOD-Studio/akasha-artifacts/commit/8b9e962bd25d1ef31f7d67aa26e270e619357101))
* **protocol:** 在画板快照中保存打印版式和辅助线 ([6296ce5](https://github.com/VOD-Studio/akasha-artifacts/commit/6296ce50d6b2e19f0871b581b4ba97bc0f517f64))
* **protocol:** 扩展原生图层样式翻转与画板流元素直改契约 ([fba6d98](https://github.com/VOD-Studio/akasha-artifacts/commit/fba6d988383ccd723b3a9c93f1b2c8ed070d14e9))
* **protocol:** 扩展批注线程的 Agent 执行状态与回复契约 ([637ee2f](https://github.com/VOD-Studio/akasha-artifacts/commit/637ee2fc5efe0018dc3adb620976aa0db61b5ff2))
* **protocol:** 按确认范围生成画板参数快照 ([b49cbf3](https://github.com/VOD-Studio/akasha-artifacts/commit/b49cbf3b273b4487d0c923eb3968bfc756f18685))
* **sandbox:** 定版捕捉画板并按需输出连续打印页 ([f3e91d1](https://github.com/VOD-Studio/akasha-artifacts/commit/f3e91d1e759bde5562f5383b8a86583f4f7e10ea))
* **sandbox:** 支持画布悬停探测并回传元素源码位置 ([7314c31](https://github.com/VOD-Studio/akasha-artifacts/commit/7314c31689eccbf100e6d60f774519cf627e7fa7))
* **server:** 发布已审阅的系统快照并逐项确认重同步 ([bafacfb](https://github.com/VOD-Studio/akasha-artifacts/commit/bafacfb10cecd29c503d8084353172b5c1b0bf60))
* **server:** 打通批注线程到已绑定 Agent 会话的闭环投递与回写 ([3b4a985](https://github.com/VOD-Studio/akasha-artifacts/commit/3b4a985e228a6d8d17a44d2d471a2da436b7f526))
* **server:** 限定授权会话仅能应用已确认的参数 ([488e1a6](https://github.com/VOD-Studio/akasha-artifacts/commit/488e1a69dcb0251246d6f6bd911777ee5618cdbe))
* **ui:** 为 SheetBody 接入覆盖式 ScrollArea 滚动条 ([5467741](https://github.com/VOD-Studio/akasha-artifacts/commit/5467741856f252c6dadc4a1843d4b204478fa9ac))
* **ui:** 从包入口导出 useTheme 主题钩子 ([bf8b670](https://github.com/VOD-Studio/akasha-artifacts/commit/bf8b67081f6b115459d1be9cdc0a7d537432fdae))
* **ui:** 支持界面语言与抽屉阅读方向 ([7760210](https://github.com/VOD-Studio/akasha-artifacts/commit/7760210d017a44554100029bd361820095bbea7d))
* **web:** 从作品库使用参考材料创建设计 ([a21a05c](https://github.com/VOD-Studio/akasha-artifacts/commit/a21a05ce0d2a5c5b25842e0900c977cd7466d112))
* **web:** 从作品库打开同一份协作画布 ([3222992](https://github.com/VOD-Studio/akasha-artifacts/commit/3222992b7832320320f31066a35256d73e80cb57))
* **web:** 从作品菜单进入和退出宿主全屏 ([9ce313f](https://github.com/VOD-Studio/akasha-artifacts/commit/9ce313f59e5b0ff86b9cdf909e527b5c924264e5))
* **web:** 修复侧栏内边距并重构图层树与选区动画 ([82c0d90](https://github.com/VOD-Studio/akasha-artifacts/commit/82c0d90256770f31eb02e3b566399fa2fe066165))
* **web:** 前置检测会话写权限并在无权时进入只读态 ([f22fbbd](https://github.com/VOD-Studio/akasha-artifacts/commit/f22fbbd66752d5d7079b72d6d0f22da7b47ecb0e))
* **web:** 在作品库导入和管理设计系统版本 ([87f1af7](https://github.com/VOD-Studio/akasha-artifacts/commit/87f1af708812dc04fe582ade2773660a2d881892))
* **web:** 在原作品版本恢复未提交的文字 ([851a684](https://github.com/VOD-Studio/akasha-artifacts/commit/851a6849c3a4e3b6e5517463ff87ca752a682e20))
* **web:** 在原设计会话中补充参考材料 ([631dd81](https://github.com/VOD-Studio/akasha-artifacts/commit/631dd8164f977b625f5bfd8c6b55a77b772736fd))
* **web:** 在工作台邀请并管理设计协作者 ([d019c21](https://github.com/VOD-Studio/akasha-artifacts/commit/d019c215fb383eb1a9cf06f3c750f5e03f74a078))
* **web:** 在批注线程中显示 Agent 回复及设计版本 ([b0a0e00](https://github.com/VOD-Studio/akasha-artifacts/commit/b0a0e006c9e8d126290706fd2fceadced24f4f81))
* **web:** 在批注线程展示 Agent 回复状态与版本对象定位 ([e835a77](https://github.com/VOD-Studio/akasha-artifacts/commit/e835a77e6c548d1dd5e0f8d2d6f13fe4ae1c5492))
* **web:** 在浏览器续接已绑定的编码工作区 ([81706f8](https://github.com/VOD-Studio/akasha-artifacts/commit/81706f8aacd7215fa87c5489dc834f5dcbc54899))
* **web:** 在画布总览用触摸平移、缩放和长按编辑 ([1497b13](https://github.com/VOD-Studio/akasha-artifacts/commit/1497b13ddabe6e38e2cec4703af04a461d221296))
* **web:** 在触屏设备上创建、查看和编辑设计 ([0dd4a66](https://github.com/VOD-Studio/akasha-artifacts/commit/0dd4a669ca6f145cd10f028107fc9db2277a7f61))
* **web:** 实现画布拖框多选、定位建板与跨板边界绘制 ([799c145](https://github.com/VOD-Studio/akasha-artifacts/commit/799c1453f79ab4cad12704a8d12c912e34943815))
* **web:** 实现自适应选区浮栏与对比度提示 ([40d07f2](https://github.com/VOD-Studio/akasha-artifacts/commit/40d07f2b0b31d10efb4d348d356f749e689e18a4))
* **web:** 实现键盘图层遍历、树焦点分离与画布编辑快捷键 ([2ef5e06](https://github.com/VOD-Studio/akasha-artifacts/commit/2ef5e064f50d90959efb37485044b90b9edafc78))
* **web:** 将固定版本的多页设计导出为离线 ZIP ([a12d9f0](https://github.com/VOD-Studio/akasha-artifacts/commit/a12d9f0bca7ef8160dd01970a6eb9ee52b678b34))
* **web:** 将固定版本的多页设计导出为离线 ZIP ([4dde854](https://github.com/VOD-Studio/akasha-artifacts/commit/4dde854baa334cc1c38c835abaff20d5ea430228))
* **web:** 将所选画板的预览参数发布为新版本 ([bddcbb5](https://github.com/VOD-Studio/akasha-artifacts/commit/bddcbb5fbece5c0b16175833e75876ec0ab55afa))
* **web:** 将所选画板的预览参数发布为新版本 ([e079a54](https://github.com/VOD-Studio/akasha-artifacts/commit/e079a544084f949a0d40fe6ee23d850ae9c148b2))
* **web:** 将设计移交给已连接的工程会话 ([4ad5a4f](https://github.com/VOD-Studio/akasha-artifacts/commit/4ad5a4fa3567d0e098febfeeb75154b5f65521ea))
* **web:** 将顶栏批注改为画布显隐开关与下拉菜单 ([efd9ced](https://github.com/VOD-Studio/akasha-artifacts/commit/efd9cedf271a246178aece219f8e2f9d3bd4273f))
* **web:** 展开画板后点选并编辑文字 ([87c9db8](https://github.com/VOD-Studio/akasha-artifacts/commit/87c9db896fcd9cba9641bc4483250cb3414fdae1))
* **web:** 按 Claude Design 重构检查器与即改即生效交互 ([c086e54](https://github.com/VOD-Studio/akasha-artifacts/commit/c086e54bedd5f5c358dc014597209c7fe7176848))
* **web:** 按 Figma 交互优化画布原地文字工具 ([4a4291f](https://github.com/VOD-Studio/akasha-artifacts/commit/4a4291f8aa3db290d84f22c0b299043f9c819dfb))
* **web:** 支持选区工具栏与键盘编辑图层 ([6160efb](https://github.com/VOD-Studio/akasha-artifacts/commit/6160efb44cadf5427984aa7e18cdbc96b984c3a6))
* **web:** 收到浏览器安装邀请后从作品菜单安装 ([63341ea](https://github.com/VOD-Studio/akasha-artifacts/commit/63341ea66c763b9660483e6515e282b9182b9601))
* **web:** 新增选区旁带锚点的批注输入浮层 ([fe9f126](https://github.com/VOD-Studio/akasha-artifacts/commit/fe9f1262a70ab59ad110ce83f069923ad3a04942))
* **web:** 用已确认的参考资料创建并迭代设计 ([1c0e569](https://github.com/VOD-Studio/akasha-artifacts/commit/1c0e56960cb5dda3cf88d523c25aa33aa9e9ef53))
* **web:** 精简页面菜单并按画板缓存图层树 ([e8edb1d](https://github.com/VOD-Studio/akasha-artifacts/commit/e8edb1d5778595554b3b92cd68c7ca5a877d0d0a))
* **web:** 编辑画板打印设置与布局辅助线 ([b3dfe0e](https://github.com/VOD-Studio/akasha-artifacts/commit/b3dfe0eaf6b038d409f52e08dc2a37cb5efde01e))
* **web:** 补充画布对比度、剪贴板、图层导航与扩展源码编辑 ([e905aa0](https://github.com/VOD-Studio/akasha-artifacts/commit/e905aa0a12f18aa500c65df63f1c0255128831c9))
* **web:** 让作品库和工作区支持中英界面切换 ([580aa1d](https://github.com/VOD-Studio/akasha-artifacts/commit/580aa1d7aec332677c6e8cbf6fc6203414d14d53))
* **web:** 让作品库和工作区支持中英界面切换 ([fbcd7c1](https://github.com/VOD-Studio/akasha-artifacts/commit/fbcd7c12883e23aa70e8497b31201b9871f604e2))
* **web:** 重做检查器顶置标签分栏与紧凑属性控件 ([78dadc8](https://github.com/VOD-Studio/akasha-artifacts/commit/78dadc849bb65268a1703ec0155954ef4f6d56c1))
* **web:** 重做画布选择与批注及原地编辑交互 ([0ca2369](https://github.com/VOD-Studio/akasha-artifacts/commit/0ca236989ab729b12374d469fe6f317ca218dd78))
* **web:** 重塑作品库界面交互与主题切换动效 ([278bffd](https://github.com/VOD-Studio/akasha-artifacts/commit/278bffddd9ad852ab00b06e37eeeab7ef03b6017))
* **web:** 重塑作品库界面交互与主题切换动效 ([01ae355](https://github.com/VOD-Studio/akasha-artifacts/commit/01ae355216ac1d2a77587fe9e04ed2de2ae6eeb2))
* **web:** 重塑画布工作台交互与视觉层次 ([57ef5d8](https://github.com/VOD-Studio/akasha-artifacts/commit/57ef5d803e5e5185fe4fef5508a3ac24f0518719))
* **web:** 重塑画布工作台交互与视觉层次 ([5af6809](https://github.com/VOD-Studio/akasha-artifacts/commit/5af6809846c05bf392c517f8896fd4b1c0b0d3ca))
* **web:** 重构动态上下文检查器并全量接入滚动条组件 ([a35e2ad](https://github.com/VOD-Studio/akasha-artifacts/commit/a35e2ad9db305311f625a5b4557c00f4824077db))
* **web:** 重构画布批注浮层与右侧批注评审面板 ([d2d94d7](https://github.com/VOD-Studio/akasha-artifacts/commit/d2d94d70aabedaddce704d810f74e5b65351317d))
* **web:** 重构画布直改交互与动态检查器并补全权限只读态 ([6b86d3b](https://github.com/VOD-Studio/akasha-artifacts/commit/6b86d3bdee717625815a457358afc6d5f84526d4))
* **web:** 预览并下载相同纸型和页序的 PDF ([471e7d5](https://github.com/VOD-Studio/akasha-artifacts/commit/471e7d561275a11f2c236ecc24522834daf70008))


### 修复

* **agent:** 允许从原草稿移除失效参考材料 ([45872c9](https://github.com/VOD-Studio/akasha-artifacts/commit/45872c995d4f9e6edf7fa22ab945db6dda5fb48c))
* **design:** 保留滚动正文末段并翻译打印设置错误 ([13b0d5a](https://github.com/VOD-Studio/akasha-artifacts/commit/13b0d5a7d3efc9ccd5308b2019fc883a4065a10c))
* **handoff:** 区分整稿编辑后的当前组件与历史来源 ([dc1a1f6](https://github.com/VOD-Studio/akasha-artifacts/commit/dc1a1f65fc2797583648c6d78053b069238d1d31))
* **handoff:** 历史设计系统失效时仍可交接当前作品 ([427ff6a](https://github.com/VOD-Studio/akasha-artifacts/commit/427ff6ade02f745ec1d278df49c9aa311dc439dd))
* **handoff:** 重新移交时保留工程实现与原审阅来源 ([cce8a39](https://github.com/VOD-Studio/akasha-artifacts/commit/cce8a39bbbe268521716ff780d9b9e247dd960aa))
* **hub:** 不向固定快照链接提供编辑权限 ([fbff7ad](https://github.com/VOD-Studio/akasha-artifacts/commit/fbff7ad7d6e5ee6df04272df6aa7db5c580abe7c))
* **hub:** 阻止撤权前的签发请求恢复访问 ([8b44f8f](https://github.com/VOD-Studio/akasha-artifacts/commit/8b44f8f71e1d1289168627e0969f33b507c75ad2))
* **review:** 热更新保留选区批注草稿并补排并发入队任务 ([6209512](https://github.com/VOD-Studio/akasha-artifacts/commit/6209512e2df98b53c4af973a797af7a6fd59b54a))
* **sandbox:** 在原型中提交固定系统组件的表单 ([bf881e6](https://github.com/VOD-Studio/akasha-artifacts/commit/bf881e6f63cb98a74c6d6f703e7563f2cce15ac0))
* **sandbox:** 支持在团队设计中定位和操作固定系统组件 ([1035f0e](https://github.com/VOD-Studio/akasha-artifacts/commit/1035f0e11489692e2461920eb9ba9ff4401729b3))
* **server:** 条件收敛投递状态并令竞态批注自动入队 ([f6c505a](https://github.com/VOD-Studio/akasha-artifacts/commit/f6c505ac9a4cbb423d2555332a5d29fd22e9e6ff))
* **ui:** 修复菜单滑块跨间隙时的硬跳问题 ([526fa12](https://github.com/VOD-Studio/akasha-artifacts/commit/526fa12373e8a9e2bc879d277b615336b73da9ba))
* **web:** 为形状菜单按钮显式设置可访问名称 ([9321cb8](https://github.com/VOD-Studio/akasha-artifacts/commit/9321cb815ef09df0c837a98cc6c8e014834bf0a5))
* **web:** 互斥分享写入并移除已撤回的邀请地址 ([fdddf8c](https://github.com/VOD-Studio/akasha-artifacts/commit/fdddf8c009d5c74346e08f58197a23e38566682a))
* **web:** 优化画布保存失败提示并修复切语滞后 ([1e38670](https://github.com/VOD-Studio/akasha-artifacts/commit/1e38670f36e652d574b2e5b947753f51a3444f4a))
* **web:** 保留缺失组件时恢复完整的旧入口文件 ([39bcdf0](https://github.com/VOD-Studio/akasha-artifacts/commit/39bcdf01eb262b93e4d249549a6f9ac4a8af5660))
* **web:** 修复极小缩放标题重叠并保留已加载画板 ([325852a](https://github.com/VOD-Studio/akasha-artifacts/commit/325852ad062c55111e77f49473e7277ba979631d))
* **web:** 修正选区工具栏与原地文本对齐并升级参数控件 ([5b409a0](https://github.com/VOD-Studio/akasha-artifacts/commit/5b409a0eefe226446b7b21839ff97927a6a38edd))
* **web:** 关联团队系统选择项与复选框 ([b5793e2](https://github.com/VOD-Studio/akasha-artifacts/commit/b5793e25ee55f2b51e1a50d3aae80a659722c279))
* **web:** 回到可写画布时恢复当前快照的文字草稿 ([e1c0990](https://github.com/VOD-Studio/akasha-artifacts/commit/e1c09901f576da3d0562ed6527c3c6c2da9af8c3))
* **web:** 在打开作品的骨架中保留动态品牌徽标 ([780aec9](https://github.com/VOD-Studio/akasha-artifacts/commit/780aec9e6cdb8e7dfcadec17deef99d955cb0c10))
* **web:** 在根路由初始化主题并修正减弱动态顺序 ([0ee7721](https://github.com/VOD-Studio/akasha-artifacts/commit/0ee772122bf5c092e8fe959601193caabc29c8ae))
* **web:** 将画板范围标签关联到对应复选框 ([78ca26d](https://github.com/VOD-Studio/akasha-artifacts/commit/78ca26d9eca0e85b4e03c6f375c1e729a1d07029))
* **web:** 将移动端编辑框与会话输入留在软键盘上方 ([28e4c82](https://github.com/VOD-Studio/akasha-artifacts/commit/28e4c82ed4fabfd623cfc0bff56144aeb6a1e004))
* **web:** 已撤权的画板不再提供无效重试 ([b81b4d0](https://github.com/VOD-Studio/akasha-artifacts/commit/b81b4d089a90cd4737be45acc97481f7bf4d0ba5))
* **web:** 按所属项目查询设计系统管理权 ([9b18c46](https://github.com/VOD-Studio/akasha-artifacts/commit/9b18c463127fb76df6e23445605efeed97148b8a))
* **web:** 按所属项目查询设计系统管理权 ([2aa4661](https://github.com/VOD-Studio/akasha-artifacts/commit/2aa46613b2f3e9d8738e00a36c902b3a54601864))
* **web:** 收紧检查器画板树留白并优化源码块格式化展示 ([2d218b2](https://github.com/VOD-Studio/akasha-artifacts/commit/2d218b2fff4892634363dd0cfc83d4c2bb8405e5))
* **web:** 无光标连接时保留画布编辑与降权处理 ([d1901aa](https://github.com/VOD-Studio/akasha-artifacts/commit/d1901aae19bcabe9db054964018d63b2f5a21900))
* **web:** 清理冗余徽章圆点并优化批注入口与图层折叠 ([26a3462](https://github.com/VOD-Studio/akasha-artifacts/commit/26a3462f2cbd3ea2f81672c7a85c41b51b2c178d))
* **web:** 画布保存提示接入 Toast 样式并支持关闭 ([1ff5efe](https://github.com/VOD-Studio/akasha-artifacts/commit/1ff5efe0e60df0d86b3756a50790f4c0c7df1525))
* **web:** 移动作品时保留源码草稿并重查目标项目权限 ([90a476b](https://github.com/VOD-Studio/akasha-artifacts/commit/90a476b10e2fe5273aaf87e5da6e06718b5c6779))
* **web:** 移除只读态重复提示并在无写权限时隐藏移交入口 ([2197c3e](https://github.com/VOD-Studio/akasha-artifacts/commit/2197c3eb6f0caa0480438d5e57034bd0dfb3f1be))
* **web:** 约束工作区与单板视图宽度避免窄视口溢出原生滚动条 ([bdbc22c](https://github.com/VOD-Studio/akasha-artifacts/commit/bdbc22cdf476c673c24df9dc86e17f0eae47c928))
* **web:** 编辑降权后保留未保存的本地草稿 ([d07d3b5](https://github.com/VOD-Studio/akasha-artifacts/commit/d07d3b56db0775b2ae35d34c2d056680c7c35f4c))
* **web:** 补回单板视图画板区 LTR 方向并同步批注测试 ([0c3ea9b](https://github.com/VOD-Studio/akasha-artifacts/commit/0c3ea9b837e6570e44f5968cdc8363af8aaea312))
* **web:** 补回展示页缩放快捷键并隔离总览元素选区 ([90dbf48](https://github.com/VOD-Studio/akasha-artifacts/commit/90dbf48dc9c9ab76d71fffd11ca9980c33d3c62a))
* **web:** 触屏绘图仅由落笔的主指针提交 ([3a15b46](https://github.com/VOD-Studio/akasha-artifacts/commit/3a15b46bfcf85c7f01d08b9f5b511e56d5c61d40))
* **web:** 让触屏作品库直接显示收藏与复制入口 ([32ae43c](https://github.com/VOD-Studio/akasha-artifacts/commit/32ae43ca19979c2a7ace1ebea9360bc30eedb082))
* **web:** 返回作品库后继续原设计会话 ([d3ca470](https://github.com/VOD-Studio/akasha-artifacts/commit/d3ca47023d73a8f725a1503b3934b5e3a3204192))
* **web:** 防止运行图层操作回退到画板并开放独立作品权限 ([3ec63f7](https://github.com/VOD-Studio/akasha-artifacts/commit/3ec63f7a7a4cdf82a11bd4e7d476a9756b77b30e))


### 性能优化

* **web:** 提升总览缩略图清晰度并下调实稿渲染倍率 ([9ca81d8](https://github.com/VOD-Studio/akasha-artifacts/commit/9ca81d807776d618740a572c2bd16b2acb13393c))


### 重构

* **kit:** 按模板类型组织解析与校验 ([32eef91](https://github.com/VOD-Studio/akasha-artifacts/commit/32eef918c679d20eb1973417c924423ae307b53b))
* **protocol:** 按画板领域与传输契约组织协议 ([5c9dd04](https://github.com/VOD-Studio/akasha-artifacts/commit/5c9dd048ce89349cb10afd15a0bab91332f2815f))
* **sandbox:** 按内容类型和运行职责组织渲染器 ([15512d6](https://github.com/VOD-Studio/akasha-artifacts/commit/15512d6a410bcbbc7b1bbda6562946525bb15567))
* **server:** 分离文件存储布局与外部编辑对账 ([b316b41](https://github.com/VOD-Studio/akasha-artifacts/commit/b316b419a19413cbe9d276cb01d194910b79f94f))
* **server:** 按业务用例注册 HTTP 路由 ([cf4144d](https://github.com/VOD-Studio/akasha-artifacts/commit/cf4144d7f1439a5654d7e2862b5e5009efdd7000))
* **server:** 按制品与评审用例拆分应用服务 ([a418723](https://github.com/VOD-Studio/akasha-artifacts/commit/a418723693801ba856f6edfd6abcbd3e9ca454a0))
* **web:** 将主题切换组件提升至共享层 ([c161f25](https://github.com/VOD-Studio/akasha-artifacts/commit/c161f25732c4b9f7500f0be8b1d634f514848cbc))
* **web:** 将库和顶栏的业务对话框归还功能切片 ([438db5c](https://github.com/VOD-Studio/akasha-artifacts/commit/438db5ca369e7d18bf7ff1b66d53cd5cdc9a2c46))
* **web:** 拆分画布场景渲染与输入职责 ([2b45257](https://github.com/VOD-Studio/akasha-artifacts/commit/2b45257e194574a9ac2639e9422e00c4e79a30e8))
* **web:** 按职责组织作品工作台 ([6844c26](https://github.com/VOD-Studio/akasha-artifacts/commit/6844c26b9baed3be9bcd1ed13de135de03f9b832))
* **web:** 按职责组织作品工作台 ([226f066](https://github.com/VOD-Studio/akasha-artifacts/commit/226f0666db2eaafba1f82226ca452ccb9261d5ba))
* **web:** 明确材料草稿的激活和空选区 ([454d821](https://github.com/VOD-Studio/akasha-artifacts/commit/454d821f533e3e56a1fe91840bca46cfc1875894))
* 按业务职责拆分跨模块实现与测试 ([cc633ed](https://github.com/VOD-Studio/akasha-artifacts/commit/cc633edf0cff51d86e91bede9c0fd84eea4832b1))

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
