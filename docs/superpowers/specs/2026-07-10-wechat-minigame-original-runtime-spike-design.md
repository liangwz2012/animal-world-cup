# 微信小游戏原版比赛 Runtime 静态移植可行性验证设计

日期：2026-07-10  
状态：已确认设计，等待规格审阅后实施

## 1. 背景与实测结论

目标产品是微信“小游戏”板块中的横屏手机游戏，不是普通小程序页面，也不使用 `web-view` 套壳。手机版网页是体验与行为的唯一真相源，第一阶段只验证单机比赛 1:1 移植的可行性，好友联机后置。

仓库中已有两条尝试复用原版 Pixi 比赛引擎的路线，但在微信开发者工具 Stable 2.01.2510290 中均未跑起原版比赛：

- `wechat-minigame/` 的 runtime 资源键与加载器查找键不一致，`standalone-match.js` 未注册 `window.__startStandaloneMatch`，随后自动回退到自研 Canvas 简化比赛。当前可见的低还原效果来自兜底内核，不是原版引擎。
- `wechat-minigame-high-fidelity-production/` 已成功加载 Pixi、微信环境适配层和 shim，但通过 `new Function` 执行 `match.rebuilt.js` 时得到 `runner is not a function`，原版比赛逻辑未启动。

这些结果证明旧工程当前不可作为生产基础，也证明 Pixi 与基础 shim 已经能在开发者工具中加载。尚未验证的关键点是：把原版 runtime 静态打包并移除动态代码生成后，原版比赛能否在微信小游戏环境完成渲染与交互。

## 2. 验证目标

建立独立目录 `wechat-minigame-original-runtime-spike/`，用最小范围回答一个问题：

> 原版 `match.rebuilt.js` + Pixi 4.8.9 能否在不使用 `eval`、`new Function` 和兜底比赛的前提下，在微信小游戏中运行一场可操作的单机比赛？

只有同时通过微信开发者工具和真机预览，才宣布该路线可行。Node 模拟启动、静态语法检查或出现任意自研球场画面都不计为通过。

## 3. 范围

### 本次包含

- 微信小游戏横屏入口与单屏 Canvas。
- 原版 Pixi 4.8.9 渲染器。
- 原版比赛引擎、AI、物理、规则、状态机和镜头。
- 阿根廷对葡萄牙、国际球场、经典足球、固定阵型与标准难度。
- 原版 7v7，共 14 名球员。
- 最小触控输入：移动、传球、射门。
- 原版资源读取、图片加载和首轮中文数据读取。
- 启动阶段诊断、资源缺失诊断、帧率采样和运行时身份标记。

### 本次不包含

- 完整选队大厅、全部 HUD、统计面板、结果页美化。
- 全部球队、全部阵型、多语言、分享、音频精修。
- 好友联机、房间服务、排行榜、支付或运营能力。
- Cocos 比赛逻辑或任何自研简化比赛兜底。

## 4. 目录与隔离策略

```text
wechat-minigame-original-runtime-spike/
├── game.js                    # 微信小游戏静态入口
├── game.json                  # 横屏与分包配置
├── project.config.json        # compileType=game
├── package.json               # 构建和验证命令
├── src/
│   ├── platform/              # 微信 Canvas/Image/存储/触摸/计时适配
│   ├── boot/                  # 固定顺序启动与阶段诊断
│   └── input/                 # 最小触控到 __touchInput 的桥接
├── vendor-src/                # 从网页同步的只读原始 runtime 输入
├── generated/                 # 构建期生成的静态 runtime，不手工修改
├── assets/                    # 本次验证所需的最小原版资源集合
├── tools/                     # 静态转换、资源同步、禁止项扫描
└── tests/                     # 启动、身份、状态轨迹和截图验收
```

现有 `wechat-minigame/`、`wechat-minigame-high-fidelity-production/` 和 `wechat-minigame-cocos-production/` 均保持原样。新工程可以复用其中已验证的适配代码或资源生成思路，但不直接在旧目录继续堆补丁。

## 5. 静态化方案

### 5.1 固定加载顺序

构建产物按以下顺序以静态模块加载：

1. 微信最小平台适配层；
2. Pixi 4.8.9；
3. Swig/MessageFormat 的静态兼容实现；
4. 原版 shim；
5. 静态化后的 `match.rebuilt.js`；
6. 静态化后的 `standalone-match.js`；
7. 固定比赛参数与触控输入。

入口不得读取 JS 文本后再执行，不得吞掉任一步错误。

### 5.2 动态代码生成清理

