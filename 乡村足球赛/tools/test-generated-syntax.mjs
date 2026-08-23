import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = path.join(projectDir, "generated");
const files = fs.readdirSync(generatedDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(generatedDir, name));

files.push(
  path.join(projectDir, "game.js"),
  path.join(projectDir, "runtime-assets", "game.js"),
  path.join(projectDir, "region_data", "game.js"),
);

assert.ok(files.length >= 8, "生成模块语法门必须覆盖完整主包与两个分包入口");
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${path.relative(projectDir, file)} 语法无效：\n${result.stderr || result.stdout}`,
  );
}

console.info(`[test:generated-syntax] PASS：${files.length} 个主包/分包 JS 文件语法有效`);
