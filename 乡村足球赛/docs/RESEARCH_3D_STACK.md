# 乡村足球赛 3D 开源技术选型调研

> 调研日期：2026-08-02
> 结论状态：用于立项与 M0 双引擎验证，不代表任何引擎已经通过微信真机验收

## 1. 最终建议

本项目不再根据官网演示、模型热度或一次网页截图直接选定引擎。正式技术决策拆成三个稳定层和一个短期竞测：

1. **比赛规则层**：纯 TypeScript 固定步长模拟，是不可替换的产品核心，不绑定 3D 引擎。
2. **资产生产层**：Blender 5.1.2 + 可审计 Python 脚本是唯一确定性主管线。
3. **平台服务层**：微信登录、分享、存储、排行与资源下载通过独立端口接入。
4. **渲染运行层 M0 竞测**：LayaAir 3.3.11 与 Galacean Engine 1.6.13 使用同一组资产、镜头、玩法输入和验收脚本做限时对比；胜者成为正式运行层。

候选优先级如下：

- **LayaAir 3.3.11：M0-A**。官方具备微信小游戏发布、远程资源、分包、命令行构建和 LayaAir-MCP，最符合“微信优先 + AI 可控制 IDE”的新方向。
- **Galacean Engine 1.6.13：M0-B**。MIT、TypeScript、纯代码和官方微信适配，工程状态更透明，也不依赖登录或云端编辑器。
- **Cocos Creator 3.8.8：灾备路线**。只在前两者均触发硬失败时进入验证，不同时维护第三套正式实现。
- Three.js、PlayCanvas 和 Godot 只作网页技术参考，不进入首轮微信正式候选。

这不是同时开发两个游戏。M0 每条路线最多使用两个开发工作日，第五个工作日只做统一测量与决策；进入 M1 后只保留一个引擎。

## 2. 为什么改变为双候选

本机《人人躲猫猫》复盘证明：先宣布“正式引擎”，再用大量功能证明选择正确，会造成沉没成本。该项目先后出现 Unity、Three.js 网页、three-platformize 微信版、hidecat-v2 和再次 Unity 重建；写在设计文档中的微信空场景真机门禁没有被执行，最终仍缺少正式微信真机证据。

因此本项目采用相反顺序：

```text
同一份微型产品切片
  → 两个候选分别构建
  → 微信开发者工具 + iOS/Android 真机 + 包体报告
  → 按硬门禁淘汰
  → 只对通过者评分
  → 锁定一个引擎到 M6
```

详细失败证据见 [LESSONS_HIDE_AND_SEEK.md](./LESSONS_HIDE_AND_SEEK.md)。

## 3. 本地项目与工具现状

- 现有《乡村足球赛》是微信原生 Canvas/WebGL + Pixi 2D 运行时，已有地区选择、动态球衣、赛季、排行榜、好友房和分包基础。
- `animal-football-3d.html` 是可玩的 Three.js 网页实验，可复用物理、AI 和镜头经验，但依赖 CDN、DOM 和键鼠，不能作为提审产物。
- 本机已安装 Cocos Creator 3.8.8、Blender 5.1.2 和 Godot；尚未安装 LayaAir IDE。
- 仓库旧 Cocos 构建显式关闭 3D、骨骼动画和物理，并跳过纹理压缩；旧画面和旧包体不能代表 Cocos 3D 的正常上限。
- LayaAir-MCP 需要 LayaAir 3.3.6 以上 IDE、账号登录、商店插件和云端知识库 API Key；它是可选开发加速器，不得成为游戏构建或运行依赖。

## 4. 引擎候选对比

| 候选 | AI/自动化 | 微信小游戏 | 3D 与资产 | 关键风险 | 定位 |
| --- | --- | --- | --- | --- | --- |
| **LayaAir 3.3.11** | TypeScript、命令行发布、官方 MCP 可操控 IDE | 官方发布模板、分包、远程包、WASM 分包 | PBR、动画状态机、FBX/glTF/GLB、LOD、实例化、ASTC | IDE 需登录；MCP 要订阅/API Key；工程元数据和最终主包需实测 | **M0-A** |
| **Galacean 1.6.13** | 纯 TypeScript 场景、CLI 构建、无编辑器硬依赖 | 官方平台适配和微信导出 | PBR、骨骼动画、BlendShape、Draco、KTX2、材质变体 | 微信大型项目案例较少；脚本仍受主包约束 | **M0-B** |
| Cocos Creator 3.8.8 | TypeScript、CLI，但编辑器元数据较重 | 成熟发布与 Asset Bundle | 完整 3D、动画、材质、物理 | 旧项目已证明资产管理失控时会迅速膨胀 | 灾备 |
| Three.js 0.185 | 完全代码化，AI 最容易改 | 没有本项目可复用的当前官方微信发布链 | 渲染强，游戏系统需自建 | 官方 `WebGLRenderer` 以 WebGL2 为前提；旧 three-platformize 停在 r133，版本鸿沟大 | 网页参考 |
| PlayCanvas 2.21 | MIT、TypeScript、npm、CLI 脚手架 | 未找到官方一级微信小游戏适配 | WebGL2/WebGPU、glTF、动画、物理、流式资源 | WebGL2 基线与平台适配风险；不应再次自建 shim | 网页画质参考 |
| Godot 4 | 文本场景、CLI，非常适合 AI 与版本控制 | 无官方一级微信小游戏导出 | 完整 3D 与网络能力 | 社区移植、审核和包体风险不可接受 | 不选 |

