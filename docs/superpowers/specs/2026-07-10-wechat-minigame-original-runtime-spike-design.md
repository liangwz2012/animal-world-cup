# 微信小游戏原版比赛 Runtime 静态移植可行性验证设计

日期：2026-07-10  
状态：微信开发者工具 B2 可见原版比赛已通过；真机触摸、性能与稳定性待验证

## 1. 背景与实测结论

目标产品是微信“小游戏”板块中的横屏手机游戏，不是普通小程序页面，也不使用 `web-view` 套壳。手机版网页是体验与行为的唯一真相源，第一阶段只验证单机比赛 1:1 移植的可行性，好友联机后置。

仓库中已有两条尝试复用原版 Pixi 比赛引擎的路线，但在微信开发者工具 Stable 2.01.2510290 中均未跑起原版比赛：

- `wechat-minigame/` 的 runtime 资源键与加载器查找键不一致，`standalone-match.js` 未注册 `window.__startStandaloneMatch`，随后自动回退到自研 Canvas 简化比赛。当前可见的低还原效果来自兜底内核，不是原版引擎。
- `wechat-minigame-high-fidelity-production/` 已成功加载 Pixi、微信环境适配层和 shim，但通过 `new Function` 执行 `match.rebuilt.js` 时得到 `runner is not a function`，原版比赛逻辑未启动。

这些结果证明旧工程当前不可作为生产基础。已有记录只证明 Pixi 与基础 shim 能在 Node mock 或开发者工具的部分启动阶段被加载，**没有证明原版引擎已经在微信主 Canvas 画出首帧**。尚未验证的关键点是：把原版 runtime 静态打包并移除动态代码生成后，原版比赛能否在微信小游戏环境完成渲染与交互。

### 1.1 既有尝试失败审计

本次审计以当前源码、既有工作日志和开发者工具配置为证据。结论按“已证实”“高概率”“尚未验证”区分，不把推测写成成功事实。

#### 已证实问题 A：旧加载器根本找不到生成脚本

`wechat-minigame/src/runtime/web-runtime-game.js` 请求的键形如：

```text
runtime/match-runtime-min/standalone-match.js
```

但 `runtime/runtime-text-assets.js` 中真实键是：

```text
standalone-match.js
```

加载器的三个候选键都不会命中真实键。每个脚本加载错误又被单独捕获后继续执行，最终 `window.__startStandaloneMatch` 未注册。随后工程自动进入自研 Canvas 比赛，因此“有画面”曾被误认为“原版引擎基本跑通”。

#### 已证实问题 B：两条旧路线都依赖微信不允许的动态执行

- `wechat-minigame/` 的外层加载器包含 `eval` 和三处 `new Function`；
- `wechat-minigame-high-fidelity-production/` 用 `new Function` 执行 `match.rebuilt.js` 和 `standalone-match.js`；
- 原始 `match.rebuilt.js` 内部另有三处 `new Function`，分别用于 MessageFormat、Swig 和 `core/states` 状态构造；独立 `swig.min.js` 还有一处。

因此只把外层脚本文本改成静态 `require` 仍不够。最终产物必须同时消除引擎内部的动态构造点，否则开发者工具运行或代码安全检查仍会失败。

#### 已证实问题 C：两套 Canvas 归属策略都不正确

- `wechat-minigame/` 用 `__claimNextCanvasAsScreen` 把下一次 `document.createElement('canvas')` 指向主 Canvas，但创建后没有清除此标记，后续离屏纹理 Canvas 也会重复拿到主 Canvas；
- `wechat-minigame-high-fidelity-production/` 的 `document.createElement('canvas')` 每次都调用 `wx.createCanvas()`，没有把 Pixi Renderer 的首个 Canvas 绑定到已显示的主 Canvas。即使渲染成功，也可能画在不可见的离屏 Canvas 上。

新适配层必须采用“一次性领取”：Pixi Renderer 首次创建 Canvas 时返回主 Canvas 并立即清除领取标记；后续创建全部返回独立离屏 Canvas。

#### 已证实问题 D：错误被多层吞掉，形成虚假进展

- 分包加载失败仍调用成功路径；
- 六个 runtime 脚本逐个失败后仍继续；
- 25 秒未创建原版画面就切回简化内核；
- HUD 自身也大量使用防御性 `catch`，可能隐藏首次真实错误。

这套容错适合线上降级，不适合可行性验证。新 spike 不允许 fallback，任一阶段失败必须停在明确错误页。

#### 已证实问题 E：旧包从未达到可提审的包体结构

- `wechat-minigame/` 当前目录约 26.17 MiB，其中 runtime 约 18.21 MiB、其余约 7.97 MiB；
- `wechat-minigame-high-fidelity-production/` 当前目录约 30.47 MiB，且 `game.json` 没有分包；
- 高还原目录同时保存原始 `__data-bundle.json` 和约 9 MiB 的生成文本资源，存在明显重复。

目录体积不等于最终上传压缩包体积，但足以证明旧方案没有完成主包与总包预算验收。新 spike 从第一天就输出主包、分包和总包三项预算。

#### 已证实问题 F：Node mock 验证被过度解读

旧日志中的“六脚本 eval 成功、进入 createGame、调用 getContext('webgl')”发生在 Node mock 中。Node 允许动态执行，mock WebGL 也不会真实编译 Shader、上传纹理、创建 Framebuffer 或输出可见首帧。这只能证明补桩方向有价值，不能证明微信小游戏可运行。

#### 高概率后续风险

