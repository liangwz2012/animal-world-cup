# 《乡村足球赛》3D 技术架构

> 文档版本：1.0
> 日期：2026-08-02
> 决策状态：比赛核心与平台边界已定；渲染引擎等待 M0 在 LayaAir/Galacean 中决胜

## 1. 架构目标

1. 3D 引擎可在 M0 后锁定，但比赛规则、资源清单和微信服务不被引擎绑死。
2. 微信主包、本地分包和远程资源有可测量预算，任何地域资源失败都能本地开赛。
3. 单机固定步长模拟可重放、可测试，并为后续服务端权威对局保留一致数据结构。
4. 角色和九个地域家族使用共享骨架、材质和套件，避免每个地区复制完整资产。
5. 所有构建、资产转换和验收可以通过命令行重复执行，不依赖某个 AI 会话或编辑器手工状态。

## 2. 总体分层

```text
微信小游戏壳层
  ├─ PlatformPort：登录/分享/存储/网络/文件/生命周期/安全区
  ├─ AppShell：启动、页面路由、设置、错误恢复
  ├─ ContentRuntime：清单、分包、远程包、校验、缓存、降级
  ├─ MatchCore：固定步长足球模拟、AI、规则、重放
  ├─ Presentation：相机、动画、音效、VFX、HUD
  ├─ RenderPort：LayaAir 或 Galacean 的唯一适配层
  └─ ServicePort：身份、排行、赛季、好友房、分析

离线生产
  ├─ BlenderSource：角色/场景/动作源文件与脚本
  ├─ AssetCompiler：LOD、图集、压缩、GLB、清单
  ├─ CultureRegistry：资料、许可、审核与版本
  └─ QualityGates：包体、资源、截图、性能、真机证据
```

依赖方向只允许从上层业务调用下层端口。`MatchCore` 不导入引擎、微信或 UI 包。

## 3. 新旧版本隔离

3D 项目放在现有项目的并列目录 `next3d/`，构建输出也独立：

```text
乡村足球赛/
  src/                         现有 2D 版本，M0/M1 不改运行逻辑
  next3d/
    apps/
      wechat/                  微信壳与平台适配
      web-preview/             非正式网页调试壳
    packages/
      match-core/              纯 TypeScript 比赛模拟
      game-data/               球员、地区、球衣和规则配置
      content-runtime/         资源清单、校验、缓存和降级
      presentation/            引擎无关表现意图
      render-port/             引擎接口
      render-laya/             M0-A，决策后保留或归档
      render-galacean/         M0-B，决策后保留或归档
      platform-wechat/         微信接口
      service-client/          可选线上服务客户端
      ui/                      HUD 与页面状态
    assets-src/                Blender、纹理、动作与许可元数据
    assets-built/              生成物，不手改
    tools/                     构建、审计和验收
    tests/
  release-3d/                  本地构建输出，不与 2D release 混用
```

M0 结束后，未选中的 `render-*` 移到 `experiments/engine-m0-archive/` 并冻结。正式包不能同时带两个引擎。

## 4. 比赛核心

### 4.1 时间模型

- 固定模拟频率：30 Hz；
- 渲染循环：30/45/60 Hz，自行插值；
- 单帧最多追赶 3 个模拟步，超过时丢弃累积时间并记录性能事件；
- 所有计时使用整数 tick，不用墙钟浮点累计决定胜负；
- 暂停只停止单机 tick；在线模式由服务端时间继续。

### 4.2 数值与确定性

- 位置与速度在核心中使用统一米制坐标和明确精度量化；
- 随机行为使用带种子的 PRNG，种子写入赛局头；
- 物理只包含球体、胶囊、平面、线段和简化球门网阻尼；
- 不依赖 Bullet、PhysX、Ammo 或引擎刚体决定规则结果；
- 三角网格只用于视觉和射线提示，规则碰撞使用导出的简化代理；
- 每 30 tick 计算状态摘要哈希，用于重放和未来客户端/服务端偏差检测。

### 4.3 核心状态

```ts
type MatchState = {
  tick: number;
  phase: "kickoff" | "playing" | "stoppage" | "penalty" | "finished";
  scoreHome: number;
  scoreAway: number;
  ball: BallState;
  players: PlayerState[];
  commands: MatchCommand[];
  rngState: number;
};
```

`MatchCommand` 只表达移动、传球、射门、冲刺、抢断、切人和暂停意图。渲染层不能直接改位置、比分或体力。

