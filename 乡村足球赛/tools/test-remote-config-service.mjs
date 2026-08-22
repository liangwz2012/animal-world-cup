import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRemoteConfigService, normalizeRemoteConfig } from "../server/remote-config-service.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "animal-football-config-"));
const file = path.join(directory, "config.json");
await fs.writeFile(file, JSON.stringify({
  version: 2,
  features: {
    leaderboard: { enabled: true, apiUrl: "https://rank.example.com/v1" },
    friend: { enabled: true, wssUrl: "wss://room.example.com/live" },
    captainAvatarCustomization: { enabled: true, apiUrl: "https://avatar.example.com/v1", unknown: "drop-me" },
    ruralLeaderboard: { enabled: true, metrics: ["points", "streak", "goals"], scopes: ["nation", "galaxy", "county"], defaultScope: "county" },
    regionalShare: { enabled: true, sameCountyTemplate: "{{commonRegion}}村赛｜{{redLeaf}} VS {{blueLeaf}}", sameProvinceTemplate: "{{evil}}" },
    monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "adunit-abcdef012345", freeMatchesPerDay: 3 },
    dailyTasks: { enabled: true, tasks: [{ id: "goals", kind: "score_goals", target: 2, reward: "honor-60" }, { id: "x", kind: "hack" }] },
    penaltyShootout: { enabled: true, rounds: 99 },
    spectateCheer: { enabled: true, presets: [{ icon: "🍺", text: "干一杯" }] },
    home: { honorCard: true, rivalryBanner: false, taskStrip: true },
    nonsenseModule: { enabled: true, evil: true },
  },
  announcement: { text: "今晚县域杯", level: "warn" },
  maintenance: { onlineBlocked: false, message: "" },
}), "utf8");

const service = await createRemoteConfigService({ host: "127.0.0.1", port: 0, dataFile: file });
try {
  const response = await fetch(`${service.url()}/v1`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(payload.features.leaderboard.enabled, true);
  assert.equal(payload.features.friend.wssUrl, "wss://room.example.com/live");
  assert.deepEqual(payload.features.captainAvatarCustomization, { enabled: true, apiUrl: "https://avatar.example.com/v1" });
  assert.deepEqual(payload.features.ruralLeaderboard, { enabled: true, metrics: ["points", "goals"], scopes: ["nation", "county"], defaultScope: "county" });
  assert.equal(payload.features.regionalShare.sameCountyTemplate, "{{commonRegion}}村赛｜{{redLeaf}} VS {{blueLeaf}}");
  assert.match(payload.features.regionalShare.sameProvinceTemplate, /redLocal/, "未知模板占位符必须回退本地短队名默认模板");
  assert.equal(payload.features.monetization.rewardedAdUnitId, "adunit-abcdef012345");
  // 升级模块透传且经白名单/钳制归一化；未知模块不得出现在下发配置里。
  assert.equal(payload.features.dailyTasks.enabled, true);
  assert.equal(payload.features.dailyTasks.tasks.length, 1, "非法任务类型必须被服务端丢弃");
  assert.equal(payload.features.penaltyShootout.rounds, 7, "点球轮数钳制到 7");
  assert.equal(payload.features.spectateCheer.presets[0].text, "干一杯");
  assert.deepEqual(payload.features.home, { honorCard: true, rivalryBanner: false, taskStrip: true });
  assert.equal("nonsenseModule" in payload.features, false, "未知模块不下发");
  assert.deepEqual(payload.announcement, { text: "今晚县域杯", level: "warn" });
  assert.deepEqual(payload.maintenance, { onlineBlocked: false, message: "", minClientVersion: "" });
  assert.deepEqual(payload.events, [], "未提供活动时回落空数组");

  await fs.writeFile(file, "{not-json", "utf8");
  const fallback = await (await fetch(`${service.url()}/v1`)).json();
  assert.equal(fallback.features.leaderboard.enabled, false, "配置文件损坏时必须安全关闭联网能力");
  assert.equal((await fetch(`${service.url()}/health`)).status, 200);
  assert.equal((await fetch(`${service.url()}/unknown`)).status, 404);
} finally {
  await service.close();
  await fs.rm(directory, { recursive: true, force: true });
}

const invalid = normalizeRemoteConfig({
  features: {
    leaderboard: { enabled: true, apiUrl: "http://unsafe.example.com" },
    friend: { enabled: true, wssUrl: "ws://unsafe.example.com" },
    captainAvatarCustomization: { enabled: true, apiUrl: "https://localhost/v1" },
    monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "fake" },
  },
});
assert.equal(invalid.features.leaderboard.enabled, false);
assert.equal(invalid.features.friend.enabled, false);
assert.deepEqual(invalid.features.captainAvatarCustomization, { enabled: false, apiUrl: "" });
assert.equal(invalid.features.monetization.enabled, false);
console.info("[test-remote-config-service] PASS：云端配置服务、热读取、缓存禁用与安全回退正常");
