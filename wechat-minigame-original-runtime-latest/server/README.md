# 好友对战房间服务

这是小游戏好友局的单实例 WebSocket 中继服务。服务端固定分配房主/红方与好友/蓝方，校验配置、准备、热身观战、开球、输入和权威快照，但不运行比赛物理。

## 正式运行

服务端默认使用微信 `code2Session` 校验 `wx.login` 的一次性 code。AppSecret 只可放在服务端环境变量中：

```bash
WX_APP_ID=xxx WX_APP_SECRET=xxx HOST=0.0.0.0 PORT=8787 \
  node server/friend-room-server.mjs
```

线上必须通过有效 TLS 证书暴露为 `wss://`，并在微信公众平台配置 Socket 合法域名。可以由反向代理终止 TLS，也可以同时设置 `TLS_CERT_PATH` 和 `TLS_KEY_PATH` 让本服务直接监听 WSS。

## 本地自动测试

只有显式设置 `DEV_AUTH=1` 才允许 `devPlayerId` 身份；该模式没有生产身份强度，禁止上线：

```bash
DEV_AUTH=1 HOST=127.0.0.1 PORT=18787 node server/friend-room-server.mjs
node tools/test-friend-room-server.mjs
```

测试脚本会自行启动随机端口服务，因此通常只需执行第二条命令。

## 快照二进制头

权威帧采用 64 字节固定头，之后紧跟不超过 256 KiB 的原始 Frame payload：

- `0..3`：ASCII `ACFS`
- `4`：协议版本 `1`
- `5`：类型 `1`（snapshot）
- `6..7`：大端头长度 `64`
- `8..29`：22 字符 `roomId`
- `30..51`：22 字符 `matchId`
- `52..55`：大端 `uint32 seq`
- `56..59`：大端 payload 长度
- `60..63`：保留位，必须为零

邀请生成时双方球队和阵型即冻结，好友加入后自动视为可开赛，不需要额外“准备”按钮。等待房间 10 分钟未进入正式局即过期；所有房间有 30 分钟硬上限；断线身份保留 20 秒。房主等待期间可进行 AI 热身，好友可选择观战；`queue_after_warmup` 表示本局热身结束后自动进入正式加载，正式局会签发新的 `matchId` 并从 0:0 开始。

## 排行榜服务

排行榜 HTTP 服务与房间服务是两个独立进程，避免榜单读写影响实时帧中继。它提供微信身份会话、主动授权的昵称/头像、积分/胜场/进球/胜率/零封/连胜榜，以及账号删除接口。

```bash
WX_APP_ID=xxx WX_APP_SECRET=xxx HOST=127.0.0.1 PORT=8788 \
  RANK_DATA_FILE=/var/lib/animal-football/leaderboard.json \
  node server/leaderboard-service.mjs
```

- 生产环境由 Nginx 终止 TLS，并反代到本机 `127.0.0.1:8788`；小游戏端只填写登记过的 `https://域名/animal-rank/v1`，见 `src/net/leaderboard-service-config.js`。
- `WX_APP_SECRET`、服务器密码和会话密钥只可放在服务端环境变量或密钥管理系统，绝不能写进客户端、仓库或版本说明。
- 数据文件必须位于备份磁盘并限制为运行账户可读写；当前实现是单进程 JSON 原子落盘，适合首发单实例。扩容为多实例前需迁移到 SQLite/PostgreSQL 等单写入存储。
- 用户只有主动点击“加入排行榜”才请求昵称和头像；普通开局与浏览公开榜单不会发起微信登录。会话有效期为 7 天，过期后仅在用户提交联网资料/成绩时静默刷新。
- `DELETE /v1/account` 会删除该玩家的昵称、头像、统计、去重记录及全部会话。上线时应在“我的档案”提供此入口，并在隐私指引中写明联系渠道。

服务端自动化测试：

```bash
npm run test:leaderboard-service
```
