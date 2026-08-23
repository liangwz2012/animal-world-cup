import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFanSpriteVisibilityBridge } = require("../src/data/fan-sprite-visibility.js");

const head = { visible: true };
const shirt = { visible: true };
const hiddenSleeve = { visible: false };
const sprites = {
  head,
  chest_shirt: shirt,
  arm_left_sleeve: hiddenSleeve,
  unused_attachment: null,
  missing_attachment: undefined,
};
const bridge = createFanSpriteVisibilityBridge();
const state = bridge.snapshot(sprites);
assert.equal(state.unused_attachment, null);
assert.equal(state.missing_attachment, null);
bridge.hideHead(sprites);
assert.equal(head.visible, false);
bridge.showOnlyHead(sprites);
assert.equal(head.visible, true);
assert.equal(shirt.visible, false);
assert.equal(hiddenSleeve.visible, false);
assert.doesNotThrow(() => bridge.showOnlyHead({ head: null, shirt: undefined }));
bridge.restore(sprites, state);
assert.equal(head.visible, true);
assert.equal(shirt.visible, true);
assert.equal(hiddenSleeve.visible, false);
assert.equal(sprites.unused_attachment, null);

console.info("[test-fan-sprite-visibility] PASS：观众空槽位、头部隔离和可见性恢复正常");
