import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const sourceDir = process.argv[2];

if (!sourceDir) {
  throw new Error("用法：node tools/sync-administrative-regions.mjs <province-city-china/packages/core/dist>");
}

async function readRows(name) {
  const target = path.join(sourceDir, `${name}.min.json`);
  const payload = JSON.parse(await fs.readFile(target, "utf8"));
  if (!Array.isArray(payload) || !payload.length) throw new Error(`${target} 不是有效行政区列表`);
  return payload;
}

function outputModule(header, payload) {
  return `${header}\n\nmodule.exports = ${JSON.stringify(payload)};\n`;
}

const [provinces, cities, areas, towns] = await Promise.all([
  readRows("province"),
  readRows("city"),
  readRows("area"),
  readRows("town"),
]);

const source = {
  provider: "uiwjs/province-city-china",
  sourceCommit: "ca2ada5ea608b57c7b0178aa568ced6e363b57f7",
  retrievedAt: "2026-07-29",
  license: "MIT",
  levels: ["province", "city", "county", "town"],
};
const core = { source, provinces, cities, areas };
const townsPayload = { source, towns };

await fs.mkdir(path.join(projectDir, "region_data"), { recursive: true });
await fs.writeFile(
  path.join(projectDir, "src/data/china-administrative-core.js"),
  outputModule("// 自动生成：全国省、市、县区快照。来源与许可证见 region_data/NOTICE.md。", core),
);
// 乡镇数据必须打进单个自包含 game.js：微信原生端执行分包内 require("./xxx") 时，
// 会把 "region_data/xxx.js"（含点号）拿去注册模块名并判定非法，镇级选择直接崩。
// 分包内不得再保留第二个 .js 文件，目录与模块名均使用下划线。
await fs.writeFile(
  path.join(projectDir, "region_data/game.js"),
  outputModule("// 自动生成：全国乡镇/街道快照（自包含单模块）。来源与许可证见 region_data/NOTICE.md。", townsPayload),
);
await fs.rm(path.join(projectDir, "region_data/china_administrative_towns.js"), { force: true });

console.info(`[sync-administrative-regions] 已生成：省 ${provinces.length}，市 ${cities.length}，县区 ${areas.length}，乡镇 ${towns.length}`);
