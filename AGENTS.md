# akasha

面向 CLI 编程 Agent（Antigravity、Claude Code、OpenAI Codex CLI 等）的开源实时交互式 Web Artifact 引擎，支持本地守护进程（Local Daemon）与私有云部署（Cloud Hub）双模运行。

## 开发命令

使用 **`pnpm`**（禁止使用 npm 或 yarn），所有构建与检查统一走根目录 `Makefile`：

- `make install` — `pnpm install --frozen-lockfile`
- `make lint` — `biome check` + `tsc --noEmit` + 提交信息规范检查
- `make test` — `vitest run`
- `make build` — 编译输出至 `dist/`

## 规范与文档

- **双语 README 对称**：修改 `README.md` 必须同步修改 `README.zh-CN.md`，保持章节、配置示例与表格完全对齐。
- **分支、提交、PR 与 Issue**：遵循 `docs/agents/git.md`（中文 Conventional Commits：`<type>(<scope>): <subject>`）。
- **代码注释**：遵循 `docs/agents/comments.md`（新写注释用中文，只写契约、不变量与非显然陷阱，不复述签名）。
- **Issue 跟踪与分诊标签**：见 `docs/agents/issue-tracker.md` 与 `docs/agents/triage-labels.md`。
