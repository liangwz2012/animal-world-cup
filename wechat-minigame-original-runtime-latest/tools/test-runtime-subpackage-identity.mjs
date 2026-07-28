import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const gameConfig = JSON.parse(await fs.readFile(path.join(projectDir, "game.json"), "utf8"));
const bootSource = await fs.readFile(path.join(projectDir, "src/boot/start.js"), "utf8");
const runtimePackage = (gameConfig.subpackages || []).find((item) => item.root === "runtime-assets");

assert.deepEqual(runtimePackage, { name: "runtime-assets", root: "runtime-assets" });
assert.match(bootSource, /name:\s*["']runtime-assets["']/);
assert.doesNotMatch(bootSource, /name:\s*["']runtimeAssets["']/);
assert.match(await fs.readFile(path.join(projectDir, "runtime-assets/game.js"), "utf8"), /module\.exports/);

console.info("[test-runtime-subpackage-identity] PASS：分包名称、根目录和加载入口统一为 runtime-assets");
