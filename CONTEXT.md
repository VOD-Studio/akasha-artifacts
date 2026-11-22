# Akasha 术语表

代码、文档、issue 统一使用以下术语。完整设计见 [docs/design/architecture.md](docs/design/architecture.md)。

| 术语       | 英文标识     | 定义                                                                                                                          |
| :--------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------- |
| 项目       | Project      | 本地仓库根目录或云端工作区，由整机单例 Daemon 统一登记与索引                                                                  |
| 制品       | Artifact     | Agent 发布的一个可交互网页，同时拥有不可变 `publicId` 与可读 `slug`                                                           |
| 公开标识   | publicId     | Artifact 对外 URL 使用的稳定随机 ID，重命名或移动后书签不失效                                                                 |
| 别名       | slug         | 项目内人类可读的定位标识（如 `document/retry-policy`），用于 CLI 与文件目录                                                   |
| 版本       | Version      | Artifact 的一份不可变源码快照，记录 `parentVersion` 和 `author`                                                               |
| 头版本     | headVersion  | Artifact 当前最新的版本号                                                                                                     |
| 基准版本   | baseVersion  | 一次写入声明自己基于哪个版本，用于冲突检测                                                                                    |
| 状态流     | StateStream  | 与代码版本分开的运行时 JSON 状态，以带 `seq` 的 JSON Patch 演进                                                               |
| 评审轮次   | ReviewRound  | 承载一组方案选择或验收项的批次单元，状态为 `drafting` / `submitted` / `closed`，防止审阅中途过早唤醒 Agent                    |
| 反馈       | Feedback     | 人对某个版本的结构化反应：`comment`、`approve`、`request_changes`、`vote`、`pass`、`reject`、`waive`、`edit`、`runtime_error` |
| 读取回执   | Receipt      | 拉取完整反馈证据时发放的确认凭据；凭回执 `ack` 后才推进消费游标                                                               |
| 元素引用   | ElementRef   | 指向页面元素的定位信息，优先级 `blockId` > `loc` > `selector` > `textPreview`                                                 |
| 稳定块标识 | blockId      | 结构化文档段落或画板块的稳定 ID，源码上下增删行时不漂移                                                                       |
| 源码位置   | loc          | 编译时注入到 DOM 上的 `data-ak-loc`，形如 `line:col`                                                                          |
| 编辑操作   | EditOp       | 可视化直改产生的、作用于 AST 的原子修改                                                                                       |
| 校验门禁   | Check        | 发布前执行的静态检查（语法、依赖白名单、模板 schema、块 ID 唯一性）                                                           |
| 并排画板   | Artboard     | 多方案并排展示在同一画布上的 Artifact 形态，支持推荐标记、分轮单选与流程连线                                                  |
| 结构化文档 | Document     | 带稳定 `blockId` 的设计文档形态，支持行内提问、句级批注与人类改稿追踪                                                         |
| 交付验收   | Verify       | 设计预期与构建结果并排对比 + 逐条证据声明与未验证项清单，支持 Pass / Reject / Waive 裁决                                      |
| 外壳       | Shell        | `apps/web`，持有登录态的多项目宿主页面                                                                                        |
| 沙盒       | Sandbox      | `apps/sandbox`，在独立 origin 下运行不可信 Artifact 代码的 iframe                                                             |
| 桥         | Bridge       | 外壳与沙盒之间、经过校验的 `postMessage` 协议                                                                                 |
| 钩子适配器 | Hook Adapter | `packages/hooks`，向宿主 Agent 注入网页选中上下文、触发异步唤醒并上报运行状态                                                 |
| 守护进程   | Daemon       | 本地整机单例的 `akasha serve` 进程，采用固定高端口段                                                                          |
| 中心       | Hub          | 自托管的云端服务端，与 Daemon 是同一套代码，本机访问优先直连本地 Daemon                                                       |
| 编辑层级   | L0–L4        | 查看 / 指认与批注 / 结构化参数 / 代码编辑 / 可视化直改                                                                        |
| 模板       | Kit          | `@akasha/kit` 中带 props schema 与校验规则的预置组件                                                                          |
