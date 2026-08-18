import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const gameConfig = JSON.parse(await fs.readFile(path.join(projectDir, "game.json"), "utf8"));
const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
const runtimePackage = (gameConfig.subpackages || []).find((item) => item.root === "runtime-assets");
const regionPackage = (gameConfig.subpackages || []).find((item) => item.root === "region_data");

assert.deepEqual(runtimePackage, { name: "runtime-assets", root: "runtime-assets" });
assert.match(bootSource, /name:\s*["']runtime-assets["']/);
assert.doesNotMatch(bootSource, /name:\s*["']runtimeAssets["']/);
assert.match(await fs.readFile(path.join(projectDir, "runtime-assets/game.js"), "utf8"), /module\.exports/);
assert.deepEqual(regionPackage, { name: "region_data", root: "region_data" });
assert.match(await fs.readFile(path.join(projectDir, "region_data/game.js"), "utf8"), /module\.exports/);
const regionModules = (await fs.readdir(path.join(projectDir, "region_data"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name);
for (const file of regionModules) {
  assert.match(file, /^[a-z0-9_]+\.js$/, `微信分包模块名不允许连字符或中文：region_data/${file}`);
}

console.info("[test-runtime-subpackage-identity] PASS：分包名称、入口和 region_data 模块命名符合微信规则");
