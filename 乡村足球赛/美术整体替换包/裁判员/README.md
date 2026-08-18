# 标准人类裁判员替换包

本目录使用和球员完全相同的骨架、锚点与运行尺寸，仅替换正背头像、肤色身体分层和黑色裁判服。

- `v2/referee/source-sheet.webp`：低体积三视图参考母版。
- `v2/referee/portrait.png`：192×192 角色头像。
- `v2/referee/head.png` / `head_back.png`：81×77 严格正背头像。
- 其余人体分层严格继承原裁判贴图尺寸。
- `source-assets/public/rural-football/kit-ref/human_*.png`：比赛运行时实际使用的贴图。

正式项目内只保留人类裁判贴图；旧斑马部件已移到父目录 `.tmp` 的可恢复隔离区，不进入构建和上传包。
