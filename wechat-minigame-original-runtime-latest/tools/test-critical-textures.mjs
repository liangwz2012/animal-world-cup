import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ensureCriticalIndicatorTextures,
  isRecoverableTextureCacheError,
} = require("../src/boot/start");

const cache = {};
const baseTexture = { valid: true, hasLoaded: true };

class Rectangle {
  constructor(x, y, width, height) {
    Object.assign(this, { x, y, width, height });
  }
}

class Texture {
  constructor(base, frame) {
    this.baseTexture = base;
    this.frame = frame;
  }

  static fromImage(path) {
    assert.equal(path, "runtime-assets/match-runtime-min/images/indicators.png");
    return { baseTexture };
  }

  static addTextureToCache(texture, key) {
    cache[key] = texture;
  }

  static addToCache(texture, key) {
    cache[key] = texture;
  }
}

const PIXI = {
  Rectangle,
  Texture,
  utils: { TextureCache: cache },
};
const windowTarget = {};
const globalTarget = {};
const restore = await ensureCriticalIndicatorTextures(PIXI, [windowTarget, globalTarget], { forceReload: true });

assert.equal(typeof restore, "function");
assert.ok(cache["indicators/sight.png"]);
assert.equal(cache["indicators/sight.png"].frame.width, 504);
assert.equal(windowTarget.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__, restore);
assert.equal(typeof windowTarget.__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__, "function");

delete cache["indicators/sight.png"];
assert.equal(cache["indicators/sight.png"], undefined);
assert.ok(restore() >= 1);
assert.ok(cache["indicators/sight.png"]);

delete cache["indicators/header.png"];
const privateHeader = windowTarget.__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__("indicators/header.png");
assert.ok(privateHeader);
assert.equal(cache["indicators/header.png"], privateHeader);

assert.equal(isRecoverableTextureCacheError(new Error('The frameId "indicators/sight.png" does not exist in the texture cache')), true);
assert.equal(isRecoverableTextureCacheError(new Error("navigator.getGamepads is not a function")), false);

console.info("[test-critical-textures] PASS：关键图集硬预载、缓存恢复与异常分类通过");
