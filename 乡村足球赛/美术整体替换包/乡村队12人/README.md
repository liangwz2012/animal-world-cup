# 乡村足球赛：单支队伍 12 名球员美术包

这里是**一支乡村队**的 12 位不同人物，不是 12 支队，也不按职业拆队。

运行时结构已经固定为：`12 个不同人物的独立人体分层 + 原比赛骨骼/锚点 + 同一支队的动态地区球衣`。广东、广州、信宜、镇隆或自定义队名改变时，所有队员的球衣文字一起变化；人物美术不同，但身材尺寸和动作骨骼不变。

## 放图位置

每位角色放到 `players/<角色 id>/`：

- `portrait.png`：**192 × 192**，选队/名单头像。
- `head.png`：**81 × 77**，正面比赛头部。
- `head_back.png`：**81 × 77**，背面比赛头部。
- `neck.png`（20 × 18）
- `arm_left.png`（14 × 11）
- `arm_right.png`（15 × 17）
- `hand_left.png`（25 × 28）
- `hand_right.png`（23 × 38）
- `knee.png`（8 × 9）

以上 9 张图全部放在每位角色自己的目录中，不再使用共用动物身体。所有 PNG 必须为 RGBA 透明背景，四角透明，人物边缘不可留白边。球衣不要画入人体素材；球衣由游戏现有的动态地区球衣层统一生成。

## 固定尺寸流程

```bash
# 先生成每名角色独立的颈、臂、手、膝切片
npm run art:rural-body-parts

# 每张 AI 三视图源图生成后，归一化为头像和比赛头部。
# 中栏必须是严格正面头像（双眼水平、鼻尖居中），右栏是严格背面后脑（不得出现眼睛、鼻子或嘴）；
# 两个头部都会被锁定为同一 69×73 可见包围盒，放入原 81×77 画布。
npm run art:rural-process-sheet -- --player captain-carpenter --input /绝对路径/captain-carpenter.png

# 压缩旧批次遗留的高清三视图，只保留低清 WebP 参考
npm run art:rural-compress

# 12 人全部齐全后才允许应用
npm run art:rural-apply
npm run build
```

处理脚本只把源图内容缩放放入固定画布，不会改变运行时规定尺寸。高清源图切完后不保留 PNG，只保存最长边 768 px 的 WebP 参考图；运行时仍使用小尺寸透明 PNG。应用脚本还会重新检查 PNG 格式、RGBA、透明角和非空像素；任一项不合格就停止。

## 12 名角色

1. `captain-carpenter`：42 岁木工、村队老队长、门将，1 号
2. `farmer-defender`：39 岁种植能手、后卫，2 号
3. `teacher-defender`：31 岁乡校体育老师、后卫，3 号
4. `courier-winger`：23 岁快递员、边卫，4 号
5. `machinery-midfielder`：28 岁农机手、中场，5 号
6. `homestay-playmaker`：30 岁民宿主理人、中场，6 号
7. `cooperative-midfielder`：46 岁合作社账房、后腰，7 号
8. `returnee-forward`：21 岁大学生返乡创业者、前锋，8 号
9. `woman-forward`：24 岁女足球员、前锋，9 号
10. `livestream-winger`：26 岁乡村主播、边锋，10 号
11. `village-doctor`：35 岁乡村医生、替补门将，11 号
12. `apprentice-substitute`：18 岁汽修学徒、替补，12 号

放齐素材后执行：

```bash
npm run art:rural-apply
npm run build
```

应用脚本会先自动备份旧运行素材，再替换为乡村队 12 人阵容；缺任何一张或尺寸不符合时会直接停止，不会产生半替换包。
