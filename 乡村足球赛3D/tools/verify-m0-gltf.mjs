import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'assets', 'built', 'm0', 'm0-gold.glb');
const metadataFile = path.join(root, 'assets', 'source', 'm0', 'animation-clips.json');
const evidenceFile = path.join(root, 'tests', 'evidence', 'm0-asset-baseline.json');
const expectedClips = ['idle', 'jog', 'sprint', 'pass', 'shoot', 'stumble'];

const bytes = await readFile(filename);
if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB：magic 错误');
if (bytes.readUInt32LE(4) !== 2) throw new Error('只接受 glTF 2.0');
if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB 声明长度与文件不一致');
const jsonLength = bytes.readUInt32LE(12);
if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB 缺少 JSON 首块');
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));

const animationNames = (json.animations ?? []).map((animation) => animation.name).sort();
const missingAnimations = expectedClips.filter((name) => !animationNames.includes(name));
if (missingAnimations.length) {
  throw new Error('GLB 缺少动作：' + missingAnimations.join(', '));
}
if ((json.skins ?? []).length !== 1) {
  throw new Error('M0 金样必须恰好包含一个共享皮肤');
}
const jointCount = json.skins[0].joints.length;
if (jointCount > 65 || jointCount < 17) {
  throw new Error('变形骨骼数必须在 17–65，实际 ' + jointCount);
}
if ((json.meshes ?? []).length < 4) {
  throw new Error('GLB 缺少角色、足球或场地网格');
}
if (bytes.length > 1_500_000) {
  throw new Error('M0 金样 GLB 超过 1.5 MB：' + bytes.length);
}
if (metadata.clips.map((clip) => clip.name).sort().join(',') !== expectedClips.sort().join(',')) {
  throw new Error('动作元数据与 M0 六类动作不一致');
}

const summary = {
  schemaVersion: 1,
  asset: 'assets/built/m0/m0-gold.glb',
  bytes: bytes.length,
  gltfVersion: json.asset?.version,
  generator: json.asset?.generator,
  structureSha256: createHash('sha256').update(JSON.stringify(json)).digest('hex'),
  meshes: json.meshes?.length ?? 0,
  materials: json.materials?.length ?? 0,
  nodes: json.nodes?.length ?? 0,
  skins: json.skins?.length ?? 0,
  joints: jointCount,
  animations: animationNames
};

if (process.argv.includes('--write-evidence')) {
  await writeFile(evidenceFile, JSON.stringify(summary, null, 2) + '\n');
}

console.log(
  'M0 GLB 验证通过：' + summary.bytes + ' bytes，' +
  summary.joints + ' bones，' + summary.animations.length + ' clips'
);
