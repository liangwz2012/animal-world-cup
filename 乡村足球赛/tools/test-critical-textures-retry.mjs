import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ensureCriticalIndicatorTextures } = require("../src/boot/start");

// 复现真机故障：第 1 次加载的 BaseTexture 永不触发 loaded（wx 图片 onload 偶发丢失），
// 且被 Pixi 全局缓存住。验证带缓存清除的重试能在第 2 次自愈，而不是永久卡死弹致命框。
let attempts = 0;
const validBase = { valid: true, hasLoaded: true };
const baseCache = {};
const texCache = {};

class Rectangle {
  constructor(x, y, width, height) {
    Object.assign(this, { x, y, width, height });
  }
}

function makeDeadBase() {
  return {
    valid: false,
    hasLoaded: false,
    once() {},        // 永不回调，模拟 onload 丢失
    off() {},
    destroyed: false,
    destroy() { this.destroyed = true; },
  };
}

class Texture {
  constructor(base, frame) {
    this.baseTexture = base;
    this.frame = frame;
  }

  static fromImage(path) {
    assert.equal(path, "runtime-assets/match-runtime-min/images/indicators.png");
    attempts += 1;
    // 前一次的死纹理若未被清缓存，这里会复用它并再次超时；本用例要求实现主动清缓存重取。
    const base = attempts >= 2 ? validBase : makeDeadBase();
    baseCache[path] = base;
    return { baseTexture: base };
  }

  static addToCache(texture, key) { texCache[key] = texture; }
  static addTextureToCache(texture, key) { texCache[key] = texture; }
}

const PIXI = {
  Rectangle,
  Texture,
  utils: { TextureCache: texCache, BaseTextureCache: baseCache },
};

const restore = await ensureCriticalIndicatorTextures(PIXI, [{}], {
  forceReload: true,
  timeoutMs: 50,
  maxAttempts: 3,
});

assert.equal(typeof restore, "function");
assert.ok(attempts >= 2, `首次超时后应重试，实际尝试次数 ${attempts}`);
assert.ok(texCache["indicators/sight.png"], "重试成功后关键纹理应已登记");
assert.equal(baseCache["runtime-assets/match-runtime-min/images/indicators.png"], validBase);

console.info(`[test-critical-textures-retry] PASS：首次 onload 丢失后第 ${attempts} 次重试自愈`);
