# 动物世界杯 · 微信小游戏移植设计文档

日期:2026-07-05
状态:已与所有者确认两项关键决策——(1)按「方案 A:原引擎整体移植」执行;(2)首版即包含好友远程联机。

---

## 一、目标与验收标准

把网页版「动物世界杯」(Animal Cup)高度还原地移植为微信小游戏,**玩法一模一样**,并在体验细节、分享传播上做到小游戏平台的一流水准。

验收红线:

(1)**还原度**:比赛由与网页版完全相同的引擎(`match.rebuilt.js` + Pixi 4.8.9)驱动,同一套球员 AI、物理、素材、镜头;选队/阵型/球衣/难度/时长参数与网页版一一对应。
(2)**性能**:中端安卓机(骁龙 7 系)全场稳定 ≥30 帧;iPhone(高性能模式)60 帧;帧率不达标时降渲染档位,不砍内容。
(3)**加载**:WiFi 下首包进大厅 ≤3 秒;比赛分包后台预下载,点「开球」到云幕拨开 ≤8 秒。
(4)**联机**:两位好友通过房间码/微信邀请卡实时对战,输入延迟感知 ≤150 毫秒(同步方案见第五节)。
(5)**语言**:界面全中文(使用现有 `zh.json` 文案库),保留多语言机制。

## 二、现状与关键发现

### 网页版架构(移植的「原料」)

- **比赛引擎**:`public/match-runtime-min/scripts/match.rebuilt.js`(约 812K,压缩单行),从桌面版(NW.js + Steam SDK)重建;经 `shim.js`(896 行)适配后跑在浏览器里。
- **引擎的环境依赖面非常小**(这是方案 A 可行的根据):
  - 模块系统:自带 AMD/CommonJS 的 `define/require`,由 shim 提供;
  - 文件访问:全部走 `fs` 存根(`readFileSync/readdirSync/existsSync`),网页版用同步 XHR + `__data-bundle.json`(6.8M base64 打包)+ `__dirlist.json`(目录清单)兜底;
  - DOM 依赖:仅 21 处 `document.createElement`,其中 12 处是 `canvas`(纹理生成),其余 div/button/a/link/video/source 各一两处,均可打桩;
  - 渲染:Pixi 4.8.9(WebGL),shim 里有三处 RenderTexture 兼容补丁需原样保留;
  - 其他:swig 模板(纯字符串处理)、MessageFormat 存根、缓动函数表、Node 全局(process/Buffer/global)。
- **启动序列**:`shim-early → pixi → swig → shim → match.rebuilt → standalone-match`,然后 `window.__startStandaloneMatch({red, blue, stadium, ball, time, ai, side})`。
- **对外接口(移植时保持不变)**:
  - 输入:`window.__touchInput = {active, vx, vy, shoot, sprint, pass, lob, switchPlayer, tackle}`,主循环每拍折叠进控制器;
  - 镜头:`window.__matchZoom.{get,set,step}`;双指捏合缩放;
  - 事件:`ab-match-started` / `ab-match-ended`(带比分)/ `ab-formations`;
  - 状态读取:`window.__matchGame.pitch`(比分、时间)、`readStats()`(控球、射门等);
  - 阵型注入:`window.__matchFormations`。
- **界面层(React DOM,需在小游戏里用 Pixi 重绘)**:云幕加载 → 记分板(比分/时钟/控球条/详细统计下拉)→ 控制群(缩放/截图/回家/声音/语言)→ 触控(左摇杆 + 右侧菱形 传/射/铲/挑 + 中央冲刺,死区 0.18)→ 进球特效/事件卡 → 晨/午/夜光照 + 暗角 → 结果卡(比分/胜负/统计/再来一场)。
- **首页(Landing.jsx)**:左右双栏选队(8 支动物国家队,头像九宫格)+ 阵型药丸(带阵型示意图)+ 球衣(主/客)+ 难度(易/中/难 = ai 0/1/2)+ 时长(4/6/10 分钟)+「观看 AI 对战 / 开球 / 局域网联机」。
- **素材账本**:引擎数据 `data/` 12M(球员 7.2M、球场 2.9M、球队 1.6M、球 232K);头像 2.7M;音效 1.1M(mp3,含 8 队专属欢呼);字体 CupRound(约 200K,内嵌在 CSS 里的 base64 TTF,需解出)+ cup-digits.ttf 12K。`animal-cup/ui/gen` 的 29M 生成图**当前网页版并未引用**,不进包。
- **多语言**:en/es/fr/ja/pt/zh 六种,zh 完整。

### 既有小游戏初版的处置

上一轮会话产出的 `wechat-minigame/`(1651 行)是**简化重写版**(263 行自研模拟 + Canvas 渲染),达不到「一模一样」,其比赛代码整体替换。保留继承:

- `project.config.json`(正式 AppID `wx6755751392105ee3`)与 `game.json`(已锁横屏);
- `wechat-minigame-extras/server/room-server.mjs` 房间服务原型(升级为联机中继);
- 虚拟摇杆的手感参数与部分资产。

## 三、技术方案(方案 A:原引擎整体移植)

