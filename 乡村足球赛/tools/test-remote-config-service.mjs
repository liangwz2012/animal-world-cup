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
    monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "adunit-abcdef012345" },
  },
}), "utf8");

const service = await createRemoteConfigService({ host: "127.0.0.1", port: 0, dataFile: file });
try {
  const response = await fetch(`${service.url()}/v1`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(payload.features.leaderboard.enabled, true);
  assert.equal(payload.features.friend.wssUrl, "wss://room.example.com/live");
  assert.equal(payload.features.monetization.rewardedAdUnitId, "adunit-abcdef012345");

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
    monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "fake" },
  },
});
assert.equal(invalid.features.leaderboard.enabled, false);
assert.equal(invalid.features.friend.enabled, false);
assert.equal(invalid.features.monetization.enabled, false);
console.info("[test-remote-config-service] PASS：云端配置服务、热读取、缓存禁用与安全回退正常");
