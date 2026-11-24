# akasha

面向 CLI 编程 Agent（Antigravity、Claude Code、OpenAI Codex CLI 等）的开源实时交互式 Web Artifact 引擎，支持本地守护进程（Local Daemon）与私有云部署（Cloud Hub）双模运行。

## 开发命令

使用 **`pnpm`**（禁止使用 npm 或 yarn），所有构建与检查统一走根目录 `Makefile`：

- `make install` — `pnpm install --frozen-lockfile`
- `make lint` — `biome check` + `tsc --noEmit` + 提交信息规范检查
- `make test` — `vitest run`
- `make build` — 编译输出至 `dist/`

## 规范与文档

- **设计依据**：架构、协议与原则见 `docs/design/architecture.md`，术语见 `CONTEXT.md`，技术选型见 `docs/adr/`。与设计冲突的改动须先更新设计或新增 ADR。
- **Web 实现**：改界面文案、组件或交互前，先读 [Web 文案与实现规范](docs/agents/frontend.md)。

- **双语 README 对称**：修改 `README.md` 必须同步修改 `README.zh-CN.md`，保持章节、配置示例与表格完全对齐。
- **分支、提交、PR 与 Issue**：遵循 `docs/agents/git.md`（中文 Conventional Commits：`<type>(<scope>): <subject>`）。
- **代码注释**：遵循 `docs/agents/comments.md`。注释写契约、不变量和陷阱，不复述签名；导出符号用 TSDoc，函数体内的陷阱用行内注释。改协议领域模型、领域类型、请求响应或持久化结构前，先看[字段注释规则](docs/agents/comments.md#字段注释规则)：领域模型字段必注，其余只注释无法从名字和类型推断的语义。
- **Issue 跟踪与分诊标签**：见 `docs/agents/issue-tracker.md` 与 `docs/agents/triage-labels.md`。