### 总体结构

```text
wechat-minigame/
├── game.js                  # 入口:装适配层 → 场景管理(大厅/比赛)
├── game.json                # 横屏、分包声明、开放数据域(二期)
├── project.config.json      # 正式 AppID
├── adapter/                 # 微信环境适配层(方案核心,详见下)
├── runtime/                 # 原样搬运:pixi.min.js、swig.min.js、match.rebuilt.js、
│                            #   shim-wx.js(shim.js 的小游戏版)、standalone-match.js
├── ui/                      # Pixi 场景:大厅、比赛 HUD、触控、结果卡、战报卡
├── audio/                   # SoundBank 小游戏版(InnerAudioContext)
├── net/                     # 房间客户端 + 帧同步(lockstep)客户端
├── sub-data/(分包)         # 引擎 data/ 原始文件(≈12M,压缩后更小)
└── sub-media/(分包)        # 头像 + 音效 + 字体
```

### 适配层(adapter)——让引擎以为自己还在浏览器里

小游戏没有 DOM/BOM,适配层提供引擎用到的最小闭包,自研精简版(不整包引入社区 weapp-adapter,按实际依赖面裁剪):

(1)`canvas`:主画布 = `wx.createCanvas()`(第一个创建的即屏幕);引擎另外 12 处 `createElement("canvas")` → `wx.createCanvas()` 离屏画布。
(2)`Image` → `wx.createImage()`;保留 `fakeSrc` 纹理键约定(shim 的资源规范化逻辑照搬)。
(3)`fs` 存根 → **直接映射到 `wx.getFileSystemManager().readFileSync/readdirSync/accessSync`**,读分包内 `sub-data/` 的原始文件。比网页版的同步 XHR 更干净:不再需要 6.8M 的 `__data-bundle.json`,`__dirlist.json` 构建时照常生成(readdir 在包内文件上不可用时兜底)。
(4)`localStorage` → `wx.getStorageSync` 同步封装;`document`/`window` 其余属性按 shim 的桩清单补齐(video/link/a/button 均为空桩)。
(5)字体:构建时从 `cup-round.css` 解出 TTF,运行时 `wx.loadFont()` 注册,Pixi Text 样式沿用同名字体族。
(6)音频:`InnerAudioContext` 封装成 SoundBank 同接口(预加载、并发副本、静音持久化)。
(7)**确定性层(联机的地基,首日就装)**:
   - `Math.random` → 可播种伪随机数生成器(PRNG),种子由房间下发;单机模式用随机种子,行为不变;
   - `Date.now`/`performance.now` 对引擎逻辑暴露为「逻辑时钟」(按帧推进),渲染仍用真实时钟;
   - `Math.sin/cos/tan/exp/log/pow` 换成软件实现(fdlibm 风格),消除 iOS(JavaScriptCore)与安卓(V8)的超越函数差异——浮点四则与 sqrt 本身是 IEEE 确定的;
   - 主循环固定步长(fixed timestep),渲染插值。

### 包体预算

| 内容 | 位置 | 体积(压缩前) |
|---|---|---|
| 引擎 + Pixi + swig + shim + 适配层 + UI 代码 | 主包 | ≈1.6M(≤4M 限额) |
| 引擎 data/ | 分包 sub-data | ≈12M(PNG 有量化空间) |
| 头像 + 音效 + 字体 | 分包 sub-media | ≈4M |
| 合计 | | ≈17.6M,整包限额(20M,近年已放宽)之内 |

全部资源进包 = **完全离线可玩**,单机模式不依赖任何服务器。若后续超预算,备选:PNG 量化(约省 30–50%)→ 音频码率下调 → 最后才考虑 CDN 远程资源。

### 界面还原策略

网页版的 HUD/大厅是 CSS + SVG(玻璃拟态、手绘边框、渐变),小游戏里用 **Pixi 容器层**逐一重绘(与比赛同一渲染管线,层级天然正确):大厅选队、记分板、统计条、触控件、事件卡、进球特效、晨午夜光照(全屏着色层)、暗角、结果卡。SVG 图标转为程序化 Pixi Graphics 或小图集。对齐标准:与网页版截图并排目视比对。

## 四、产品体验设计(「惊艳」的三根支柱)

**支柱一:开场即巅峰——加载变成入场仪式。** 首包只装大厅与引擎代码,点开 3 秒进大厅;选队期间 `wx.loadSubpackage` 后台预下载比赛分包,进度融进云幕;点「开球」→ 云幕拨开 + 空中俯冲镜头(原版完整保留)。玩家感受到的不是加载条,而是入场式。

**支柱二:原汁原味 + 微信体感层。** 玩法零改动;加上 `wx.vibrateShort`:进球长短震组合、门柱短震、开场哨轻震;8 队专属欢呼声浪;静音状态持久化;全程 CupRound 手绘字体。

**支柱三:每场比赛都值得炫耀。** 赛后自动合成**战报卡**(两队动物头像、比分、控球/射门统计、手绘纸纹边框),`wx.shareAppMessage` 自定义卡片,标题模板带挑衅语气(「我带美洲豹 3:1 踢翻了公鸡队,你行吗?」);好友点开 → 直接进入同一对阵的镜像局或应战房间,打完他也产出战报卡——分享回环闭合。

