import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'docs/PRODUCT.md',
  'docs/ARCHITECTURE.md',
  'docs/MILESTONES.md',
  'docs/ACCEPTANCE.md',
  'docs/STATUS.md',
  'docs/goals/M0-engine-decision.md',
  'docs/adr/README.md'
];
const directories = [
  'assets/source/m0',
  'assets/built/m0',
  'experiments/layaair',
  'experiments/galacean',
  'packages/match-core',
  'packages/platform-wechat',
  'packages/presentation-3d',
  'tests/contracts',
  'tests/evidence/raw'
];
const failures = [];

for (const relativePath of [...files, ...directories]) {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
  } catch {
    failures.push('缺少：' + relativePath);
  }
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'rural-football-3d' || pkg.private !== true) {
  failures.push('package.json 必须保持私有且名称为 rural-football-3d');
}

const goal = await readFile(path.join(root, 'docs/goals/M0-engine-decision.md'), 'utf8');
for (const heading of ['## 目标', '## 范围', '## 非范围', '## 完成条件', '## 验证方式', '## 停止条件']) {
  if (!goal.includes(heading)) failures.push('M0 Goal 缺少章节：' + heading);
}

if (failures.length) {
  console.error('项目检查失败（' + failures.length + ' 项）：');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log('项目检查通过：' + files.length + ' 个核心文件，' + directories.length + ' 个工作目录。');
}