### 4.4 AI

- 队伍战术：保持宽度、支援持球、回防、盯人和门将区域；
- 单人行为：感知 → 评分候选 → 选择 → 执行；
- 路径使用球场导航网格/走廊，不做完整动态 NavMesh；
- 难度调整反应延迟、感知误差、决策频率和射门选择，不给 AI 透视或速度作弊；
- M1 单机 AI 与未来服务端 AI 共享纯 TypeScript 包。

## 5. 表现意图与引擎端口

业务层只生成表现意图：

```ts
interface RenderPort {
  boot(canvas: unknown, quality: QualityProfile): Promise<void>;
  loadScene(manifest: SceneManifest): Promise<SceneHandle>;
  spawnPlayer(spec: PlayerVisualSpec): PlayerVisualHandle;
  applyFrame(frame: PresentationFrame, alpha: number): void;
  setQuality(profile: QualityProfile): Promise<void>;
  captureProbe(id: string): Promise<ProbeResult>;
  release(scope: "match" | "scene" | "all"): Promise<void>;
}
```

端口约束：

- 引擎实体句柄不能泄漏进 `MatchCore`；
- 动画事件只能通知“触球关键帧已到”，最终触球 tick 仍由核心决定；
- 材质、LOD、实例化和阴影只在渲染端实现；
- 两个 M0 端口必须消费同一 `PresentationFrame`；
- 截图探针返回相机、Draw Call、三角面、纹理内存估算和缺失资源列表。

## 6. 内容清单

每个可下载包有独立清单：

```json
{
  "schemaVersion": 1,
  "packId": "region-southwest-mountain-v1",
  "contentVersion": "1.0.0",
  "minimumClient": "0.1.0",
  "kind": "region-family",
  "sizeBytes": 0,
  "sha256": "build-generated",
  "dependencies": ["core-players-v1", "generic-stadium-v1"],
  "assets": [],
  "cultureReview": "approved",
  "licenseReview": "approved",
  "fallbackPack": "generic-stadium-v1"
}
```

`sizeBytes`、哈希和资产条目由构建工具生成，源文件不得手填假值。没有通过文化与许可审核的包只能标记 `quarantine`，发布构建拒绝引用。

## 7. 微信包体与资源策略

### 7.1 项目门禁

- 主包目标：≤3.4 MiB；硬上限：≤4 MiB；
- 主包 + 本地分包目标：≤18 MiB；项目硬上限继续保持 ≤20 MiB；
- 实际平台额度在 M0 通过微信后台和开发者工具核实后才可更新；
- 所有数字按上传产物计算，不用源目录或 gzip 猜测。

### 7.2 建议分配

| 包 | 内容 | 目标上限 |
| --- | --- | ---: |
| 主包 | 启动、路由、平台端口、精简引擎模块、基础 UI、清单 | 3.4 MiB |
| `core-3d` 本地分包 | 共享 Shader、比赛场景壳、球和基础特效 | 3.2 MiB |
| `players-base` 本地分包 | 一套骨架、基础角色 LOD、M1 动作和 2 套球衣 | 4.2 MiB |
| `stadium-generic` 本地分包 | 通用球场、低档远景、基础观众 | 2.4 MiB |
| `region-southwest` 本地分包 | M1 西南山地主场增量 | 3.6 MiB |
| `region-data` 本地分包 | 行政区、球衣模板、地域配置 | 0.8 MiB |
| 总余量 | 平台生成文件、差异和紧急修复 | 0.4 MiB |

这是设计预算，不是已测结果。任一包超限时先压缩/复用/远程化资源，不能通过删除本地通用兜底“过门”。

### 7.3 远程资源

- 其余 8 个地域家族、34 省叠加、精品市县包和高质量可选资源走 HTTPS CDN；
- 远程只允许数据、GLB、压缩纹理、音频和清单，不加载远程 JavaScript、WASM 或可执行 Shader 源；
- URL 使用内容哈希，不覆盖同名旧文件；
- 下载到微信文件缓存后先验大小和 SHA-256，再原子切换当前版本；
- 缓存采用 LRU，保留当前主场、通用球场和最近两个地域包；
- 清理缓存不能删除用户存档、待同步赛果或基础角色。

## 8. 资源加载状态机

```text
Unrequested
  → ResolvingManifest
  → CheckingLocal
  → LoadingSubpackage / DownloadingRemote
  → Verifying
  → Mounting
  → Ready

任一步失败
  → RetryOnce
  → FallbackReady 或 RecoverableError
```

