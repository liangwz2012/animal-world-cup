# M0 共享 3D 金样

## 用途

M0 金样只用于公平比较 LayaAir 与 Galacean 的加载、皮肤动画、材质、灯光、实例、包体和微信稳定性。它不是最终商业角色，也不会被包装成“皮克斯级成品”。

## 内容

- 64m × 42m 球场、标准宽度球门、中心线/圈、简化乡村看台、节庆横幅和树木。
- 一名温暖卡通比例的人类球员：项目自有程序化网格、14 个材质、18 根骨架节点，其中 17 根变形骨。
- 独立足球 BallGold，不属于角色骨架。
- idle、jog、sprint、pass、shoot、stumble 六段 30fps 动作。
- animation-clips.json 提供循环、根运动、支撑脚、落地与触球窗口，两个引擎共用。

## 生成与门禁

- 源：tools/blender/build_m0_gold.py。
- 工具：Blender 5.1.2。
- 构建：npm run build:assets:m0。
- 验证：npm run verify:assets:m0。
- 输出：assets/built/m0/m0-gold.glb（构建产物，不纳入 Git）。
- 受控证据：tests/evidence/m0-asset-baseline.json。

门禁要求：glTF 2.0、一个 skin、17–65 根变形骨、六段动作名完全一致、至少四个网格、GLB ≤1.5 MB。当前结构稳定性使用 glTF JSON 的 SHA-256；Blender 生成的二进制浮点排列不作为跨构建身份依据。

## 已知质量边界

金样采用低成本程序化几何，动作能够表达跑、传、射和失衡并验证脚接触管线，但不代表最终人物细节、动作捕捉质量、IK 或皮肤权重质量。M1-A 必须基于真机镜头与足球手感重新打磨，不能把 M0 金样直接当最终美术量产模板。
