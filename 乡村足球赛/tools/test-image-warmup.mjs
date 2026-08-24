import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { warmImageDataUriCache, localImageDataUri } = require("../src/platform/adapter.js");

const reads = [];
const wxApi = {
  getFileSystemManager: () => ({
    readFileSync(path, encoding) {
      reads.push([path, encoding]);
      return "ZmFrZS1wbmc="; // "fake-png"
    },
  }),
};

const count = warmImageDataUriCache(
  ["data/player/races/rural_01/head.png", "data/stadiums/common/goal.png"],
  wxApi,
  globalThis,
);
assert.equal(count, 2, "预热必须接受全部路径");
await new Promise((resolve) => setTimeout(resolve, 300));

const readsAfterWarm = reads.length;
assert.ok(readsAfterWarm >= 2, "预热应已发生文件读取");

// 公开路径形式命中（引擎 Image src 的实际形态）
const publicHit = localImageDataUri("/match-runtime-min/data/player/races/rural_01/head.png", wxApi, globalThis);
assert.ok(publicHit && publicHit.startsWith("data:image/png;base64,"), "公开路径必须命中预热缓存");
assert.equal(reads.length, readsAfterWarm, "命中后不再读文件");

// 文件系统路径形式同样命中
const fsHit = localImageDataUri("runtime-assets/match-runtime-min/data/stadiums/common/goal.png", wxApi, globalThis);
assert.ok(fsHit && fsHit.startsWith("data:image/png;base64,"), "文件系统路径必须命中预热缓存");
assert.equal(reads.length, readsAfterWarm, "文件系统路径命中后不再读文件");

// 图片解码失败路径：读不出内容时安全回落 null，不抛错
const emptyWx = { getFileSystemManager: () => ({ readFileSync() { throw new Error("missing"); } }) };
const miss = localImageDataUri("runtime-assets/match-runtime-min/data/player/races/rural_99/none.png", emptyWx, globalThis);
assert.equal(miss, null, "缺失文件安全回落 null");

console.info("[test-image-warmup] PASS：后台预热写入缓存、公开/文件系统双键命中、缺失安全回落");
