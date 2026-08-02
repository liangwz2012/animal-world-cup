# M0 工具链冻结

冻结时间：2026-08-02

## 结论

| 项目 | 冻结版本 | 证据与理由 |
|---|---|---|
| Node.js | 24.13.1 LTS | 当前电脑实际版本；项目只接受 Node 24，避免 Current/EOL 版本漂移 |
| npm | 11.8.0 | 当前 Node 自带并实际验证；启用 engine-strict |
| LayaAir | 3.4.0 | 官方 GitHub 最新正式 release（2026-06-12），不再使用旧方案中的 3.3.11 |
| Galacean Engine | 1.6.13 | npm latest 与官方 GitHub 最新正式 release 一致 |
| 微信开发者工具 | 2.02.2607271 | 当前电脑已安装版本，CLI 路径已验证 |
| TypeScript | 5.9.3 | 采用成熟稳定线，避免在 M0 引入 TypeScript 7 新行为 |
| esbuild | 0.28.1 | 固定双候选代码构建器 |

机器可读版本、下载地址、完整性哈希和许可证来源见根目录 toolchain.lock.json。

## 官方能力证据

- LayaAir 3.4.0 官方仓库声明支持 Web、微信等小游戏发布，官方文档提供微信构建、开发者工具导入、真机预览、分包和远程资源流程。
- Galacean 1.6.13 官方文档提供 H5 与微信小游戏导出；微信产物包含 game.ts、game.json、project.config.json，随后执行 npm run dev/release 并导入微信开发者工具。
- 两个引擎仓库均为 MIT。引擎许可证通过不代表第三方模型、动画、纹理或音频自动通过，资产仍单独审核。

## 已发现的不一致

LayaAir 3.3 微信文档仍写“主包 + 分包不超过 20M”，Galacean 当前微信文档写“不超过 30M”，两者都链接微信官方分包文档。项目不把任一二手数字当发行结论：

- 内部硬目标保持主包 ≤3.4 MiB、本地包总量 ≤18 MiB；
- 构建脚本同时输出主包、普通分包和独立分包体积；
- M0 微信验收时以当日开发者工具/上传检查的真实结果为最终证据。

## 当前可复现状态

- Galacean 通过精确 npm 版本与 package-lock.json 安装。
- LayaAir 不使用 npm 上同名的非官方 1.0.1 包；由 tools/fetch-layaair.mjs 从官方 release 下载 3.4.0 库并校验 SHA-256。
- LayaAir IDE 尚未安装，Galacean 官方编辑器导出尚未执行。当前只能称“工具链版本冻结”，不能称“微信链路已验证”。

## 官方来源

- https://github.com/layabox/LayaAir/releases/tag/v3.4.0
- https://layaair.com/3.x/doc/released/miniGame/readme.html
- https://github.com/galacean/engine/releases/tag/v1.6.13
- https://www.galacean.com/engine/docs/platform/wechatMiniGame/
- https://nodejs.org/en/about/previous-releases
