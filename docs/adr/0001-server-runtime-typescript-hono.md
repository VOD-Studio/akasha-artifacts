# ADR-0001：服务端使用 TypeScript 和 Hono

- 状态：已接受
- 日期：2026-11-22

## 背景

Akasha 的服务端要以两种形态运行：

- **本地 Daemon**：通过 `npx akasha-artifacts` 分发，零配置启动。
- **云端 Hub**：用 Docker 自托管，或部署到 Cloudflare Workers。

同时，下面这些逻辑必须在浏览器外壳、沙盒 iframe、服务端和 MCP 进程四个运行时中保持一致：

- 协议 schema
- JSON Patch 应用
- `EditOp` 定义
- JSX 源码位置注入与 AST 改写

其中位置注入和 AST 改写必须使用同一个解析器，否则源码的行列号会对不上。

服务端的负载以 I/O 为主（WebSocket 广播、long-poll、SQLite 读写），规模是团队级。

## 备选方案

| 方案                         | 优点                                                                                                                 | 缺点                                                                                                                                     |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| Go + Chi                     | 单个二进制即可部署；并发模型成熟                                                                                     | 不能在 Workers 上运行；协议类型只能通过代码生成来共享；没有成熟的 JSX AST 工具，最终还得挂一个 Node 进程；`npx` 分发需要按平台打包二进制 |
| Rust + Axum                  | 性能高；可以编译成 wasm 跑在 Workers 上                                                                              | 产品形态还在验证阶段，迭代成本高；逻辑共享和 AST 方面的问题与 Go 相同                                                                    |
| TS + Express / Fastify / Koa | 生态成熟                                                                                                             | 绑定 `node:http`，Workers 上没有一等支持                                                                                                 |
| TS + NestJS                  | 结构完整                                                                                                             | 自带模块和依赖注入体系，与"框架只放在最外层"的原则冲突；冷启动慢                                                                         |
| TS + Elysia                  | 类型能力强                                                                                                           | 以 Bun 为主要运行时，而我们的分发以 Node 为主                                                                                            |
| TS + h3 v2                   | 基于 Web 标准，能同时在 Node 和 Workers 上运行                                                                       | OpenAPI、RPC 客户端以及 Workers 实时通道这几块的生态和实践少于 Hono                                                                      |
| **TS + Hono**                | 基于 Web 标准，Node 和 Workers 原生支持；`@hono/zod-openapi`、RPC 客户端、`secureHeaders` 都是现成的；体积小、无依赖 | 在 Node 上要经过一层适配器，吞吐不如 Fastify；不同运行时的 WebSocket 适配器不同                                                          |

## 决定

服务端使用 **TypeScript + Hono**。Hono 只允许出现在 `packages/server/src/interfaces/` 和 `entry/` 中，领域层和应用层不依赖它。

## 后果

- 协议、Patch、EditOp 和 AST 工具在四个运行时中只维护一份实现。
- 选错框架的代价只限于路由层。
- 协议包附带契约测试。如果将来出现性能瓶颈，可以按契约用其他语言重写 Hub，本地 Daemon 不受影响。
- 计算密集的模块（比如 CRDT、大文件 diff）可以用 Rust 编译成 wasm，供三个运行时共用，不需要改变服务端语言。

## 何时需要重新评估

- 单个 Hub 实例的实时连接数持续超过 Node 的承载能力。
- 产品重心转向不需要和浏览器共享逻辑的服务端功能。
- 放弃 Cloudflare Workers 部署形态。
