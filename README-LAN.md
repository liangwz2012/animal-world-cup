# Animal Cup 局域网运行说明

## 两种局域网模式

### 标准房间

从首页选择“局域网对战”。P1 手机连接后即可开始，P2 可以使用第二台手机加入；未连接的 P2 由 AI 接管。

### 现场挑战台

打开 `http://localhost:13000/lan-kiosk`。大屏会持续播放 AI 对战并展示二维码；两台手机加入后，双方可在手机或大屏上选队并确认开赛。比赛结束后保留比分 10 秒，然后回到 AI 展示画面等待下一组玩家。

## 启动

macOS 可以双击 `START-LAN.command`。脚本会：

1. 检查 Node.js 20 或更高版本。
2. 在缺少依赖时按 `pnpm-lock.yaml` 安装。
3. 在源码变化后重新构建。
4. 同时启动网页端口 `13000` 和手柄中继端口 `13001`。

开发时也可以运行：

```bash
pnpm install
pnpm dev:lan
```

## 手机无法访问时

- 大屏电脑和手机必须连接同一个局域网，访客 Wi-Fi 或开启“客户端隔离”的热点通常无法互访。
- macOS 防火墙需要允许 Node.js 接收入站连接。
- 手机访问终端显示的 `http://<局域网IP>:13000/pad`，不要使用 `localhost`。
- 电脑上还需允许 TCP `13001`，它负责传输手柄输入。
- 多网卡或 VPN 选错地址时，可以先运行 `LAN_IP=10.0.4.179 ./START-LAN.command` 指定地址。

局域网中继没有公网级账号系统。不要在路由器上转发或向公网暴露 `13001` 端口。

## 干净发布

源码包不要包含 `node_modules`、`.pnpm-store`、`.next` 或 `__MACOSX`。这些目录包含平台相关二进制、缓存和本机路径，并不会增加游戏功能。推荐直接使用：

```bash
git archive --format=zip --output=animal-world-cup-source.zip HEAD
```

真正的离线便携包应针对 macOS ARM、macOS Intel 和 Windows 分别构建，不能直接复制开发电脑上的依赖目录。
