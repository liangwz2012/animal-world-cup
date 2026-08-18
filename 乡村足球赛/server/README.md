# 乡村足球赛云端服务

本目录包含三个相互独立的首发服务：好友房间 WebSocket、排行榜 HTTP API、只读远程配置。当前状态是本地代码和自动化测试完成，未部署到 `coaiz.com`。

## 共同安全要求

- `WX_APP_SECRET` 只允许写入服务器环境变量或密钥管理系统；不得写入客户端、仓库、日志和版本说明；
- 正式服务只通过 HTTPS/WSS 对外，Nginx/网关负责 TLS、请求大小限制、速率限制和访问日志脱敏；
- 微信公众平台必须登记 `coaiz.com` 的 request/socket 合法域名；
- 生产数据目录只允许服务账户读写，并纳入加密备份；
- `DEV_AUTH=1` 仅用于本机自动测试，严禁生产启用。

可复用的无凭据部署模板位于 `server/deploy/`：

- `nginx-rural-football.conf.example`：三条正式路径、WSS Upgrade、请求/连接限流；
- `rural-football-*.service.example`：三个独立 systemd 服务，固定使用非特权账户并只监听 `127.0.0.1`；
- `rural-football.env.example`：只列出环境变量名，真实值只能放到服务器的 `0600` 环境文件。

部署后执行只读健康检查：

```bash
npm run health:production
```

该命令要求正式地址使用 HTTPS/WSS，并同时验证配置结构、排行榜服务身份和好友房间 WebSocket 握手；任何 404、超时或错误响应都会返回非零退出码。

## 1. 好友对战房间

单实例 WebSocket 中继服务负责房主/红方与好友/蓝方分配、配置冻结、热身、开球、输入、权威快照和短暂断线恢复，但不运行比赛物理。

```bash
WX_APP_ID=xxx WX_APP_SECRET=xxx HOST=127.0.0.1 PORT=8787 \
  node server/friend-room-server.mjs
```

正式外部入口：`wss://coaiz.com/rural-ws`。由 Nginx 终止 TLS 时反代到 `127.0.0.1:8787`。等待房间 10 分钟未开赛即过期，房间有 30 分钟硬上限，断线身份保留 20 秒。

房间允许标准行政区名称；用户自定义队名必须通过微信 `msg_sec_check`。服务端使用 `scene=2`、`version=2`，未配置微信凭据或检查失败时拒绝自定义名称，避免未审文本进入好友局。

本地测试：

```bash
npm run test:content-security
npm run test:friend-server
npm run test:friend-flow
```

## 2. 排行榜

排行榜服务提供微信身份会话、主动授权的昵称/头像、地区资料、多指标榜单和账户删除。昵称写入前必须通过微信文本内容安全；认证、资料、排位签发/结算、删除和榜单读取均有服务端频率限制，Nginx 再做第二层限流。

```bash
WX_APP_ID=xxx WX_APP_SECRET=xxx TRUST_PROXY=1 HOST=127.0.0.1 PORT=8788 \
  RANK_DATA_FILE=/var/lib/rural-football/leaderboard.json \
  node server/leaderboard-service.mjs
```

正式外部入口：`https://coaiz.com/rural-rank/v1`。

主要接口：

- `POST /v1/auth`：用 `wx.login` code 换取短期会话；
- `PUT /v1/profile`：保存用户主动授权的昵称和头像；
- `PUT /v1/region`：保存榜单地区；
- `POST /v1/ranked-matches`：由服务端签发排位比赛凭证；
- `POST /v1/ranked-matches/:id/result`：校验时长、比分和单次结算后写入统计；
- `GET /v1/leaderboards`：读取各指标榜单；
- `DELETE /v1/account`：删除档案、战绩、比赛凭证和会话。

旧的 `POST /v1/results` 直接上报接口固定返回 410，客户端不能自行伪造排位结果。未配置微信内容安全凭据时，公开昵称写入会以 503 失败关闭。当前 JSON 原子落盘仅适用于首发单实例；启用多实例前必须迁移到具备单写一致性的数据库，迁移真实生产数据需要另行授权。

本地测试：

```bash
npm run test:leaderboard-service
npm run test:leaderboard-client
npm run test:deployment
```

## 3. 远程功能开关

客户端固定读取 `https://coaiz.com/rural-football/config/v1`。配置服务只读，不接受远程写入；配置不可用时客户端回落到包内全关闭状态，单机仍可开赛。

```bash
cp server/remote-config.example.json /var/lib/rural-football/remote-config.json
HOST=127.0.0.1 PORT=8789 \
  REMOTE_CONFIG_FILE=/var/lib/rural-football/remote-config.json \
  node server/remote-config-service.mjs
```

Nginx 示例：

```nginx
location = /rural-football/config/v1 {
  proxy_pass http://127.0.0.1:8789/v1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

首发配置保持排行榜、好友、广告三个 `enabled` 均为 `false`。只有服务健康检查、微信后台合法域名、隐私指引和双真机均通过后，才允许逐项开启。

```bash
npm run test:remote-config-service
curl -fsS https://coaiz.com/rural-football/config/v1
```

上面的 `curl` 只用于部署后的真实验收；本地测试通过不能表述为生产服务已接通。
