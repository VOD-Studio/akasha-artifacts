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

### 设计分享与管理员策略

所有者在设计的分享面板中选择成员、邮箱、部署配置的 GitHub 组织或其中的团队，并授予查看、批注或编辑。将生成的邀请地址发给收件人；Hub 不代发邮件。点名使用 GitHub 数字账号 ID，邮箱需由 GitHub 验证。收件人登录后接受；把定向邀请转给其他账号不会给对方授权。组织和团队成员可直接打开设计，离开对应范围后不再凭该授权访问。只有普通外部链接允许未登录持有者使用，且可以固定到版本或画板。

第一次定向授权会停止继承制品原来的 `team`／`public` 访问范围；同时存在的、仍允许的普通链接需单独管理。选择「仅本人」会撤销全部邀请和普通链接，也不再接受升级前签发的旧链接。降权、到期或撤销后，已打开的页面、收藏和原书签的下一次访问也按现有权限判断。批注面向人，不进入作者 Agent 的反馈队列；分享策略不禁止有读取权的用户导出文件，也无法收回已经下载的副本。

将管理员的 **GitHub 数字 ID** 用逗号分隔填入 `AKASHA_HUB_ADMIN_IDS`，重新启动 Hub。管理员访问 `/admin/sharing/<制品公共 ID>`，分别设置「外部链接」和「外部邮箱」的 Hub 默认值或该设计的例外。不授予管理员制品内容访问权。默认允许外部链接，不允许外部邮箱；已在 Hub 登录并验证过邮箱的内部成员仍可收到邮箱邀请。关闭外部链接也会阻止非成员通过旧 `public` 书签读取设计，不会影响另外允许的定向邀请。

GitHub OAuth 需要 `user:email`；配置组织时还需要 `read:org`，如组织启用了 OAuth 应用限制，须完成组织审批。升级后的已有账号若不能验证身份，请重新登录。Hub 不把 GitHub 访问令牌发给浏览器或 CLI，数据库中的凭据使用部署签名密钥派生的密钥加密；备份和迁移时请单独保管 `AKASHA_HUB_SIGNING_SECRET`。更换此密钥后用户需重新登录，原签名链接也会失效。

个人预览只在本机已通过 `akasha login` 绑定该 Hub、Daemon 在线且持有相同 `publicId`（历史版亦须存在）时优先使用本机。邀请、分享链接或已启用定向授权的工作区留在 Hub。端口探测不传输制品内容或本机令牌，也不复制云端数据。

在 Hub 作品库中点设计标题是个人预览；要与同事打开同一份画布，选「打开协作画布」或「复制协作画布链接」。这个地址只选择 Hub，不授予访问权限；收件人仍需已有授权。

发布工作流创建正式版本后构建并发布 `ghcr.io/vod-studio/akasha-artifacts:<版本>` 与 `:latest`。健康检查为外壳域名下的 `/api/v1/health`。
