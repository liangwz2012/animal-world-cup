import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  attachRuntimeJerseyLabels,
  displayLabel,
  hierarchyMirrored,
  labelSize,
} = require("../src/ui/runtime-jersey-labels.js");

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y = x) { this.x = x; this.y = y; }
}

class Container {
  constructor() { this.children = []; this.position = new Point(); this.scale = new Point(1, 1); this.parent = null; }
  addChild(...children) { for (const child of children) { child.parent = this; this.children.push(child); } return children[0]; }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parent = null; }
  destroy() {}
}

class Graphics extends Container {
  beginFill() { return this; }
  drawRoundedRect() { return this; }
  drawRect() { return this; }
  endFill() { return this; }
}

class Text extends Container {
  constructor(value, style) { super(); this.text = value; this.style = style; this.anchor = new Point(); }
}

const PIXI = { Container, Graphics, Text };

function renderer(id) {
  const shirt = new Container();
  const spine = new Container();
  spine.sprites = { chest_shirt: shirt };
  spine.addChild(shirt);
  spine.setDirection = function setDirection(direction) { this.scale.x = direction; };
  return { player: { id }, spine };
}

const renderers = Array.from({ length: 14 }, (_, index) => renderer(index));
const game = { stadium: { children: [{ children: renderers.slice(0, 7) }, { children: renderers.slice(7) }] } };
const status = attachRuntimeJerseyLabels({
  game,
  PIXI,
  redJersey: { locationLabel: "镇隆" },
  blueJersey: { locationLabel: "水口" },
});

assert.equal(displayLabel({ customName: "石桥村足球队" }), "石桥村足");
assert.equal(labelSize("镇隆").font, 20);
assert.equal(status.attached, 14);
assert.equal(status.red, "镇隆");
assert.equal(status.blue, "水口");
assert.equal(renderers[0].spine.sprites.chest_shirt.__ruralRegionLabel.__ruralRegionText.text, "镇隆");
assert.equal(
  renderers[0].spine.sprites.chest_shirt.__ruralRegionLabel.children.length,
  1,
  "地区名必须是透明文字层，不能再添加有底色的矩形标签",
);
assert.equal(renderers[7].spine.sprites.chest_shirt.__ruralRegionLabel.__ruralRegionText.text, "水口");
renderers[0].spine.setDirection(-1);
assert.equal(renderers[0].spine.sprites.chest_shirt.scale.x, 1, "真实问题路径中胸衣局部缩放保持正值");
assert.equal(hierarchyMirrored(renderers[0].spine.sprites.chest_shirt), true, "父级骨架镜像必须被识别");
assert.equal(
  renderers[0].spine.sprites.chest_shirt.__ruralRegionLabel.scale.x,
  -1,
  "文字层必须抵消胸衣左右翻转，不能出现镜像汉字",
);

console.info("[test-runtime-jersey-labels] PASS：14名球员队名层、主客队文本和左右镜像抵消正常");
