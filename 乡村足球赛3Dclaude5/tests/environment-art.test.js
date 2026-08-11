import assert from "node:assert/strict";
import test from "node:test";

import { paintRuralGroundTexture, paintVenuePitchTexture, venueTextureBudget } from "../src/art/environment-textures.js";
import { cultureFor } from "../src/content/regions.js";
import { FORMATS } from "../src/core/constants.js";

class RecordingContext {
  constructor() {
    this.ops = [];
  }

  set fillStyle(value) { this.ops.push(["fillStyle", value]); }
  set strokeStyle(value) { this.ops.push(["strokeStyle", value]); }
  set globalAlpha(value) { this.ops.push(["globalAlpha", value]); }
  set lineWidth(value) { this.ops.push(["lineWidth", value]); }
  set lineCap(value) { this.ops.push(["lineCap", value]); }
  save() { this.ops.push(["save"]); }
  restore() { this.ops.push(["restore"]); }
  fillRect(...args) { this.ops.push(["fillRect", ...args]); }
  strokeRect(...args) { this.ops.push(["strokeRect", ...args]); }
  beginPath() { this.ops.push(["beginPath"]); }
  moveTo(...args) { this.ops.push(["moveTo", ...args]); }
  lineTo(...args) { this.ops.push(["lineTo", ...args]); }
  quadraticCurveTo(...args) { this.ops.push(["quadraticCurveTo", ...args]); }
  rect(...args) { this.ops.push(["rect", ...args]); }
  arc(...args) { this.ops.push(["arc", ...args]); }
  stroke() { this.ops.push(["stroke"]); }
  fill() { this.ops.push(["fill"]); }
}

function recordingCanvas(size) {
  const ctx = new RecordingContext();
  return { width: size, height: size, getContext: () => ctx, ctx };
}

test("村镇主场纹理预算不高于既有高档基线", () => {
  const high = venueTextureBudget("high");
  const low = venueTextureBudget("low");
  assert.equal(high.pitch, 2048);
  assert.equal(high.ground, 1024);
  assert.ok(high.totalPixels <= 5 * 1024 * 1024);
  assert.ok(low.totalPixels < high.totalPixels * 0.3);
});

test("维护草坪按地域与赛制固定复现", () => {
  const culture = cultureFor("520000");
  const a = recordingCanvas(256);
  const b = recordingCanvas(256);
  paintVenuePitchTexture(a, culture, FORMATS["5v5"], 256);
  paintVenuePitchTexture(b, culture, FORMATS["5v5"], 256);
  assert.deepEqual(a.ctx.ops, b.ctx.ops);
  assert.ok(a.ctx.ops.length > 1000);
});

test("农田、灌渠与村路纹理固定复现", () => {
  const culture = cultureFor("520000");
  const a = recordingCanvas(256);
  const b = recordingCanvas(256);
  paintRuralGroundTexture(a, culture, 256);
  paintRuralGroundTexture(b, culture, 256);
  assert.deepEqual(a.ctx.ops, b.ctx.ops);
  assert.ok(a.ctx.ops.some(([op, value]) => op === "strokeStyle" && value === "#527F86"));
  assert.ok(a.ctx.ops.some(([op, value]) => op === "strokeStyle" && value === "#B8B19E"));
});
