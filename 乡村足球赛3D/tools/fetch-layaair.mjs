import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'toolchain.lock.json'), 'utf8'));
const engine = lock.engines.layaair;
const cache = path.join(root, '.cache', 'vendor', 'layaair-' + engine.version);
const archive = path.join(cache, 'LayaAir_' + engine.version + '_libs.zip');
const marker = path.join(cache, '.verified-sha256');

await mkdir(cache, { recursive: true });

async function hashFile(filename) {
  const data = await readFile(filename);
  return createHash('sha256').update(data).digest('hex');
}

let validCache = false;
try {
  validCache = (await hashFile(archive)) === engine.sha256;
} catch {
  validCache = false;
}

if (!validCache) {
  const partial = archive + '.partial';
  await rm(partial, { force: true });
  const download = spawnSync('curl', [
    '-fL',
    '--retry', '2',
    '--connect-timeout', '15',
    '--max-time', '120',
    '--output', partial,
    engine.archive
  ], { encoding: 'utf8' });
  if (download.status !== 0) {
    throw new Error('LayaAir 下载失败：' + (download.stderr || download.stdout));
  }
  const actual = await hashFile(partial);
  if (actual !== engine.sha256) {
    await rm(partial, { force: true });
    throw new Error('LayaAir SHA-256 不匹配：' + actual);
  }
  await rename(partial, archive);
}

const extraction = spawnSync('unzip', [
  '-oq',
  archive,
  'libs/laya.core.js',
  'libs/laya.d3.js',
  'libs/laya.gltf.js',
  'libs/laya.adapter-weixin.js',
  'types/LayaAir.d.ts',
  '-d',
  cache
], { encoding: 'utf8' });

if (extraction.status !== 0) {
  throw new Error('解压 LayaAir 失败：' + (extraction.stderr || extraction.stdout));
}

await writeFile(marker, engine.sha256 + '\n');
console.log('LayaAir ' + engine.version + ' 已校验并缓存：' + path.relative(root, cache));
process.exitCode = 0;
