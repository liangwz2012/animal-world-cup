import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BODY_PROFILES,
  MAX_VISUAL_SCALE,
  MIN_VISUAL_SCALE,
  PLAYER_PROFILE_SEQUENCE,
  createBodyProfileController,
} = require("../src/data/player-body-profiles.js");
const { RURAL_SQUAD } = require("../src/data/rural-squad.js");
const runtimeModuleSource = fs.readFileSync(
  new URL("../src/data/player-body-profiles.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  runtimeModuleSource,
  /Object\.(?:entries|fromEntries)\s*\(/,
  "旧版微信开发工具会把 Object.entries/fromEntries 错译成不存在的 Babel helper",
);

assert.equal(PLAYER_PROFILE_SEQUENCE.length, 7, "七人制双方必须各有 7 个确定体型");
assert.ok(new Set(PLAYER_PROFILE_SEQUENCE).size >= 5, "首发七人必须展示至少 5 种体型");
for (const player of RURAL_SQUAD) {
  assert.ok(BODY_PROFILES[player.bodyProfile], `${player.id} 的 bodyProfile 必须存在`);
}
for (const profile of Object.values(BODY_PROFILES)) {
  assert.ok(profile.scaleX >= MIN_VISUAL_SCALE && profile.scaleX <= MAX_VISUAL_SCALE);
  assert.ok(profile.scaleY >= MIN_VISUAL_SCALE && profile.scaleY <= MAX_VISUAL_SCALE);
  for (const value of Object.values(profile.fit)) {
    assert.ok(value >= 0.97 && value <= 1.03, "球衣附件只能做接缝微调，不能二次塑造体型");
  }
}

function fakeRenderer(id, facing) {
  return {
    player: { id },
    defaultScale: 0.5,
    spine: {
      scale: { x: facing < 0 ? -0.5 : 0.5, y: 0.5 },
      ballContainer: { scale: { x: 2, y: 2 } },
    },
  };
}

const captain = fakeRenderer(0, 1);
const courier = fakeRenderer(3, -1);
const blueCaptain = fakeRenderer(7, 1);
const referee = fakeRenderer(900, 1);
const game = {
  stadium: {
    children: [
      { children: [captain, courier, referee] },
      { children: [blueCaptain] },
    ],
  },
};
const target = {};
const controller = createBodyProfileController({ targets: [target] });
const hook = controller.install();
assert.equal(typeof target.__RURAL_BODY_PROFILE_APPLY__, "function");
assert.equal(target.__RURAL_BODY_PROFILE_APPLY__, hook);

let status = hook(game);
assert.equal(status.applied, 3);
assert.equal(referee.__ruralBodyProfile, undefined, "裁判/参考 Renderer 不得误计为球员");
assert.equal(captain.__ruralBodyProfile, "large");
assert.equal(captain.spine.scale.x, 0.54);
assert.equal(captain.spine.scale.y, 0.54);
assert.equal(blueCaptain.spine.scale.x, captain.spine.scale.x, "双方同一位置体型必须一致");
assert.equal(courier.__ruralBodyProfile, "tall-slim");
assert.equal(courier.spine.scale.x, -0.45, "缩放后必须保留朝左方向");
assert.equal(courier.spine.scale.y, 0.55);
assert.equal(courier.spine.ballContainer.scale.x, 1 / 0.45, "足球 X 尺寸必须抵消人物缩放");
assert.equal(courier.spine.ballContainer.scale.y, 1 / 0.55, "足球 Y 尺寸必须抵消人物缩放");

status = controller.setPreview("balanced");
assert.equal(status.previewProfile, "balanced");
assert.equal(captain.spine.scale.x, 0.5);
assert.equal(captain.spine.scale.y, 0.5);
assert.equal(courier.spine.scale.x, -0.5);
assert.throws(() => controller.setPreview("not-a-profile"), /未知球员体型/);
status = controller.setPreview("");
assert.equal(status.previewProfile, "");
assert.equal(captain.spine.scale.x, 0.54, "清除预览后必须恢复名单体型");
status = controller.setPlayerProfile(0, "tall-slim");
assert.equal(status.overrides[0], "tall-slim");
assert.equal(captain.__ruralBodyProfile, "tall-slim", "主队队长必须支持单人视觉体型覆盖");
assert.equal(captain.spine.scale.x, 0.45);
assert.equal(captain.spine.scale.y, 0.55);
assert.equal(blueCaptain.__ruralBodyProfile, "large", "主队队长自定义不得影响客队同位置球员");
assert.throws(() => controller.setPlayerProfile(0, "not-a-profile"), /未知球员体型/);
controller.setPlayerProfile(0, "");
assert.equal(captain.__ruralBodyProfile, "large", "清除单人覆盖后必须恢复名单体型");

// 球衣槽位裁剪：不同体型球员的球衣附件缩放不同，头部附件不受影响，重复应用不叠加
function fakeKitRenderer(id) {
  const renderer = fakeRenderer(id, 1);
  renderer.spine.skeleton = {
    slots: [
      { data: { name: "chest_shirt" }, attachment: { scaleX: 1, scaleY: 1 } },
      { data: { name: "leg_left_shorts" }, attachment: { scaleX: 1, scaleY: 1 } },
      { data: { name: "head" }, attachment: { scaleX: 1, scaleY: 1 } },
    ],
  };
  return renderer;
}
const slimKit = fakeKitRenderer(3);
const stockyKit = fakeKitRenderer(6);
const kitGame = { stadium: { children: [{ children: [slimKit] }, { children: [stockyKit] }] } };
hook(kitGame);
const slimShirt = slimKit.spine.skeleton.slots[0].attachment;
const stockyShirt = stockyKit.spine.skeleton.slots[0].attachment;
assert.ok(Math.abs(slimShirt.scaleX - 0.99 * 1.005) < 1e-6, "高瘦球员胸衣只能轻微收窄接缝");
assert.ok(Math.abs(slimShirt.scaleY - 1.01 * 0.99) < 1e-6, "高瘦球员胸衣只能轻微加长接缝");
assert.ok(Math.abs(stockyShirt.scaleX - 1.01 * 0.995) < 1e-6, "矮壮球员胸衣只能轻微放宽接缝");
assert.ok(Math.abs(stockyShirt.scaleY - 0.99) < 1e-6, "矮壮球员胸衣只能轻微收短接缝");
const stockyShorts = stockyKit.spine.skeleton.slots[1].attachment;
assert.ok(Math.abs(stockyShorts.scaleX - 1.01) < 1e-6, "短裤只能做接缝微调");
assert.equal(slimKit.spine.skeleton.slots[2].attachment.scaleX, 1, "头部附件不得参与球衣裁剪");
hook(kitGame);
assert.ok(Math.abs(stockyShirt.scaleX - 1.01 * 0.995) < 1e-6, "重复应用体型不得叠加缩放");

const buildSource = fs.readFileSync(
  new URL("./build.mjs", import.meta.url),
  "utf8",
);
assert.match(buildSource, /__RURAL_BODY_PROFILE_APPLY__/);
assert.match(
  buildSource,
  /bodyProfileStatus=bodyProfileHook\(mode\.game\);mode\.game\.__ruralBodyProfilesReady=!!\(bodyProfileStatus&&bodyProfileStatus\.applied>=14\)/,
  "体型 Hook 必须等球员渲染器首帧绑定后再完成",
);
assert.match(buildSource, /setupMatch\(this\);this\.game\.__ruralBodyProfilesReady=!1/, "重赛必须重新应用体型");
assert.match(buildSource, /body profiles disabled; keep base scale/, "视觉体型异常必须退回原比例而不是中断比赛");

console.info("[test-player-body-profiles] PASS：5 种体型、脚底根缩放、方向与足球尺寸隔离均正常");
