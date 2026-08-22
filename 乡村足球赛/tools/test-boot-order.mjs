import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 真机启动失败的根因防线：引擎 i18n 等 AMD 模块在 require 时会通过文件 shim
// 同步读取 runtime-assets 分包内的语言目录并立即激活默认语言（en）。
// 真机上分包文件只有在 loadSubpackage 完成后才落盘；开发者工具里文件本来就在
// 本地磁盘，所以这个顺序依赖只有真机能暴露。任何把引擎 require 挪到分包 await
// 之前（例如“并行加速”）都会在真机上抛 "Unknown language code: en" 启动失败。
const startSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");

const awaitIdx = startSource.indexOf("await loadRuntimeSubpackage(");
assert.ok(awaitIdx > 0, "bootOriginalRuntime 必须显式 await runtime-assets 分包加载");

const regionIdx = startSource.indexOf("loadRegionDataSubpackage(wxApi)", awaitIdx);
const regionAwaitIdx = startSource.indexOf("await regionDataLoad", awaitIdx);
assert.ok(regionIdx > awaitIdx && regionAwaitIdx > awaitIdx, "region_data 分包必须在引擎加载前落盘（原生端入口注册不允许含点号模块名）");

const engineRequires = [
  'require("../../generated/swig.static")',
  'require("../../generated/shim.static")',
  'require("../../generated/match.static")',
  'require("../../generated/standalone.static")',
];
for (const marker of engineRequires) {
  const idx = startSource.indexOf(marker);
  assert.ok(idx > regionAwaitIdx, `${marker} 必须出现在两个分包 await 之后（分包落盘后才允许加载引擎模块）`);
}

const detached = startSource.indexOf("= loadRuntimeSubpackage(");
assert.equal(detached, -1, "分包加载不得拆成可分离的 Promise 后再 await（禁止并行化回归）");

const matchSource = await fs.readFile(path.join(projectDir, "generated/match.static.js"), "utf8");
assert.ok(
  matchSource.includes("Unknown language code"),
  "引擎应保留 i18n 语言注册表检查；若该检查消失，需要重新评估本顺序门的假设",
);

console.info("[test:boot-order] PASS：引擎模块加载严格位于分包落盘之后，i18n 顺序依赖防线存在");
