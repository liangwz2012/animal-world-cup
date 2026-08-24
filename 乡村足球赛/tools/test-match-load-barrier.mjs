import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = await fs.readFile(path.join(projectDir, "generated/standalone.static.js"), "utf8");
const appSource = await fs.readFile(path.join(projectDir, "src/app/main.js"), "utf8");

for (const marker of [
  "parallelLoadStartedAt",
  "game.load begin (parallel)",
  "fans.load begin (parallel)",
  "if(barrierEntered||!fansReady||!gameReady)return",
  'emitLoadStage("parallel-start")',
  'emitLoadStage("game-ready")',
  'emitLoadStage("fans-ready")',
  'emitLoadStage("barrier-ready")',
  "fansMs=",
  "gameMs=",
  "barrierMs=",
  "__RURAL_MATCH_LOAD_METRICS__",
  "firstFrameMs",
]) assert.ok(generated.includes(marker), `缺少比赛并行加载标记：${marker}`);

const startIndex = generated.indexOf('emitLoadStage("parallel-start"),beginGameLoad()');
const fansIndex = generated.indexOf('fans.load(settings("DEFAULTS_ROOT")', startIndex);
assert.ok(startIndex > 0 && fansIndex > startIndex, "game.load 必须在 fans.load 等待结束前启动");
assert.ok(generated.includes("fans.load timeout: continue without dynamic fans"), "观众超时降级必须保留");
assert.ok(appSource.includes("82 + raw * 0.14"), "比赛资源真实进度必须映射到82%-96%");
assert.ok(appSource.includes('loadingEvents.addEventListener("ab-load-stage"'), "主包必须消费双就绪阶段事件");
assert.ok(appSource.includes("parallelLoadState.fans && parallelLoadState.game"), "进度98%必须由双就绪状态共同决定");

console.info("[test-match-load-barrier] PASS：观众/比赛并行启动、双就绪屏障、超时降级与82%-98%阶段进度正常");
