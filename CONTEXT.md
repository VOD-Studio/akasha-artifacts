# Akasha 术语表

代码、文档、issue 统一使用以下术语。完整设计见 [docs/design/architecture.md](docs/design/architecture.md)。

| 术语     | 英文标识    | 定义                                                                                               |
| :------- | :---------- | :------------------------------------------------------------------------------------------------- |
| 制品     | Artifact    | Agent 发布的一个可交互网页，由稳定的 `id` 标识                                                     |
| 版本     | Version     | Artifact 的一份不可变源码快照，记录 `parentVersion` 和 `author`                                    |
| 头版本   | headVersion | Artifact 当前最新的版本号                                                                          |
| 基准版本 | baseVersion | 一次写入声明自己基于哪个版本，用于冲突检测                                                         |
| 状态流   | StateStream | 与代码版本分开的运行时 JSON 状态，以带 `seq` 的 JSON Patch 演进                                    |
| 反馈     | Feedback    | 人对某个版本的结构化反应：`comment`、`approve`、`request_changes`、`vote`、`edit`、`runtime_error` |
| 元素引用 | ElementRef  | 指向页面元素的定位信息，优先级 `loc` > `selector` > `textPreview`                                  |
| 源码位置 | loc         | 编译时注入到 DOM 上的 `data-ak-loc`，形如 `line:col`                                               |
| 编辑操作 | EditOp      | 可视化直改产生的、作用于 AST 的原子修改                                                            |
| 外壳     | Shell       | `apps/web`，持有登录态的宿主页面                                                                   |
| 沙盒     | Sandbox     | `apps/sandbox`，在独立 origin 下运行不可信 Artifact 代码的 iframe                                  |
| 桥       | Bridge      | 外壳与沙盒之间、经过校验的 `postMessage` 协议                                                      |
| 守护进程 | Daemon      | 本地常驻的 `akasha serve` 进程                                                                     |
| 中心     | Hub         | 自托管的云端服务端，与 Daemon 是同一套代码                                                         |
| 编辑层级 | L0–L4       | 查看 / 指认与批注 / 结构化参数 / 代码编辑 / 可视化直改                                             |
| 模板     | Kit         | `@akasha/kit` 中带 props schema 的预置组件                                                         |
