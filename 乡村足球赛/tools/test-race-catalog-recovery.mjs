import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalog = require("../generated/rural-race-catalog.static.js");
const { ensureRuntimeRaceCatalog } = require("../src/boot/start.js");

assert.equal(Object.keys(catalog).length, 16, "主包自愈目录必须包含 15 套乡村 race 和 1 套结构模板");
assert.ok(catalog.rural_v2_01, "主包自愈目录必须包含金标准队长");
assert.ok(catalog.skeleton, "主包自愈目录必须包含引擎结构模板 skeleton");

const collection = [{ id: "skeleton", skin: {} }];
const races = {
  get(id) { return collection.find((entry) => entry.id === id) || null; },
  all() { return collection; },
};
const runtimeRequire = (id) => {
  if (id === "races") return races;
  throw new Error(`unexpected runtime module: ${id}`);
};
const root = { require: runtimeRequire };
const inputHost = {};

let status = ensureRuntimeRaceCatalog(root, inputHost);
assert.equal(status.available, 16);
assert.equal(status.repaired, 15, "仅含 skeleton 的热更新 race 集合必须一次补齐 15 套人物");
assert.deepEqual(status.missing, []);
assert.match(races.get("rural_v2_01").skin.head_front.name, /^data\/player\/races\/rural_v2_01\/head\.png$/);
assert.ok(races.get("skeleton"), "结构模板不得在自愈时丢失");

status = ensureRuntimeRaceCatalog(root, inputHost);
assert.equal(status.repaired, 0, "重复修复必须幂等，不能重复插入 race");
assert.equal(collection.filter((entry) => entry.id === "rural_v2_01").length, 1);

const generatedMatch = fs.readFileSync(new URL("../generated/match.static.js", import.meta.url), "utf8");
const generatedStandalone = fs.readFileSync(new URL("../generated/standalone.static.js", import.meta.url), "utf8");
assert.match(generatedMatch, /Missing player race:/, "球队单皮肤读取前必须有空值自愈门");
assert.match(generatedMatch, /Missing shared player race:/, "球队共享皮肤读取前必须有空值自愈门");
assert.match(generatedStandalone, /__RURAL_ENSURE_RACE_CATALOG__/, "setupCollections 后必须重新注入乡村 race");
assert.match(generatedStandalone, /__ruralRevealDone/, "比赛首帧显示必须幂等");
assert.match(generatedStandalone, /setTimeout\(reveal,3500\)/, "RAF 暂停时必须有独立首帧超时保险");

const textAssets = require("../runtime-assets/runtime-text-assets.js");
const dirlist = JSON.parse(textAssets["/match-runtime-min/__dirlist.json"]);
const indexedRaces = new Set(dirlist["/data/player/races"] || []);
for (const id of Object.keys(catalog)) assert.ok(indexedRaces.has(id), `运行目录索引缺少 ${id}`);

console.info("[test-race-catalog-recovery] PASS：旧目录、热更新缓存和 teams.skin 空值三层自愈正常");
