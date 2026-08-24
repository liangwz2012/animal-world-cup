import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_LOADING_HINTS,
  LOADING_HINT_INTERVAL_MS,
  buildLoadingHints,
  loadingHintForElapsed,
} = require("../src/ui/loading-hints.js");

assert.equal(LOADING_HINT_INTERVAL_MS, 2400);
assert.deepEqual(buildLoadingHints("正在加载比赛资源"), [
  "正在加载比赛资源",
  "正在准备球员与球场",
  "观众正在入场",
  "加载仍在进行，请稍后",
]);
assert.equal(loadingHintForElapsed("开始加载", 0), "开始加载");
assert.equal(loadingHintForElapsed("开始加载", 2399), "开始加载");
assert.equal(loadingHintForElapsed("开始加载", 2400), "正在准备球员与球场");
assert.equal(loadingHintForElapsed("开始加载", 4800), "观众正在入场");
assert.equal(loadingHintForElapsed("开始加载", 7200), "加载仍在进行，请稍后");
assert.equal(loadingHintForElapsed("开始加载", 9600), "开始加载");
assert.equal(buildLoadingHints(DEFAULT_LOADING_HINTS[0]).length, 4, "默认标题不得重复");

console.info("[test-loading-hints] PASS：加载提示顺序、2.4秒间隔、循环与去重正常");
