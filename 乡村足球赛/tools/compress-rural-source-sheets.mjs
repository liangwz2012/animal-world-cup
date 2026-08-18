import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRuralManifest } from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const rosterDir = path.join(projectDir, "美术整体替换包", "乡村队12人", "players");

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifest = await readRuralManifest(projectDir);
  let inputBytes = 0;
  let outputBytes = 0;
  let converted = 0;
  for (const player of manifest.players) {
    const playerDir = path.join(rosterDir, player.id);
    const source = path.join(playerDir, "source-sheet.png");
    const target = path.join(playerDir, "source-sheet.webp");
    if (await exists(source)) {
      inputBytes += (await fs.stat(source)).size;
      await sharp(source)
        .resize({ width: 768, height: 432, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 68, effort: 4, smartSubsample: true })
        .toFile(target);
      const metadata = await sharp(target).metadata();
      if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
        throw new Error(`${player.id} 压缩参考图验证失败`);
      }
      await fs.rm(source);
      converted += 1;
    }
    if (await exists(target)) outputBytes += (await fs.stat(target)).size;
  }
  const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  console.info(`[art:rural-compress] PASS：转换 ${converted} 张；高清 PNG ${mib(inputBytes)} MiB → WebP 参考图总计 ${mib(outputBytes)} MiB`);
}

main().catch((error) => {
  console.error("[art:rural-compress] FAIL", error && error.message || error);
  process.exitCode = 1;
});

