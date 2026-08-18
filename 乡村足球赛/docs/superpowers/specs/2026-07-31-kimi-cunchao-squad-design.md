# Kimi人物素材：村超 12 人全新阵容美术设计

日期：2026-07-31
状态：预览包已生成（未应用到游戏），等待用户审看

## 背景与目标

现有乡村队 12 人头像偏"商业卡通"：全员大眼、磨皮、看不出年龄与职业差异，不符合村超"普通人上场"的本土化定位。本方案生成一套全新人物 + 服装鞋袜，先输出到 `Kimi人物素材/` 预览，用户确认后才走替换流程。

约束继承自 `美术整体替换包/乡村队12人/README.md` 与 `manifest.json`：同一套骨骼/锚点/物理不变；人物必须来自真实生图模型；运行 PNG 尺寸、RGBA、透明边界、洋红残边校验全部保留。

## 生图通道

本机 Kimi Code 无文生图能力；inference.sh 凭证失效。改用用户已登录的 ChatGPT（Chrome）：

1. APFS 克隆 Chrome 用户档案到 `.tmp/cdp/chrome-profile`（`cp -Rc`，秒级、不占双份空间），删除克隆体内的 `Singleton*` 锁文件。
2. 用克隆档案启动第二个 Chrome 实例：`--remote-debugging-port=9222`，与用户主浏览器互不干扰。
3. `.tmp/cdp/driver/gen-image.mjs`（playwright-core 走 CDP）开新会话 → 发提示词 → 轮询 `img[src*="estuary/content"]`（naturalWidth≥512）→ 页面内 fetch 下载 1536×1024 母版。

注意：ChatGPT 生成图不在 `[data-message-author-role]` 祖先下，选择器必须按 URL 特征匹配。批量串行 + 失败重试一次 + 间隔 8s，避免触发限额。

## 新 12 人阵容

全部取自公开村超报道中的真实职业群像（屠户、种植大户、村小老师、骑手、钢筋工、米粉店主、小卖部账房、返乡大学生、幼儿园老师、卤味摊主、村医、汽修学徒），不复刻任何真实个人。位置/号码/体型档（bodyProfile）与原 12 人一一对应，未来应用时 gameplay 零变化：

| # | id | 姓名 | 年龄 | 职业 | 位置 |
|---|----|------|------|------|------|
| 1 | butcher-captain | 韦国强 | 45 | 屠户兼宴席掌勺 | 门将 |
| 2 | sugarcane-defender | 蒙大田 | 40 | 甘蔗种植大户 | 后卫 |
| 3 | pe-teacher-defender | 覃秀丽 | 32 | 村小体育老师 | 后卫 |
| 4 | rider-winger | 吴跃进 | 24 | 乡镇外卖骑手 | 边卫 |
| 5 | steelworker-midfielder | 石铁柱 | 29 | 钢筋工 | 中场 |
| 6 | noodle-playmaker | 岑月娥 | 31 | 米粉店老板娘 | 中场 |
| 7 | shopkeeper-midfielder | 罗桂香 | 47 | 小卖部兼合作社账房 | 后腰 |
| 8 | graduate-forward | 杨帆 | 21 | 返乡大学生（电商） | 前锋 |
| 9 | woman-striker | 韦春花 | 25 | 幼儿园老师、女足尖子 | 前锋 |
| 10 | market-winger | 陆小妹 | 26 | 卤味摊主、兼职村播 | 边锋 |
| 11 | doctor-goalkeeper | 何济民 | 36 | 村卫生室医生 | 门将 |
| 12 | mechanic-apprentice | 梁小满 | 18 | 职校汽修学徒 | 替补 |

平均年龄 32.3，5 女 7 男，脸型/发型/肤色按 manifest 规定的自然差异分布。

## 风格（用户已确认样品）

3D 卡通动画电影风（皮克斯感），明确卡通不写实；乡村特征（方脸/浓眉/短胡茬/灰发/晒黑/笑纹）用简洁卡通形状表达；去偶像化但不丑化。第一版提示词偏写实被用户否决，第二版强化"卡通眼睛、圆润简化五官、光滑卡通皮肤"后通过。

