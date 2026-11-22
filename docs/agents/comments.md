# 代码注释规范

## 语言

- 新写的注释用中文；专有名词（MCP、CSP、WebSocket、Durable Objects）保留原文。
- 过期的注释比没有更危险：代码行为变化时同步更新或删除旧注释。

## 写什么

注释只写代码说不出来的信息：

- **非显然的陷阱与安全边界**（如沙盒 Origin 隔离与 CSP 约束）
- **跨进程、跨端协议约定**（MCP Server、Cloud Hub 与 Sandbox Runtime 之间的载荷契约）
- **魔法值的理由**

## 不写什么

- 不复述函数或类型签名。
- 不把设计论证或历史背景塞进代码注释（放入 commit body 或 `docs/adr/`）。
