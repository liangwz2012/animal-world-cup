import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { matchShareTitle, matchShareCaption, generateMatchShareCard } = require("../src/ui/share-card");

// 胜：含"赢了" + 双方名 + 比分
const win = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 3, foeScore: 2 });
assert.ok(win.includes("雄狮") && win.includes("美洲豹"), "胜利标题应含双方队名");
assert.ok(win.includes("3:2") && win.includes("赢了"), "胜利标题应含比分与'赢了'");

// 平：含"平局"
const draw = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 1, foeScore: 1 });
assert.ok(draw.includes("平局") && draw.includes("1:1"), "平局标题应含'平局'与比分");

// 负：含"惜败"，且比分按我方在前
const lose = matchShareTitle({ myName: "雄狮", foeName: "美洲豹", myScore: 0, foeScore: 2 });
assert.ok(lose.includes("惜败") && lose.includes("0:2"), "失利标题应含'惜败'与比分");

// caption 三态
assert.equal(matchShareCaption(2, 2).includes("握手"), true);
assert.ok(matchShareCaption(3, 1).length > 0);
assert.ok(matchShareCaption(1, 3).includes("惜败"));

// 无 wx / 无 createCanvas 时，卡片生成回落空串，不抛错
const a = await generateMatchShareCard(null, { score: [1, 0] });
assert.equal(a, "", "无 wx 环境应回落空串");
const b = await generateMatchShareCard({}, { score: [1, 0] });
assert.equal(b, "", "无 createCanvas 应回落空串");

console.info("[test-share-card] PASS：情绪化标题(胜/平/负)、文案与无canvas回落均正常");