- 每个状态有超时、进度和可读错误；
- 同一包并发请求合并为一个 Promise；
- 离开页面取消未需要的下载，但保留可复用缓存；
- 比赛开始后禁止加载影响规则的场景版本；视觉可选资源只能在安全帧追加；
- 资源版本不一致时不进入同一在线房。

## 9. 质量档与内存管理

启动探针采集：平台、WebGL 版本、最大纹理尺寸、扩展、内存等级、首个小场景 CPU/GPU 近似耗时和 DPR。

自动档策略：

1. 先按设备能力选择高/中/低；
2. 前 30 秒若连续 5 秒低于目标帧率，降一级；
3. 比赛中只降不升；返回首页后可重新评估；
4. 收到内存警告依次释放远程高 LOD、远景动画、观众、阴影贴图和非当前材质；
5. 基础球、球员 LOD1、场地线和操作 UI 永不被自动卸载。

中档运行目标：纹理常驻 ≤96 MiB、可见三角面 ≤300k、Draw Call ≤100–120、同屏骨骼角色 10–14 名。

## 10. 存储与迁移

本地存储分为：

- `settings`：画质、音效、操作；
- `profile`：地区、队名、球衣、阵容；
- `progress`：本地赛季和奖杯；
- `outbox`：待同步赛果和分析事件；
- `cache-index`：资源包版本与文件路径。

每块独立 schema 版本。迁移失败时备份旧值、回退安全默认，并允许导出匿名诊断；不能因缓存损坏清空球队和赛季。

现有 2D 存档只迁移地区、队名、球衣颜色和已支持的荣誉映射；3D 不认识的字段保留在旧存档，不覆盖原值。

## 11. 在线服务架构

### 11.1 分阶段状态

- M1–M4：本地实现和可替换假端口，页面不展示虚构线上数据；
- M5：接入真实 HTTPS/WSS 服务、微信身份、排行和好友房；
- 未完成域名、备案、证书、隐私和压测前，只能称为“客户端接口完成”，不能称为“在线功能完成”。

### 11.2 服务边界

- REST：配置、赛季、榜单页、球队公开资料、内容清单；
- WSS：房间、输入命令、状态快照、重连；
- 服务端权威：时间、球员位置合法性、触球、比分、胜负、积分和奖励；
- 客户端预测：本地移动和动画；服务端纠偏必须可回放；
- 资源 CDN 与业务 API 域名分离，均使用 HTTPS。

### 11.3 离线队列

- 只有服务端签发赛局或明确允许的异步挑战能进入线上积分；
- 普通单机赛果只保存在本机，不在联网后自动变成排位分；
- `outbox` 事件带幂等 ID、版本和过期时间；
- 同步失败指数退避，最多保留 7 天；
- 用户清除数据时一并删除未上传队列。

## 12. 安全与隐私

- 客户端不包含 AppSecret、CDN 写权限、数据库凭据或管理员令牌；
- 自定义文本在本地做基础检查，服务端做最终内容安全与审计；
- 分享令牌短期有效，不含 openid、精确地区路径之外的隐私或可伪造赛果；
- 排位客户端只发送输入，不直接提交最终比分；
- 远程清单使用 HTTPS、哈希和可选签名，拒绝路径穿越和非白名单扩展；
- 开发期 MCP/Blender 执行能力不进入游戏包，也不对生产网络开放；
- 不采集 GPS、通讯录、麦克风或相册。

## 13. 构建与证据

每个候选和正式构建输出机器可读报告：

```text
build-report.json
  engine/version/commit
  platform/build-time
  main-package-bytes
  local-subpackages[]
  remote-packs[]
  script/module-list
  asset-count/by-type
  shader-variants
  texture-formats
  license-summary
  git-dirty-state
```

真机证据包含设备型号、系统、微信版本、场景版本、画质档、10 分钟帧时间、峰值内存近似、热机温度观察、截图和错误日志。没有证据文件的“已验证”不进入 `STATUS.md`。

## 14. 架构决策记录

需要独立 ADR 的决策：

1. M0 引擎胜者与失败证据；
2. 微信真实包体规则和最终分包布局；
3. 球物理参数与确定性策略；
4. M5 服务端协议和部署区域；
5. 精品真实村队/赛事授权内容；
6. 任何 M0 后的引擎迁移请求。

其他可逆的 UI、配色和小功能不滥用 ADR。