## 5. LayaAir 方向评估

### 5.1 优势

- [LayaAir Engine](https://github.com/layabox/LayaAir) 是 MIT 开源的 TypeScript 2D/3D 引擎，官方列出微信、抖音、支付宝等小游戏发布目标。
- [小游戏发布文档](https://www.layaair.com/3.x/doc/released/miniGame/readme.html) 明确处理小游戏与 H5 的运行差异和发布模板。
- [通用发布设置](https://www.layaair.com/3.x/doc/released/generalSetting/readme.html) 已覆盖远程主包、本地分包、远程分包和 WASM 分包。
- [命令行发布](https://www.layaair.com/3.x/doc/released/commandLine/readme.html) 允许用脚本从项目路径构建，满足自动化和持续集成需要。
- [LayaAir-MCP](https://layaair.com/3.x/doc/basics/developmentEnvironment/IDE-MCP/readme.html) 能让 Claude Code 等工具读取对应版本知识并操作 IDE，比单靠模型记忆调用引擎 API 更可靠。
- [模型导入](https://www.layaair.com/3.x/doc-en/IDE/assets/model/readme.html) 支持 FBX、glTF 和 GLB，包含骨骼、动画、LOD 与材质映射设置；[纹理压缩](https://www.layaair.com/3.x/doc/IDE/uiEditor/textureCompress/readme.html) 支持 ASTC/KTX 输出。

### 5.2 必须验证的风险

- AI 能操作 IDE 只解决“会不会点、API 是否存在”，不解决角色造型、动画节奏、地域文化和镜头是否好看。
- MCP 云端知识库需要订阅与 Key；离线构建必须在禁用 MCP 后仍完全可重复。
- IDE 登录和插件商店属于外部状态，不能成为 CI 或其他开发者首次构建的单点故障。
- 官方功能丰富不等于微信主包足够小；必须测量真实勾选模块后的代码体积。
- Bullet/WASM 物理在 M0/M1 禁用，避免再次把完整物理运行时塞入首包。

## 6. Galacean 方向评估

### 6.1 优势

- [Galacean Engine](https://github.com/galacean/engine) 是 MIT、TypeScript、Web/移动优先的 3D 引擎，同时支持编辑器和纯代码场景。
- [微信小游戏文档](https://www.galacean.com/engine/en/docs/platform/wechatMiniGame/) 和 [平台适配 CLI](https://github.com/galacean/platform-adapter) 提供从 TypeScript 入口到微信产物的路径。
- [glTF 支持](https://www.galacean.com/engine/en/docs/graphics/model/glTF/) 包含骨骼动画、BlendShape、Draco、KTX2 和材质变体。
- [动画控制器](https://www.galacean.com/engine/en/docs/animation/animatorController/) 能在骨骼层级和命名一致时复用动作，符合共享人形骨架策略。
- 本次调研的 npm 1.6.13 包内 `browser.min.js` 约 1.17 MiB；这只是候选体积信号，不是微信最终主包结论。

### 6.2 必须验证的风险

- 微信导出链比 Cocos/LayaAir 更新，大型微信游戏样例更少。
- 平台文档指出脚本资源仍进入主包，必须通过 tree-shaking 和模块白名单约束扩展。
- 纯代码易被 AI 快速堆出大量程序化占位物；必须用视觉金图阻止“方块完成论”。

## 7. AI 与 3D 资产开源项目

| 项目 | 适合用途 | 不允许直接进入运行时的原因 | 本项目策略 |
| --- | --- | --- | --- |
| [BlenderMCP](https://github.com/ahujasid/blender-mcp) | AI 读取场景、改材质、操作物体、执行 Blender Python | 可执行任意 Python；交互结果若不固化为脚本无法复现 | 仅用于受信任开发机；正式产物必须由版本化 Blender 脚本重建 |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | 单图生成带 PBR 材质的 GLB 高模初稿 | 官方示例可达百万级面数和 4K 贴图，无法直接用于小游戏 | MIT；只做静态道具、头部或建筑高模草稿，必须重拓扑、烘焙、LOD |
| [UniRig](https://github.com/VAST-AI-Research/UniRig) | 自动生成骨骼与蒙皮 | 不保证角色骨骼命名和比例完全一致；需要 CUDA | 绑定实验助手；正式球员只用项目共享骨架 |
| [AniGen](https://github.com/VAST-AI-Research/AniGen) | 从单图生成可动画角色草稿 | 官方测试依赖 Linux 与 18GB 以上 NVIDIA 显存，不保证移动游戏拓扑 | 研究候选，不成为 M0/M1 依赖 |
| [HY-World 2.0](https://github.com/Tencent-Hunyuan/HY-World-2.0) | 地域场景构图、背景参考、可导出世界草稿 | 模型与输出计算量大；3DGS 不适合作为微信足球运行场景 | 概念和高模参考，不在运行时加载 3DGS |
| [CubePart](https://github.com/Roblox/cube) | 可分部件的模块化道具研究 | 输出仍需人工验证拓扑、比例、许可和风格 | 球门、摊位、看台组件的观察名单 |

Hunyuan3D 2.1 使用自定义社区许可并含地域及使用条款，因此不作为默认生产依赖；如未来使用，必须先进行单独法务复核。

## 8. 确定性资产主管线

```text
地域资料与文化证据登记
  → 原创正/侧/背概念图
  → Blender 参数化基础模型
  → 共享骨骼与统一命名
  → 人工拓扑、UV、碰撞体
  → LOD0/1/2
  → PBR/顶点色/AO 烘焙和图集
  → GLB + 压缩纹理
  → 两个候选引擎同资产预览
  → 固定机位金图对比
  → 微信真机性能验收
```

AI 可进入概念图、小道具高模、建筑细节候选和初步绑定节点；主角拓扑、骨骼命名、碰撞体、LOD、中文球衣、地域文化标签和包体资源不得自动放行。

每个外部生成物记录：工具/模型版本、输入来源、输出许可、人工修改、审核人、文件哈希和最终用途。

## 9. M0 双引擎统一试题

两个候选必须使用完全相同的：

- 一块 64×42 米球场和 128 米以内的山谷村落远景；
- 10 名同骨骼球员、同一套 Idle/Run/Pass/Shoot/Tackle 动画；
- 一个 30 Hz 固定步长的 TypeScript 移动和足球样例；
- 同一套触控摇杆与传球、射门、抢断按钮；
- 24/48 名实例化简化观众；
- 同一组 1024 角色图集、场景图集、LOD 和阴影参数；
- 同一套启动、掉包、低内存和资源失败用例。

### 9.1 硬门禁

任一项失败即淘汰，不进入主观评分：

1. 可从命令行分别构建 Web 与微信小游戏产物，干净环境可重复构建。
2. 微信开发者工具首帧无 DOM、CDN 脚本、`eval` 或运行时动态代码依赖。
3. 至少一台 iOS 和一台 Android 真机完成启动、移动、传球、射门、切后台恢复。
4. 10 名共享骨骼球员动画切换无姿态翻转、模型倒地或显存持续增长。
5. 主包不超过 3.4 MiB，本地主包加分包不超过 18 MiB；项目硬上限继续按 4/20 MiB 执行，直到微信后台真实规则另行核实。
6. 中档参考机同屏 10 人、24–48 名简化观众时，中画质 10 分钟中位帧率不低于 30 FPS，1% low 不低于 24 FPS。
7. 低画质能关闭阴影、AO、远景动画和高 DPR，玩法仍完整。
8. 断网或地域资源校验失败时，能进入本地通用球场，不黑屏、不无限加载。

### 9.2 通过后的评分

| 维度 | 权重 | 测量方式 |
| --- | ---: | --- |
| 微信兼容与恢复 | 30 | 两端真机、前后台、弱网、资源失败 |
| 帧率、内存与包体 | 25 | 统一场景的性能和构建报告 |
| 自动化与 AI 可控性 | 15 | 从空目录到构建、改场景、修错误的可重复步骤 |
| 角色动画与资产稳定性 | 15 | 共享骨架、LOD、压缩纹理、材质变体 |
| 调试与构建确定性 | 10 | 干净构建、日志质量、快照回归 |
| 开源许可与维护风险 | 5 | 引擎、工具、插件、云服务依赖清单 |

分数只用于两个都通过硬门禁时决胜。若只有一个通过，直接选通过者；若两个都失败，记录证据后才启动 Cocos 灾备验证。

## 10. 选型停止条件

- M0 结束即冻结引擎，M1–M6 不因新 Demo、新模型或单个渲染功能更换引擎。
- 引擎冻结后，画面问题先归类为资产、灯光、材质、镜头或性能问题；没有可复现证据不得归因于引擎。
- 只有出现无法提审、无法修复的真机崩溃、许可证变化或平台接口失效，才能提出迁移 ADR。
- 任何引擎迁移必须保留纯 TypeScript 比赛模拟、平台端口、内容清单和 Blender 源资产，不重写产品核心。
