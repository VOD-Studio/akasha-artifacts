# 分支、提交、PR 与 issue

## 分支

每个新任务都先从 `main` 拉分支，在分支上完成。

格式：`<type>/<scope>-<简述>`，全小写，用 `/` 分段、`-` 连词，简述用英文或拼音。

- type 对齐 Conventional Commits：`feat` / `fix` / `chore` / `docs` / `refactor` / `style` / `test` / `perf` / `build` / `ci`。
- scope 是最内层的模块：`core`、`mcp`、`cli`、`hub`、`sandbox`、`kit`、`scripts`、`deps`、`readme`、`release`。改动跨模块时可以省略。

## 提交信息

- 中文 Conventional Commits：`<type>(<scope>): <subject>`。纯文档或流程用 `docs`。
- scope 写最小的改动单元。
- subject 只概括一个主要变更，用祈使句，50 字以内，不用 `+` 或 `、` 堆砌多件事。
- body 用列表写改动事实。

## PR 与合并

- base 是 `main`，默认不设 assignees、reviewers、labels。
- `main` 启用「main 保护」ruleset：只能通过 PR 合并，且必须通过「CI 通过」状态检查，评审意见全部 resolve 后才可合并。
- 发版 PR、机器人 PR、只做一件事的 PR 优先使用 **Squash** 合并（PR 标题需符合 Conventional Commits，由 `pr-title.yml` 自动校验）。
