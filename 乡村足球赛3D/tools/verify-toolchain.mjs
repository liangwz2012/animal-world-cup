import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'toolchain.lock.json'), 'utf8'));
const failures = [];

if (process.version !== 'v' + lock.runtime.node) {
  failures.push('Node 期望 v' + lock.runtime.node + '，实际 ' + process.version);
}

const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' });
if (npm.status !== 0 || npm.stdout.trim() !== lock.runtime.npm) {
  failures.push('npm 期望 ' + lock.runtime.npm + '，实际 ' + (npm.stdout.trim() || '不可用'));
}

const wechatPackage = path.join(
  lock.wechatDeveloperTools.application,
  'Contents/Resources/app.asar.unpacked/package.json'
);
try {
  const installed = JSON.parse(await readFile(wechatPackage, 'utf8')).version;
  if (installed !== lock.wechatDeveloperTools.installedVersion) {
    failures.push('微信开发者工具期望 ' + lock.wechatDeveloperTools.installedVersion + '，实际 ' + installed);
  }
} catch {
  failures.push('未找到已冻结的微信开发者工具安装');
}

for (const [name, value] of Object.entries(lock.engines)) {
  if (!value.version || !value.license || !value.licenseSource) {
    failures.push(name + ' 缺少版本或许可证锁定');
  }
}

if (failures.length) {
  console.error('工具链验证失败：');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log(
    '工具链验证通过：Node ' + lock.runtime.node +
    '，npm ' + lock.runtime.npm +
    '，LayaAir ' + lock.engines.layaair.version +
    '，Galacean ' + lock.engines.galacean.version +
    '，微信开发者工具 ' + lock.wechatDeveloperTools.installedVersion
  );
}