细节讲究清单(节选):摇杆死区 0.18 与网页版一致;冲刺键在菱形中央;竖屏时的「请横屏」提示不会出现(game.json 已锁横屏,体验优于网页);截图按钮 → `canvas.toTempFilePath` + 存相册授权;比分字体用 cup-digits;按钮按压音 ui_click/ui_select 全接。

## 五、联机设计(首版包含,所有者拍板)

### 同步模型:帧同步(Lockstep)

引擎不改一行的前提下,唯一忠实的实时方案:**双端各自运行同一引擎,只交换输入**。

- 依赖第三节的确定性层:同种子 PRNG + 逻辑时钟 + 软件数学库 + 固定步长 ⇒ 引擎成为「输入的纯函数」;
- 输入延迟缓冲 4–8 个逻辑帧(约 70–130 毫秒),超时未到的帧等待(卡顿优于错乱);
- 每 2 秒交换一次状态哈希(球位 + 比分 + 比赛时间)做失同步检测;失同步时:比赛继续,终场以房主结果为准,并明确提示;
- **可测试性**:Node 冒烟脚本同种子同输入跑双实例、逐帧比对哈希,进 CI;这也是移植正确性的回归测试。

### 房间与邀请

- 流程:大厅「好友对战」→ 创建房间(得 6 位房间码)→ `wx.shareAppMessage` 邀请卡(带 room 参数)→ 好友点卡直达房间 → 双方就位 → 房主开球(下发种子 + 对阵参数);
- 服务器:`room-server.mjs` 原型升级为帧同步中继(房间管理、开球握手、按帧转发输入、时钟同步、心跳重连),无游戏逻辑、无状态存储,单实例可支撑大量房间;
- 部署:所有者的腾讯云 Lighthouse(master-ai.cn,已有 nginx TLS + PM2 架构),新增 `wss://master-ai.cn/animal-ws` 反代到本机新端口,遵守服务器运维铁律(备份不进 sites-enabled、改完 nginx -t、PM2 独立应用不动 masterfriend);
- 域名配置:小游戏后台把 `wss://master-ai.cn` 加入 socket 合法域名(需 AppID 管理员操作);开发阶段开发者工具勾选「不校验合法域名」即可全流程联调。

### 风险阶梯与后备

帧同步的主风险是跨端浮点漂移。对策依次:确定性层(设计内)→ 双端哈希回归测试(设计内)→ 真机 iOS×Android 长局压测(里程碑内)→ 若仍有顽固失同步,后备形态「异步应战」(好友接受挑战后打同一对阵、比战报),保证联机功能在任何情况下可发布。

## 六、范围

**首版 v1.0**:大厅(选队/阵型/球衣/难度/时长)· 观赛模式 · 操控模式 · 结果卡 · 战报分享卡 · 好友房间实时对战 · 震动/音效 · 全中文。

**明确不做(二期)**:好友排行榜(开放数据域)、每日赛程(fixtures.json 已备料)、多人 14 槽混战、网页版的局域网大屏模式(属网页特有场景,不移植)。

## 七、里程碑

- **M1 引擎点火**:适配层 + shim-wx,开发者工具里 `__startStandaloneMatch` 跑通,AI 对 AI 踢起来(确定性层同时落地);Node 冒烟 + 双实例哈希比对脚本建立;
- **M2 完整单机**:大厅/HUD/触控/结果卡 Pixi 重绘,分包与预下载,音频字体震动接入;
- **M3 传播层**:战报卡合成与分享、镜像局直达、截图存相册;
- **M4 联机**:中继服务器升级与部署、房间流程、邀请卡、帧同步联调、真机双端压测;
- **M5 打磨发布**:性能档位、弱网与断线重连、边界场景清扫、双端真机验收、提审素材。

## 八、主要风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| Pixi 4.8.9 在小游戏 WebGL 上的兼容性 | 中 | M1 首件事验证;shim 的 RenderTexture 补丁照搬;必要时逐项打补丁(社区有 Pixi4 小游戏先例) |
| 引擎存在未探明的浏览器 API 调用(压缩代码盲区) | 中 | 适配层挂「未知访问报警」,M1 跑真引擎时逐个补桩 |
| 跨端浮点漂移导致联机失同步 | 中高 | 确定性层 + 哈希回归 + 真机压测 + 异步应战后备(见第五节) |
| 包体超限 | 低 | 预算 17.6M 有余量;PNG 量化、音频降码率两级缓冲 |
| iOS 高性能模式差异(音频/触摸) | 低中 | 真机验收清单单列 iOS 项 |

## 九、发布与运维

- 开发验证:微信开发者工具(不校验域名)全流程;真机预览二维码验收;
- 服务器:联机中继部署于 master-ai.cn(PM2 独立应用 + nginx wss 反代),与既有 masterfriend 服务互不影响;
- 上线前置(所有者操作项):小游戏后台配置 socket 合法域名;提审类目与版权自查(动物原创形象,素材自有)。
