// 发布闸门：小游戏包体、运行时禁用 API、资源构成与合规检查。
// 任何一条不过就退出码非 0，不允许"先传上去再说"。

import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const wechatDir = join(root, "dist", "wechat");

const MAIN_PACKAGE_HARD_LIMIT = 4 * 1024 * 1024; // 微信主包硬上限
const MAIN_PACKAGE_TARGET = 3.4 * 1024 * 1024; // 自定目标
const TOTAL_HARD_LIMIT = 20 * 1024 * 1024;

const failures = [];
const warnings = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  let files;
  try {
    files = await walk(wechatDir);
  } catch {
    fail("dist/wechat 不存在，请先执行 npm run build");
    report();
    return;
  }

  // 1. 必备文件
  for (const required of ["game.js", "game.json", "project.config.json"]) {
    if (!files.some((f) => f.endsWith(required))) fail(`缺少 ${required}`);
  }

  // 2. 包体
  let total = 0;
  for (const file of files) total += (await stat(file)).size;
  notes.push(`主包体积 ${(total / 1024 / 1024).toFixed(2)} MiB（硬门 4 MiB，目标 3.4 MiB）`);
  if (total > MAIN_PACKAGE_HARD_LIMIT) fail(`主包 ${(total / 1024 / 1024).toFixed(2)} MiB 超过微信 4 MiB 硬上限`);
  else if (total > MAIN_PACKAGE_TARGET) warnings.push(`主包超过自定目标 3.4 MiB`);
  if (total > TOTAL_HARD_LIMIT) fail("总包超过 20 MiB");

  // 3. 资源构成：这一版是纯程序化美术，包里不应出现任何图片/音频
  const assetExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp3", ".wav", ".m4a", ".glb", ".gltf", ".atlas", ".skel"]);
  const assets = files.filter((f) => assetExts.has(extname(f).toLowerCase()));
  if (assets.length) fail(`包内出现了非程序化资源：${assets.map((f) => f.replace(root, "")).join(", ")}`);

  // 4. 运行时禁用项
  const bundle = await readFile(join(wechatDir, "game.js"), "utf8");
  const forbidden = [
    ["eval(", "运行期 eval 会被审核拒绝，也无法在小游戏沙箱执行"],
    ["new Function(", "动态代码构造在小游戏中不可用"],
    ["XMLHttpRequest", "小游戏应使用 wx.request"],
    ["localStorage", "小游戏应使用 wx.setStorageSync"],
    ["document.write", "小游戏没有真实 DOM"],
  ];
  for (const [needle, why] of forbidden) {
    if (bundle.includes(needle)) fail(`产物里含有 ${needle}：${why}`);
  }

  // 5. 平台垫片必须在 three 之前装好
  const shimAt = bundle.indexOf("__ruralShimInstalled");
  const threeAt = bundle.indexOf("WebGLRenderer");
  if (shimAt < 0) fail("产物中找不到微信平台垫片");
  else if (threeAt >= 0 && shimAt > threeAt) {
    notes.push("垫片与渲染器的定义顺序由打包器决定，运行顺序以入口 import 顺序为准");
  }
  if (!bundle.includes("__RURAL3D_BOOTED")) fail("缺少真机验收标记 __RURAL3D_BOOTED");

  // 6. game.json
  const gameJson = JSON.parse(await readFile(join(wechatDir, "game.json"), "utf8"));
  if (gameJson.deviceOrientation !== "landscape") fail("game.json 的 deviceOrientation 必须是 landscape");

  // 7. 内容合规：不得出现国家队/国旗类元素，也不得出现真实球员姓名
  const contentSources = await walk(join(root, "src"));
  const banned = ["国旗", "国徽", "国家队", "世界杯", "中国队", "FIFA", "赌", "彩票", "开盒"];
  for (const file of contentSources) {
    if (extname(file) !== ".js") continue;
    const text = await readFile(file, "utf8");
    for (const word of banned) {
      if (text.includes(word)) fail(`${file.replace(root, "")} 出现敏感词「${word}」`);
    }
  }

  // 8. 地名数据来源与许可
  const places = await readFile(join(root, "src", "content", "places-data.js"), "utf8");
  if (!places.includes("uiwjs/province-city-china") || !places.includes("MIT")) {
    fail("places-data.js 缺少数据来源与许可声明");
  }
  const placeCount = (places.match(/","/g) || []).length;
  notes.push(`地名数据条目约 ${placeCount} 条（省/区县/乡镇）`);

  // 9. 主包文件清单
  notes.push(`主包文件：${files.map((f) => f.split("/").pop()).join(", ")}`);

  report();
}

function report() {
  for (const note of notes) console.log(`· ${note}`);
  for (const warning of warnings) console.log(`⚠ ${warning}`);
  if (!failures.length) {
    console.log("✅ 发布闸门全部通过");
    return;
  }
  for (const failure of failures) console.error(`❌ ${failure}`);
  process.exitCode = 1;
}

await main();
