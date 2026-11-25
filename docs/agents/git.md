# 分支、提交、PR 与 issue

## 分支

每个新任务都先从 `main` 拉分支，在分支上完成。

格式：`<type>/<scope>-<简述>`，全小写，用 `/` 分段、`-` 连词，简述用英文或拼音。

- type 对齐 Conventional Commits：`feat` / `fix` / `chore` / `docs` / `refactor` / `style` / `test` / `perf` / `build` / `ci`。
- scope 是最内层的模块：`core`、`mcp`、`cli`、`hub`、`sandbox`、`kit`、`scripts`、`deps`、`readme`、`release`。改动跨模块时可以省略。

## 提交纪律

- 有可入库改动就本地提交，默认不推送。只读分析和评审不制造空提交。
- 一个可独立说明、验证和回退的改动完成后即提交，再做下一项。不要攒到任务结尾拆 hunk，也不按文件或技术层机械拆出不能工作的中间态。每笔提交只选本项改动，保留用户及并行任务的工作。
- API 提供者先于消费方；`packages/ui` 的同一组件契约连同样式、公开入口、必要测试一起提交，页面接入另提。迁移消费方时同时删掉已过时的调用、导出和测试。
- 验证频率按风险，不按提交数。文档核对内容和引用；行为用能证明新旧契约的最小检查。共享的构建与集成测试在接通后跑一次，交付时区分实跑、复用和未跑。
- 默认不重写已共享或他人的历史。

## 提交信息

- 中文 Conventional Commits：`<type>(<scope>): <subject>`。纯文档或流程用 `docs`。
- scope 写最小的改动单元。
- subject 只概括一个主要变更，用祈使句，50 字以内，不用 `+` 或 `、` 堆砌多件事。
- body 用列表写改动事实。

## PR 与合并

- base 是 `main`，默认不设 assignees、reviewers、labels。
- `main` 启用「main 保护」ruleset：只能通过 PR 合并，且必须通过「CI 通过」状态检查，评审意见全部 resolve 后才可合并。
- 普通 PR 使用 **Create a merge commit**，包括只有一笔提交或由机器人创建的依赖更新。只有 release-please 的版本发布 PR（如 `chore(main): release 0.5.0`）使用 **Squash and merge**。两种 PR 的标题都须通过 `pr-title.yml` 的 Conventional Commits 检查。
- 连续交付多个事项时，逐项提交、开 PR。合并前核对评审和讨论线程：修复有效问题并回报验证结果；不采纳的说明原因。确认该 PR 已合入 `main` 后，再从更新后的 `main` 开始下一项。
