import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blender = '/Applications/Blender.app/Contents/MacOS/Blender';
const script = path.join(root, 'tools', 'blender', 'build_m0_gold.py');
const output = path.join(root, 'assets', 'built', 'm0', 'm0-gold.glb');

await mkdir(path.dirname(output), { recursive: true });

const build = spawnSync(blender, [
  '--background',
  '--factory-startup',
  '--python',
  script,
  '--',
  output
], {
  cwd: root,
  env: { ...process.env, PYTHONHASHSEED: '0' },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
});

if (build.error?.code === 'ENOENT') {
  throw new Error('未找到冻结工具 Blender：' + blender);
}
const blenderLog = (build.stdout ?? '') + '\n' + (build.stderr ?? '');
if (build.status !== 0 || blenderLog.includes('Traceback (most recent call last)')) {
  throw new Error('Blender M0 资产构建失败：\n' + (build.stderr || build.stdout));
}

const verify = spawnSync(process.execPath, [
  path.join(root, 'tools', 'verify-m0-gltf.mjs'),
  '--write-evidence'
], {
  cwd: root,
  encoding: 'utf8'
});
if (verify.status !== 0) {
  throw new Error('M0 GLB 验证失败：\n' + (verify.stderr || verify.stdout));
}

console.log(build.stdout.trim().split('\n').filter(Boolean).slice(-3).join('\n'));
console.log(verify.stdout.trim());
