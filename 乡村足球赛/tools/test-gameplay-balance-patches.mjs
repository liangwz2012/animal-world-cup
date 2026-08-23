import assert from "node:assert/strict";
import fs from "node:fs";

const match = fs.readFileSync(new URL("../generated/match.static.js", import.meta.url), "utf8");
const standalone = fs.readFileSync(new URL("../generated/standalone.static.js", import.meta.url), "utf8");

assert.match(
  match,
  /HumanDribble[\s\S]{0,1800}controller\.sprint\.isActive\?[^:;,]+\.run\(\):[^;,]+controller\.walk\.isActive/,
  "持球队员按住冲刺时必须从带球速度提升到普通跑速",
);
assert.match(
  match,
  /ClientDribble[\s\S]{0,500}controller\.sprint\.isActive\?[^:;,]+\.run\(\):/,
  "联网客户端持球状态必须保留相同冲刺语义",
);
assert.doesNotMatch(standalone, /gk nerf \(play\)/, "不得继续全局削弱双方门将");
assert.match(standalone, /goalkeeper base attributes preserved/, "构建产物必须明确保留门将基础参数");
assert.match(standalone, /bp2&&!bp2\.isGoalkeeper&&/, "客队简单难度平衡必须排除门将");
assert.doesNotMatch(
  standalone,
  /bp2&&!bp2\.isGoalkeeper&&[^}]{0,500}catchSpeed\*=\.8/,
  "客队门将接球速度不得被二次削弱",
);

console.info("[test:gameplay-balance-patches] PASS：持球冲刺和门将公平性补丁已进入构建产物");
