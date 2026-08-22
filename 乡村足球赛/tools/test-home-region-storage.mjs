import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  HOME_REGION_STORAGE_KEY,
  normalizeHomeRegionStorage,
  readHomeRegionStorage,
  writeHomeRegionStorage,
} = require("../src/data/home-region-storage");

const data = new Map();
const wx = {
  getStorageSync(key) { return data.get(key); },
  setStorageSync(key, value) { data.set(key, value); },
};
const region = {
  path: [
    { code: "440000", parentCode: "", level: "province", name: "广东省", shortName: "广东" },
    { code: "440900", parentCode: "440000", level: "city", name: "茂名市", shortName: "茂名" },
    { code: "440983", parentCode: "440900", level: "county", name: "信宜市", shortName: "信宜" },
    { code: "440983101000", parentCode: "440983", level: "town", name: "镇隆镇", shortName: "镇隆" },
  ],
  customName: "天后街队",
};
assert.equal(writeHomeRegionStorage(wx, region), true);
assert.equal(data.has(HOME_REGION_STORAGE_KEY), true);
assert.deepEqual(readHomeRegionStorage(wx), { version: 1, path: region.path, customName: "天后街队" });

data.set(HOME_REGION_STORAGE_KEY, "{broken");
assert.equal(readHomeRegionStorage(wx), null, "损坏缓存必须安全回退为空");
assert.equal(normalizeHomeRegionStorage({ path: [{ code: "x", level: "bad" }] }), null);
assert.equal(readHomeRegionStorage(null), null);

console.info("[test-home-region-storage] PASS：主队家乡路径静默保存、读取、损坏回退且不含定位信息");
