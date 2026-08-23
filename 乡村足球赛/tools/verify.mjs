import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function walk(root) {
  const result = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

function sumBytes(stats) {
  return stats.reduce((sum, item) => sum + item.size, 0);
}

async function main() {
  const required = [
    "generated/pixi.static.js",
    "generated/swig.static.js",
    "generated/shim.static.js",
    "generated/match.static.js",
    "generated/standalone.static.js",
    "generated/build-manifest.json",
    "runtime-assets/game.js",
    "runtime-assets/runtime-text-assets.js",
    "runtime-assets/match-runtime-min/data/defaults.json",
    "runtime-assets/match-runtime-min/data/player.json",
    "runtime-assets/match-runtime-min/data/teams/argentina/team.json",
    "runtime-assets/match-runtime-min/data/teams/portugal/team.json",
    "runtime-assets/match-runtime-min/images/indicators.json",
    "runtime-assets/match-runtime-min/images/indicators.png",
    "runtime-assets/rural-football/audio/ui_click.mp3",
    "shell-assets/brand-logo.png",
    "shell-assets/football.png",
    "shell-assets/portraits/argentina.png",
  ];
  for (const relative of required) {
    if (!await exists(path.join(projectDir, relative))) throw new Error(`缺少构建产物: ${relative}`);
  }

  const gameEntry = await fs.readFile(path.join(projectDir, "game.js"), "utf8");
  if (!gameEntry.includes("reportBootstrapFatal") || !gameEntry.includes("try {")) {
    throw new Error("game.js 缺少同步入口异常保护，顶层 require 失败会直接黑屏");
  }

  const deployableRoots = ["game.js", "src", "generated", "runtime-assets", "shell-assets"];
  const jsFiles = [];
  for (const relative of deployableRoots) {
    const absolute = path.join(projectDir, relative);
    const stat = await fs.stat(absolute);
    if (stat.isFile()) jsFiles.push(absolute);
    else jsFiles.push(...(await walk(absolute)).filter((file) => file.endsWith(".js")));
  }
  for (const file of jsFiles) {
    const source = await fs.readFile(file, "utf8");
    const newFunction = source.match(/\bnew\s+Function\s*\(/g) || [];
    const directEval = source.match(/(^|[^\w$])eval\s*\(/g) || [];
    if (newFunction.length || directEval.length) {
      throw new Error(`${path.relative(projectDir, file)} 含动态代码: new Function=${newFunction.length}, eval=${directEval.length}`);
    }
    if (file.startsWith(path.join(projectDir, "src"))
      && /Object\.(?:entries|fromEntries)\s*\(/.test(source)) {
      throw new Error(`${path.relative(projectDir, file)} 使用 Object.entries/fromEntries；旧版微信开发工具会错误生成缺失的 Babel helper`);
    }
    if (file.startsWith(path.join(projectDir, "src"))
      && /\bwx\.(?:getFuzzyLocation|getLocation)\s*\(/.test(source)) {
      throw new Error(`${path.relative(projectDir, file)} 调用了定位接口；本版本明确采用手动选择家乡，不申请位置权限`);
    }
  }

  const generatedMatch = await fs.readFile(path.join(projectDir, "generated/match.static.js"), "utf8");
  const generatedShim = await fs.readFile(path.join(projectDir, "generated/shim.static.js"), "utf8");
  const generatedStandalone = await fs.readFile(path.join(projectDir, "generated/standalone.static.js"), "utf8");
  if (!generatedMatch.includes("Object.defineProperty(n,\"name\"")) throw new Error("状态构造器静态替换未生效");
  if (!generatedMatch.includes("__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__")) throw new Error("原版指示器仍依赖易失 Pixi 全局纹理缓存");
  if (!generatedMatch.includes("dynamic rural villagers placed:")) throw new Error("原生动态村民观众未接入");
  if (!generatedMatch.includes("Math.min(t.fans.maxSkins||24,i.length)")) throw new Error("动态观众低内存皮肤上限未生效");
  if (!generatedMatch.includes("t.fans.renderScale||4")) throw new Error("动态观众 4x 纹理上限未生效");
  if (!generatedMatch.includes("__rfHead") || !generatedMatch.includes("lookAtBall:")) throw new Error("动态观众头部追球层未接入");
  if (!generatedMatch.includes("lookAngle=Math.atan2(1024-O,2048-M)")
    || !generatedMatch.includes("baseRotation=lookAngle+Math.PI/2")) {
    throw new Error("动态观众未按座位朝向球场中央");
  }
  if (generatedMatch.includes('Texture.fromFrame("indicators/sight.png")')) throw new Error("sight 指示器仍直接调用 Texture.fromFrame");
  if (generatedMatch.includes('Sprite.fromFrame("indicators/header.png")')) throw new Error("header 指示器仍直接调用 Sprite.fromFrame");
  if (!generatedShim.includes("entry.deps || []")) throw new Error("AMD 依赖注入修复未生效");
  if (!generatedShim.includes("unresolved module:")) throw new Error("unresolved 模块仍可能静默降级");
  if (!generatedStandalone.includes("view:window.__ruralFootballScreenCanvas")) throw new Error("主 Canvas 显式注入未生效");
  if (!generatedStandalone.includes("globalThis.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT__")) throw new Error("原版控制器未绑定共享触控对象");
  if (!generatedStandalone.includes("__ORIGINAL_RUNTIME_TOUCH_BINDING_OK__")) throw new Error("原版触控同引用运行时闸门缺失");
  if (!generatedStandalone.includes("__ORIGINAL_RUNTIME_PLAY_MODE_OK__=!0")) throw new Error("单人操控模式未被强制打开");
  if (!generatedStandalone.includes("__ORIGINAL_RUNTIME_FORCE_HUMAN_CONTROL__")) throw new Error("红队球员立即认领逻辑缺失");
  if (!generatedStandalone.includes("__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__")) throw new Error("玩家操控运行时硬标记缺失");
  if (!generatedStandalone.includes("__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT_2__")) throw new Error("原版第二玩家输入绑定缺失");
  if (!generatedStandalone.includes("guest render-only sync bridge unavailable")) throw new Error("好友客机缺少禁止本地物理的硬闸门");
  if (!generatedStandalone.includes("matchSync&&matchSync.hostTick")) throw new Error("房主权威帧导出未接入原版主循环");
  if (!generatedStandalone.includes("reset stale user failed")) throw new Error("重赛前旧用户绑定释放逻辑缺失");
  if (!generatedStandalone.includes("critical texture cache gate failed: indicators/sight.png")) throw new Error("比赛启动缺少关键纹理缓存硬闸门");
  if (!generatedStandalone.includes("safe profile: skip dynamic fans atlas")) throw new Error("安全设备画像仍可能卡在动态观众图集生成");
  if (!generatedStandalone.includes("fans.load timeout: continue without dynamic fans")) throw new Error("桌面动态观众加载缺少超时兜底");
  if (generatedStandalone.includes("RuntimeBackedGame") || generatedStandalone.includes("fallback")) throw new Error("发现不允许的回退路径");

  const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
  const appSource = await fs.readFile(path.join(projectDir, "src/app/main.js"), "utf8");
  const touchSource = await fs.readFile(path.join(projectDir, "src/input/touch.js"), "utf8");
  const platformSource = await fs.readFile(path.join(projectDir, "src/platform/adapter.js"), "utf8");
  const gameOptionsSource = await fs.readFile(path.join(projectDir, "src/data/game-options.js"), "utf8");
  if (!bootSource.includes("createTouchControlsOverlay")) throw new Error("B2 未接入可见 Pixi 控制层");
  if (!bootSource.includes("resolveRuntimePixi")) throw new Error("原版 AMD pixi 模块恢复逻辑缺失");
  if (!bootSource.includes("B2_CONTROLS_FAILED")) throw new Error("控制层失败闸门缺失");
  if (!bootSource.includes("B1_CRITICAL_TEXTURES_READY")) throw new Error("关键图集未在比赛启动前硬预载");
  if (!bootSource.includes("B2_TEXTURE_CACHE_RESTORED")) throw new Error("关键纹理缓存缺少静默自恢复路径");
  if (!bootSource.includes("__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__")) throw new Error("关键纹理私有引用读取器缺失");
  // 恢复原生座位/遮罩/镜头系统，但只生成动态村民皮肤；超时仍可降级进比赛。
  if (!bootSource.includes("dynamic-rural-fans")) throw new Error("动态村民观众设备画像缺失");
  if (!bootSource.includes("const mobileSafeFans = false")) throw new Error("动态村民观众仍被全平台关闭");
  if (!bootSource.includes("B2_SLOW_LOAD")) throw new Error("首次资源缓存缺少非致命延时兜底");
  if ((bootSource.match(/bindMatchSyncState\(root, inputHost, matchSync\)/g) || []).length < 3) throw new Error("第二玩家输入缺少加载前、加载后及开赛前 runtime window 重绑定");
  if (!bootSource.includes("B1_TOUCH2_DEGRADED")) throw new Error("单机缺少 touchInput2 非致命降级保护");
  if (!appSource.includes("createFriendMatchCoordinator")) throw new Error("应用层未接入好友房协调器");
  if (!appSource.includes("getLaunchOptionsSync") || !appSource.includes("onShow")) throw new Error("好友邀请冷/热启动入口未接入");
  if (!appSource.includes("handleFriendLaunchOptions") || !appSource.includes("好友对战暂未开放")) {
    throw new Error("远程开关关闭时仍可能从邀请或诊断入口提前连接好友服务");
  }
  if (!appSource.includes("campaign: campaignView(),\n        onlineFeatures,")) {
    throw new Error("启动早期缓存的云端开关没有传入首页，后期开启好友入口可能不生效");
  }
  if (!appSource.includes("82 + raw * 0.16")) throw new Error("比赛核心资源进度未映射到 82%-98%");
  if (bootSource.includes('reportFatal(new Error("B3 操控失败')) throw new Error("B3 可恢复操控问题不应再显示阻塞式致命弹窗");
  if (!touchSource.includes("primary.active = true")) throw new Error("松手归零所需的持续 active 语义缺失");
  if (!platformSource.includes('navigator, "getGamepads", () => []')) throw new Error("微信真机缺少 Gamepad API 的逐帧异常兼容未生效");
  if (appSource.includes("DEV_AUTO_START_AI = true")) throw new Error("开发者工具自动开赛标记不得进入可交付构建");
  if (appSource.includes("DEV_AUTO_SHOW_RESULT = true")) throw new Error("开发者工具自动赛果标记不得进入可交付构建");
  if (appSource.includes("DEV_AUTO_RETURN_HOME_REMATCH = true")) throw new Error("开发者工具自动返回重赛标记不得进入可交付构建");
  if (appSource.includes("beginMatchmaking") || appSource.includes("promptAiFallback")) throw new Error("首发审核包仍包含未接通的真人匹配逻辑");
  if (gameOptionsSource.includes('"online"')) throw new Error("首发审核包不得包含 online 模式");

  const gameConfig = JSON.parse(await fs.readFile(path.join(projectDir, "game.json"), "utf8"));
  const projectConfig = JSON.parse(await fs.readFile(path.join(projectDir, "project.config.json"), "utf8"));
  if (projectConfig.setting && projectConfig.setting.uploadWithSourceMap !== false) {
    throw new Error("上传包必须关闭 Source Map；开发者工具会把生成的映射文件计入 4 MiB 主包源代码体积");
  }
  const ignoredFolders = new Set((projectConfig.packOptions && projectConfig.packOptions.ignore || [])
    .filter((item) => item.type === "folder")
    .map((item) => item.value));
  const subpackageRoots = (gameConfig.subpackages || []).map((item) => item && item.root).filter(Boolean);
  const allFiles = await walk(projectDir);
  const isSubpackageFile = (file) => subpackageRoots.some((root) => file.startsWith(path.join(projectDir, root)));
  const isIgnoredFile = (file) => [...ignoredFolders].some((folder) => file === path.join(projectDir, folder)
    || file.startsWith(`${path.join(projectDir, folder)}${path.sep}`));
  const mainFiles = allFiles.filter((file) => !isSubpackageFile(file)
    && !isIgnoredFile(file)
    && !file.startsWith(path.join(projectDir, "tools"))
    && !file.startsWith(path.join(projectDir, "server"))
    && !file.endsWith("README.md")
    && !file.endsWith("package.json"));
  const subpackageFiles = allFiles.filter(isSubpackageFile);
  const [mainStats, subpackageStats] = await Promise.all([
    Promise.all(mainFiles.map((file) => fs.stat(file))),
    Promise.all(subpackageFiles.map((file) => fs.stat(file))),
  ]);
  const mainBytes = sumBytes(mainStats);
  const subpackageBytes = sumBytes(subpackageStats);
  if (mainBytes > 4 * 1024 * 1024) throw new Error(`主包静态体积超过 4 MiB 预警线: ${mainBytes}`);
  if (mainBytes + subpackageBytes > 20 * 1024 * 1024) throw new Error(`主包与资源分包总量超过 20 MiB 预警线: ${mainBytes + subpackageBytes}`);

  if (!ignoredFolders.has("server")) throw new Error("房间服务端目录必须从微信小游戏上传包中排除");
  if (!ignoredFolders.has("node_modules")) throw new Error("本地依赖目录必须从微信小游戏上传包中排除");
  if (!ignoredFolders.has("source-assets")) throw new Error("独立构建源素材目录必须从微信小游戏上传包中排除");
  if (!ignoredFolders.has(".tmp")) throw new Error("临时生图与切片目录必须从微信小游戏上传包中排除");
  if (!ignoredFolders.has("乡村足球赛人物头像")) throw new Error("头像资料压缩包必须从微信小游戏上传包中排除");
  if (!ignoredFolders.has("提审素材")) throw new Error("提审截图素材必须从微信小游戏上传包中排除");
  const ignoredUploadFiles = new Set((projectConfig.packOptions && projectConfig.packOptions.ignore || [])
    .filter((item) => item.type === "file")
    .map((item) => item.value));
  if (!ignoredUploadFiles.has("project.private.config.json")) {
    throw new Error("私有项目配置必须从微信小游戏上传包中排除");
  }
  const runtimePackage = (gameConfig.subpackages || []).find((item) => item.name === "runtime-assets");
  if (!runtimePackage || runtimePackage.root !== "runtime-assets") {
    throw new Error("game.json 未正确声明 runtime-assets 普通分包");
  }
  if (runtimePackage.independent === true && subpackageBytes > 4 * 1024 * 1024) {
    throw new Error(`runtime-assets 被声明为独立分包且超过 4 MiB: ${subpackageBytes}`);
  }
  const regionPackage = (gameConfig.subpackages || []).find((item) => item.name === "region_data");
  if (!regionPackage || regionPackage.root !== "region_data") {
    throw new Error("game.json 未正确声明 region_data 行政区划分包");
  }

  console.info("[verify] PASS：动态代码、AMD 注入、主 Canvas 与资源键静态检查通过");
  console.info(`[verify] 主包约 ${(mainBytes / 1024 / 1024).toFixed(2)} MiB；资源分包约 ${(subpackageBytes / 1024 / 1024).toFixed(2)} MiB`);
  console.info("[verify] PACKAGE PASS：主包低于 4 MiB，普通资源分包与总包低于 20 MiB");
  console.info("[verify] 注意：PASS 只代表静态门，不代表微信 WebGL 已出现可见首帧");
}

main().catch((error) => {
  console.error("[verify] FAIL", error);
  process.exitCode = 1;
});
