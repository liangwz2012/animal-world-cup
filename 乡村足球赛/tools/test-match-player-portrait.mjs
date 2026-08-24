import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { matchPlayerForRuntimeId, matchPlayerPortraitPath } = require("../src/data/match-player-portrait.js");

assert.equal(matchPlayerForRuntimeId(0, "red").id, "butcher-captain");
assert.equal(matchPlayerForRuntimeId(5, "red").id, "shopkeeper-midfielder");
assert.equal(matchPlayerForRuntimeId(7, "blue").id, "doctor-goalkeeper");
assert.equal(matchPlayerForRuntimeId(10, "blue").id, "fishpond-farmer");
assert.equal(matchPlayerForRuntimeId(13, "blue").id, "woman-striker");
assert.match(matchPlayerPortraitPath(5, "red"), /shopkeeper-midfielder\.png$/);
assert.equal(matchPlayerForRuntimeId(5, "red", "england").id, "bamboo-craftsman", "非Argentina红方必须按该球队实际蓝名单映射");
assert.equal(matchPlayerForRuntimeId(12, "blue", "argentina").id, "shopkeeper-midfielder", "Argentina即使位于蓝方也必须使用红名单");
assert.match(matchPlayerPortraitPath(5, "red", "england"), /bamboo-craftsman\.png$/);
assert.equal(matchPlayerForRuntimeId(7, "red"), null, "球员ID与所属方冲突时必须回退");
assert.equal(matchPlayerForRuntimeId(-1, "red"), null);
assert.equal(matchPlayerForRuntimeId(14, "blue"), null);
assert.equal(matchPlayerPortraitPath("bad", "red"), "");

const generated = await fs.readFile(new URL("../generated/standalone.static.js", import.meta.url), "utf8");
for (const marker of ["scorerId:", "scorerSide:", "scoringSide:", "ownGoal:"]) {
  assert.ok(generated.includes(marker), `生成进球事件缺少字段：${marker}`);
}
assert.ok(generated.includes("goalScorer&&Number.isFinite(goalScorer.id)"), "进球事件必须读取实际触球球员ID");

console.info("[test-match-player-portrait] PASS：红蓝14人运行ID、固定名单头像和异常回退正常");
