import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const buildSource = await fs.readFile(path.join(toolsDir, "build.mjs"), "utf8");

assert.match(buildSource, /async function syncStagedTree\(sourceDir, targetDir\)/);
assert.match(buildSource, /await fs\.rename\(source, target\)/);
assert.match(buildSource, /await syncStagedTree\(assetsStagingDir, assetsDir\)/);
assert.doesNotMatch(buildSource, /await fs\.rm\(assetsDir, \{ recursive: true, force: true \}\)/);

// 实际运行一遍构建，并在其间高频读取分包入口。若未来又改回“删目录再搬回”，
// 这个循环会观察到 game.js 不存在，直接阻止交付。
const projectDir = path.resolve(toolsDir, "..");
const gameEntrypoint = path.join(projectDir, "runtime-assets/game.js");
const before = await fs.readFile(gameEntrypoint, "utf8");
assert.match(before, /module\.exports/);

function startBuild() {
  const child = spawn(process.execPath, ["tools/build.mjs"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
  return { child, result };
}

// 两个独立构建同时运行，验证暂存区不会互相清理，也验证分包入口在全程可读取。
const builds = [startBuild(), startBuild()];
let finished = false;
const completion = Promise.all(builds.map(({ result }) => result)).then((results) => {
  finished = true;
  return results;
});
while (!finished) {
  try { await fs.access(gameEntrypoint); } catch (error) {
    for (const { child } of builds) child.kill();
    throw new Error(`构建期间分包入口消失: ${error && error.message || error}`);
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
}
for (const { code, output } of await completion) assert.equal(code, 0, output);
assert.match(await fs.readFile(gameEntrypoint, "utf8"), /module\.exports/);

console.info("[test-build-output-sync] PASS：并发构建全程分包入口存在，暂存区与输出采用安全隔离/原子替换");
