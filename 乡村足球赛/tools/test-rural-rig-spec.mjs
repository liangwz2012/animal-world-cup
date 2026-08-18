import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const specPath = path.join(
  projectDir,
  "美术整体替换包",
  "乡村队12人",
  "rig",
  "rig-spec.json",
);

execFileSync(process.execPath, [path.join(toolsDir, "extract-rural-rig-spec.mjs"), "--check"], {
  cwd: projectDir,
  stdio: "pipe",
});

const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
assert.equal(spec.schemaVersion, 1);
assert.equal(spec.invariants.preserveSkeletonAndAnimations, true);
assert.equal(spec.invariants.preservePhysicsAndCollision, true);
assert.equal(spec.invariants.runtimePngColorType, "RGBA");
assert.equal(spec.invariants.shirtTexturePixelScale, 1);
assert.equal(spec.invariants.minorKitTexturePixelScale, 1);
assert.equal(spec.invariants.kitAttachmentLogicalSizeUnchanged, true);
assert.equal(spec.directions.head_front, "strict-front-eyes-level-nose-centered");
assert.equal(spec.directions.head_back, "strict-rear-no-face-features");
assert.deepEqual(spec.characterParts.head_front.canvas, [81, 77]);
assert.deepEqual(spec.characterParts.head_back.canvas, [81, 77]);
assert.deepEqual(spec.characterParts.hand_left.canvas, [25, 28]);
assert.deepEqual(spec.characterParts.hand_right.canvas, [23, 38]);
assert.deepEqual(spec.kitParts["shirt_front.png"].canvas, [56, 52]);
assert.deepEqual(spec.kitParts["shirt_back.png"].canvas, [56, 52]);
assert.ok(Object.keys(spec.kitParts).length >= 12);
assert.ok(Object.keys(spec.bodyProfiles).length >= 4);

console.info("[test-rural-rig-spec] PASS：方向、锚点、人物部件和球衣部件契约有效");