## 母版与切片管线

- 提示词模板：纯洋红 `#FF00FF` 底，横向三等分：左=胸像 3/4 视角，中=严格正面头（双眼水平鼻尖居中），右=严格背面头（无五官）；普通便服（无文字/号码/队徽/标志，不画球衣）。
- 切片复用现有 `tools/process-rural-character-sheet.mjs`（新增 `--manifest` 参数）；去底后新增 **洋红去溢色（despill）** 步骤：`min(R,B)-G>24` 的像素压回灰度，只影响洋红边，肤色/黑发/灰白衣服不误伤。该步骤对原绿底母版无影响。
- 身体小部件（颈/双臂/双手/膝）复用 `tools/generate-rural-body-parts.mjs`（新增 `--manifest`），肤色从各人 portrait 自动采样。
- 预览复用 `tools/render-rural-character-contact-sheet.mjs`（新增 `--manifest`），新增 `tools/render-kimi-roster-preview.mjs` 拼 4×3 阵容总览。

## 服装鞋袜：村超主题球衣套件「经典撞色」

球衣层是程序化生成（配色+纹样函数），不进入人物 PNG。真实村超队服就是普通撞色队服，不做浓民族纹样（v2 侗锦纹方案已被用户否决）：

- 新样式 `cunchao-classic`：主场 大红 `#C3272B`/米白 `#F5E9D0` + 稻金胸条 `#F0BC3F`；客场 米白/大红 + 藏青胸条；门将 亮黄 `#E8B11B`/藏青。仅领口撞色 + 一条干净胸条 + 下摆微压暗。
- 预览渲染 `tools/render-cunchao-jersey-preview.mjs`（与运行时同坐标/光照/重染逻辑；高清模式按连续坐标直接栅格化 + lanczos 平滑轮廓 alpha）→ `Kimi人物素材/球衣预览/村超球衣套件预览.png`（三套成衣人形图高清版）+ `村超球衣全套件清单.png`（14 类部件逐件高清图）+ `Kimi人物素材/球衣套件(未应用)/` 38 件原生尺寸运行规格 PNG（尺寸与 RGBA 已校验，应用时直接可用）。
- 预览阶段不改 `src/data/rural-jersey-styles.js`；应用时才需要：① 样式加入 `RURAL_JERSEY_STYLES`；② `tools/build-rural-jersey-kits.mjs` 的 `shirtColor` 增加 `cunchao-classic` 分支（预览脚本里已有同款实现可搬）；③ 执行 `npm run art:rural-jerseys`。

## 运行时装配全图（替换面）

一名可见球员 = 以下三层叠加，骨骼/锚点/物理全部不动：

1. **皮肤层**（12 个 race 目录 `data/player/races/rural_XX/`）：head/head_back（AI 母版切片）、neck/arm×2/hand×2/knee（肤色程序化）。race.json 锚点保持原值；`headHorizontalFacing=left` 的角色 apply 时只水平翻转正面头。
2. **服装层**（8 支地区队 × home/away/goalkeeper）：shirt_front/back、sleeve×2、shorts、shorts_leg×2、socks×3、shoes×2；门将额外手套 hand×2。由球衣构建脚本按样式重染，`team.json` 的 kit 槽位与 kitColors 同步更新。
3. **名单与头像**：`src/data/rural-squad.js`（RURAL_SQUAD 元数据 + 选人索引）；选队卡 `cocos/animal_football/portrait_<team>.png`（apply 时从 12 人 portrait 轮换）。

## 应用记录（2026-07-31 已完成）

