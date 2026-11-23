# Docker Cloud Hub

单个镜像启动工作台/API（`8080`）与独立沙盒（`8081`），不依赖 Cloudflare。生产环境需通过 HTTPS 反向代理提供两个 **不同注册域** 的 origin，并在外壳域名开启 WebSocket 升级。不要将沙盒挂载为外壳域名的子路径，也不要使用共享注册域的两个子域名。Docker 本机调试可使用两个不同的 HTTP 回环端口。

1. 创建 GitHub OAuth App，回调地址为 `${AKASHA_HUB_ORIGIN}/auth/github/callback`。将 [`.env.example`](.env.example) 复制为 `deploy/docker/.env`，填写 `AKASHA_GITHUB_CLIENT_ID`、`AKASHA_GITHUB_CLIENT_SECRET` 和至少 32 字节随机 `AKASHA_HUB_SIGNING_SECRET`。配置组织/团队或逗号分隔的 GitHub 登录名白名单；未配置成员规则时无人拥有发布权限。不要提交 `.env`。
2. 在仓库根目录启动镜像。也可运行 `make hub-image IMAGE=akasha-hub:dev` 从仓库构建，并在下面的命令中换用本地镜像。反向代理在其他主机上时，使用仅代理主机可访问的端口绑定。

   ```bash
   docker run -d --name akasha-hub --env-file deploy/docker/.env \
     -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081 \
     -v akasha-hub-data:/data ghcr.io/vod-studio/akasha-artifacts:latest
   ```

3. 将两个域名解析到服务器。以下是同机部署的 [Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) 示例，入口需开放 `80` 和 `443`。把域名换成 `.env` 中的实际域名；Caddy 会转发 WebSocket 升级。

   ```caddyfile
   akasha.example.com {
   	reverse_proxy 127.0.0.1:8080
   }

   preview.example.net {
   	reverse_proxy 127.0.0.1:8081
   }
   ```

4. 登录浏览器工作台。在终端运行 `akasha login --hub <Hub origin>`，打开输出的 GitHub 登录链接，并粘贴一次性授权码。运行 `akasha mcp --hub <Hub origin>` 接入此 Hub；CLI 凭证保存于 `~/.akasha/hub-login.json`，文件权限为 `0600`。

数据库默认保存在持久卷的 `/data/akasha.db`，单容器使用，不与本机 Daemon 的 SQLite 文件混用。可配置 `DATABASE_URL` 选择 PostgreSQL；配置 `AKASHA_S3_BUCKET` 后版本源码从数据库改存对象桶，支持 AWS SDK 默认凭证链及兼容 S3 的自定义 endpoint 和 path-style。启动时执行幂等建表。备份须同时保留数据库和对象桶。每个 Hub 部署使用一个应用实例，以保持实时通道和写入顺序。

制品权限为 private（作者）、team（团队）、public（公开阅读）；「更多操作 → 创建分享链接」签发仅针对当前制品的有时效链接。反馈持久化，Agent 不在线时也可通过回执队列补拉。浏览器访问 Hub 链接时先尝试直连本机：只有已通过 `akasha login` 绑定该 Hub、Daemon 在线且持有相同 `publicId`（指定历史版本时也须存在）才切到本机工作台。此探测不传输制品内容或本机令牌，也不复制云端数据；拒绝本地网络权限、未命中或超时则走 Hub。

发布工作流创建正式版本后构建并发布 `ghcr.io/vod-studio/akasha-artifacts:<版本>` 与 `:latest`。健康检查为外壳域名下的 `/api/v1/health`。