构建脚本扫描原始 runtime 中的 `eval` 和 `new Function`。已知动态构造点按用途处理：

- 外层脚本加载器：改为静态 `require`/模块导入。
- 状态机命名构造器：改为普通构造函数工厂，保留继承、生命周期和信号连接语义，不依赖动态函数名。
- MessageFormat：只为本次中文资源在构建阶段预编译消息函数。
- Swig：本次资源集中没有 HTML/Swig 模板文件；若启动路径仍调用编译接口，则在构建阶段生成对应函数并禁止运行时编译。

最终小游戏产物必须通过禁止项扫描：业务与 runtime 代码中 `eval`、`new Function` 数量均为 0。

### 5.3 资源策略

本次只同步两队、国际球场、经典足球、共用球员骨骼/贴图、必要语言与配置。资源索引在构建阶段生成，运行时使用微信包内路径与 `wx.getFileSystemManager`/图片 API，不使用同步 XHR，也不把完整资源库塞进一个 Base64 JSON。

## 6. 运行时身份与禁止回退

为防止再次把简化比赛误判为原版，引擎启动成功后必须同时满足：

- `window.__startStandaloneMatch` 是函数；
- `window.__matchGame` 存在，且具有原版 `pitch`、`stage`、`renderer`；
- `window.PIXI.VERSION` 为 `4.8.9`；
- 运行时设置只读标记 `window.__ORIGINAL_RUNTIME_ACTIVE__ = true`；
- 屏幕角落在开发验证模式显示 `ORIGINAL RUNTIME` 水印；
- 工程中不存在 `AnimalCupGame`、Cocos `AnimalFootballGame` 或其他自研比赛 fallback 的引用。

任一条件不满足时，画面显示明确失败阶段与错误，不进入其他比赛实现。

## 7. 数据流

```text
微信触摸事件
  → 最小输入桥
  → window.__touchInput
  → 原版控制器/AI/物理/规则
  → 原版 pitch 状态
  → 原版 Pixi renderer
  → 微信主 Canvas
```

平台适配层只能转换环境 API，不修改比赛数值、状态转移、AI 决策、物理步长或镜头算法。

## 8. 错误处理与诊断

启动过程使用固定阶段编号：平台、Pixi、shim、比赛模块、资源、比赛实例、首帧。每阶段记录开始、完成、耗时和失败原因。

- 缺少资源时输出规范化资源键和实际查找路径。
- 模块注册失败时输出缺失模块名，不继续启动。
- 首帧超时时输出 Pixi renderer、stage、pitch 和资源队列状态。
- 所有错误保留在控制台，并在 Canvas 上显示短错误码。
- 禁止用空 `catch`、只打印警告后继续或自动切换内核掩盖错误。

## 9. 验收闸门

### 闸门 A：静态构建

- 构建成功；
- 产物无 `eval`、`new Function`；
- `project.config.json` 的 `compileType` 固定为 `game`，`game.json` 为横屏；
- 资源索引中的所有文件真实存在。

### 闸门 B：微信开发者工具

- 无黑屏和启动红错；
- 显示原版国际球场、原版球员、原版足球与原版镜头；
- 14 名球员按原版 7v7 阵型出现；
- `ORIGINAL RUNTIME` 身份检查通过；
- 能完成开球、移动、传球、射门、进球；
- 连续运行 3 分钟不崩溃、不切换实现。

### 闸门 C：真机预览

- 至少一台 iPhone 与一台主流 Android 真机能进入比赛；
- 触摸方向和按钮映射正确；
- 图片无大片缺失、透明或错位；
- 连续运行 3 分钟，无崩溃、明显内存泄漏或持续低于 25 FPS；
- 真机画面可确认来自原版 runtime，而非替代实现。

## 10. 可行性结论规则

- A、B、C 全部通过：路线 2 可行，随后单独设计完整单机 1:1 迁移。
- A 通过、B 失败：记录不可跨越的微信运行时或 Pixi 兼容障碍，停止扩展功能。
- A、B 通过、C 失败：只处理真机平台差异；在真机通过前不宣布可行。
- 静态化后仍需大规模重写原版 AI、物理或规则才能运行：路线 2 判定失败，切换为“提取原版逻辑核心 + Cocos 表现层”的后备路线，不继续伪装成原版整体移植。

## 11. 实施边界

本规格只授权创建和验证独立 spike 工程，不授权删除或覆盖现有工程，不包含上传、发布、提审或服务器变更。开发者工具本地编译属于验证范围；真机预览二维码生成后由项目所有者扫码验收。