1. 12 人已全部应用：`src/data/rural-squad.js` 换为新名单（bodyProfile 逐槽位保留）；素材同步进 `美术整体替换包/乡村队12人/`（旧包备份在 `美术替换备份/2026-07-31-旧乡村队12人美术包/`）；`npm run art:rural-apply` + `npm run build` 通过，`test:rural-squad` 等全绿；包体积增量约 36KB。
2. **比赛撞脸修复**：引擎 `loadRedTeamKit`/`loadBlueTeamKit` 都把本队第 i 名上场球员绑定到 `team.players[i]`，8 支队共用同一 12 人 → 双方同脸。已在 `match.rebuilt.js` 的 `loadBlueTeamKit` 加入蓝方置换表 `BLUE_FACE_ORDER=[11,8,9,10,12,6,4]`：蓝方门将固定用 11 号村医（另一位 G），外线用 8/9/10/12/6/4 号；全场 14 个位置出现 12 张脸中的 10 张，仅 2 张双方各出现一次（7 对 7 只有 12 人的数学下限）。
3. **选队界面双方面对面**：人物胸像原图统一面朝左（提示词设定），实现为左侧红方面板头像水平翻转为面朝右、右侧蓝方面板保持面朝左（`src/ui/game-shell.js` homeRegionPanel，`if (isRed) portrait.scale.x = -portrait.scale.x`）。首版曾误按"原图朝右"翻转蓝方并翻转 3 张头像，已纠正还原。
4. **球衣全部换成经典撞色 + AI 光影染色**：`src/data/rural-jersey-styles.js` 8 套全部改为 `cunchao-*` 变体（红金/翠绿/藏青/天蓝/橙蓝/紫青/青金/黑红），`build-rural-jersey-kits.mjs` 增加 `cunchao-` 分支（领口撞色+胸条+下摆压暗）。质感升级：AI 生成纯白装备母版（与人物同生图通道），`tools/build-kit-luminance-donors.mjs` 切成 14 张槽位光影灰度图（`美术整体替换包/乡村球衣系统/luminance/`），染色改为"区域配色 × AI 布料明暗（均值归一，亮度上限 1.15 防洋红误判）"，球衣不再是平涂手绘风，与 AI 头像质感统一。地区队名/号码仍为运行时动态排版（`src/ui/dynamic-jersey.js`），不为任何地区预生产图片。`npm run art:rural-jerseys` 已应用，`test:rural-jerseys` PASS。
5. **球衣按体型"裁剪"**：`src/data/player-body-profiles.js` 的 5 种体型预设各配一套裁剪系数（衣宽/衣长/袖/短裤/袜/鞋），运行时按 `skeleton.slots` 对球衣槽位附件（chest_shirt、袖、pelvis_shorts、裤腿、袜、鞋、number）做缩放——只动附件，不动骨骼与头部，零新增图片素材；同体型球员再按号码加 ±1.5% 衣宽 / ±2% 衣长的稳定差异，避免克隆感。基础缩放只捕获一次，重复应用不叠加。`test-player-body-profiles` PASS。
6. `tools/build.mjs` 的 squad 头像 id 列表改为从 manifest 读取（换阵容不再改构建脚本）；`test-rural-squad.mjs` 平均年龄断言更新为 31.17。
7. **动态队服修复（2026-08-01）**：开发者工具离屏 canvas 无 `toDataURL`/`toTempFilePath`，12 张带名球衣纹理全部静默回退，`serializeCanvas` 补 `convertToBlob` 路径（`src/ui/dynamic-jersey.js`），Chrome harness 实证 applied=12；字号同步放大 20%。
8. **14 人满编零撞脸（2026-08-01）**：新增 13 号何水生（50 岁鱼塘养殖户、光头）、14 号梁师傅（58 岁竹编手艺人、白发山羊胡），同管线生成切片应用（rural_13/rural_14）；`BLUE_FACE_ORDER=[11,8,9,10,12,13,14]`，红方 1–7、蓝方 8–14 完全零重叠（12 人时被迫共享 2 个号码的数学下限消除）。

## 验证

- 样品角色 01 全链路通过：切片校验（尺寸/RGBA/透明角）、洋红残边 0、头部 69×73 锁定包围盒、身体部件校验、联系表渲染。
- 12 人母版齐全后跑 `.tmp/cdp/driver/slice-all.mjs` 逐人切片 + 联系表，再拼阵容总览；任何一人不合格会在日志标出并跳过。
