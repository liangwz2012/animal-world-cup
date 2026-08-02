import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metadata = JSON.parse(
  readFileSync(new URL('../assets/source/m0/animation-clips.json', import.meta.url), 'utf8')
) as {
  fps: number;
  clips: Array<{
    name: string;
    rootMotion: boolean;
    contacts: Array<{ kind: 'ground' | 'ball'; foot: 'left' | 'right'; tick: number }>;
  }>;
};
const skeleton = JSON.parse(
  readFileSync(new URL('../assets/source/m0/skeleton.json', import.meta.url), 'utf8')
) as { bones: string[]; maximumDeformBones: number };
const evidence = JSON.parse(
  readFileSync(new URL('./evidence/m0-asset-baseline.json', import.meta.url), 'utf8')
) as {
  bytes: number;
  joints: number;
  skins: number;
  animations: string[];
  structureSha256: string;
};

const expected = ['idle', 'jog', 'sprint', 'pass', 'shoot', 'stumble'];

test('共享角色资产包含唯一皮肤、受控骨架和六类语义动作', () => {
  assert.equal(metadata.fps, 30);
  assert.deepEqual(metadata.clips.map((clip) => clip.name).sort(), [...expected].sort());
  assert.equal(new Set(skeleton.bones).size, skeleton.bones.length);
  assert.ok(skeleton.bones.includes('root'));
  assert.ok(skeleton.bones.length <= skeleton.maximumDeformBones);
  assert.equal(evidence.skins, 1);
  assert.equal(evidence.joints, 17);
  assert.deepEqual(evidence.animations, [...expected].sort());
  assert.ok(evidence.bytes <= 1_500_000);
  assert.match(evidence.structureSha256, /^[a-f0-9]{64}$/);
});

test('传球和射门都具有明确的右脚触球窗口，所有动作禁用根运动', () => {
  for (const clip of metadata.clips) assert.equal(clip.rootMotion, false);
  for (const name of ['pass', 'shoot']) {
    const clip = metadata.clips.find((candidate) => candidate.name === name);
    const contact = clip?.contacts.find((candidate) => candidate.kind === 'ball');
    assert.ok(contact, name + ' 必须有触球事件');
    assert.equal(contact.foot, 'right');
    assert.ok(contact.tick > 0 && contact.tick <= 30);
  }
});