- 原版 `core/states` 的动态构造器承担继承、生命周期和 signal 绑定，静态替换若语义有偏差，会出现能启动但状态机异常；
- 原 shim 的文件系统以浏览器同步 XHR 为中心，迁到分包后需要重新验证目录枚举、同步文本读取和图片异步加载顺序；
- Pixi 4.8.9 本身没有发现动态代码构造，但 RenderTexture、Framebuffer、滤镜和离屏 Canvas 仍必须在开发者工具及真机验证；
- 高还原工程的 `project.config.json` 使用 `compileType: "minigame"`，而已正常识别的小游戏工程使用 `compileType: "game"`，新工程必须固定并检查后者。

### 1.2 为什么仍值得做一次独立 spike

这条路线不是高把握承诺，只是仍有清晰、有限的验证价值：

- 原版比赛代码约 1.3 MiB、原始数据约 12 MiB，体积基础优于当前 Cocos 烘帧方案；
- Pixi 4.8.9 本体未发现 `eval`/`new Function`；
- 引擎内已知动态构造集中在四个位置，理论上可在构建期逐项替换；
- 浏览器 API 依赖面已经被前两次尝试枚举出大部分，新的主要未知量是静态化语义与真实 WebGL 首帧，而不是从零猜依赖。

所以本项目的目标是得到可信的“可行/不可行”结论，不承诺一定成功，更不在首帧之前扩展 UI、联机或全部球队。

## 2. 验证目标

建立独立目录 `wechat-minigame-original-runtime-latest/`，用最小范围回答一个问题：

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
wechat-minigame-original-runtime-latest/
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

静态转换不得直接修改网页真相源。每个转换必须包含：输入文件哈希、命中的旧片段数量、生成文件哈希和转换后禁止项扫描；命中数量不符合预期时构建立即失败，防止对压缩单行代码进行模糊替换后悄悄产出错误文件。

### 5.3 资源策略

本次只同步两队、国际球场、经典足球、共用球员骨骼/贴图、必要语言与配置。资源索引在构建阶段生成，运行时使用微信包内路径与 `wx.getFileSystemManager`/图片 API，不使用同步 XHR，也不把完整资源库塞进一个 Base64 JSON。

### 5.4 Canvas 所有权

- 平台启动时只取得一个可见主 Canvas；
- Pixi Renderer 第一次请求 Canvas 时领取该主 Canvas，领取后标记立即清除；
- 纹理生成、SVG 栅格化和 RenderTexture 所需 Canvas 均创建独立离屏 Canvas；
- 诊断层记录每次 Canvas 创建的用途、序号、尺寸与 context 类型；若主 Canvas 被领取超过一次则立即失败。

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

闸门必须顺序通过。任一闸门失败即停止，不通过继续补 UI 或资源来“绕过去”。

### 闸门 0：旧坑回归扫描

- `compileType` 必须是 `game`；
- 不存在 fallback 比赛引用；
- 资源键清单与请求键逐项匹配；
- 分包失败不得进入启动成功路径；
- 主 Canvas 只能被领取一次；
- 主包、分包和总包预算报告生成成功。

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

闸门 B 分成三个小检查点：

1. **B1 模块注册**：Pixi、shim、比赛模块静态加载，`__startStandaloneMatch` 注册；
2. **B2 可见首帧**：主 Canvas 出现原版球场、至少一个原版球员和原版足球；
3. **B3 完整比赛**：14 名球员、AI、开球、传射、进球和计时持续运行。

B1 通过不等于路线成功；只有 B3 通过才进入真机闸门。

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

以下任一情况直接判定本次整体静态移植失败，不继续无限补桩：

- 无法在不保留动态代码的前提下等价替换 `core/states`；
- Pixi 只能在离屏 Canvas 绘制，无法稳定绑定微信主 Canvas；
- 为获得首帧需要修改原版 AI、物理、规则或比赛状态机业务语义；
- 完成最小两队资源裁剪后仍无法满足包体预算；
- 开发者工具能运行但 iOS、Android 任一平台连续无法通过真机首帧。

## 11. 实施边界

本规格只授权创建和验证独立 spike 工程，不授权删除或覆盖现有工程，不包含上传、发布、提审或服务器变更。开发者工具本地编译属于验证范围；真机预览二维码生成后由项目所有者扫码验收。

## 12. 2026-07-10 实测记录

- 独立工程：`wechat-minigame-original-runtime-latest`。
- 闸门 A 已通过：静态构建无 `eval` / `new Function`，资源索引、AMD 注入、主 Canvas 和包体检查通过。
- 闸门 B1 已通过：Pixi 4.8.9、shim、match、standalone 静态模块完成注册，触控共享对象同引用硬闸门通过。
- 闸门 B2 已通过：微信开发者工具 Stable 2.01.2510290 冷编译后显示原版球场、原版动物球员、原版足球和原版镜头；控制台记录 `B2_VISIBLE_MATCH_STARTED`。
- 触控诊断镜像曾在 `GameGlobal === globalThis` 时产生 getter 自递归并导致栈溢出；现已按同对象/跨对象分支修复，回归测试和冷编译复测均通过。
- 当前开发者工具错误数为 0；约 145 条提示主要来自 Pixi 4.8.9 的弃用警告，后续单独处理，不作为原版引擎失败。
- 当前主包约 1.35 MiB，资源分包约 9.77 MiB，未压缩或降质原版贴图。
- 闸门 B3 只完成了 AI、镜头与比赛画面的持续运行观察；桌面模拟器未提供真实 `wx.onTouch*` 输入，完整交互和整局稳定性尚未验收。
- 闸门 C 未执行：iPhone、Android 的触摸、帧率、内存和连续运行仍须真机调试。未通过 C 前不得表述为“可直接提审”。
