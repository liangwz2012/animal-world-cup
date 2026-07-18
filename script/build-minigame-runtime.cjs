/**
 * 构建脚本：将所有运行时资源打包到 runtime-text-assets.js
 * 运行：node script/build-minigame-runtime.js
 */
const fs = require('fs');
const path = require('path');

// 使用 process.cwd() 获取项目根目录
const projectRoot = process.cwd();
const runtimeDir = path.join(projectRoot, 'wechat-minigame', 'runtime');
const matchRuntimeMin = path.join(runtimeDir, 'match-runtime-min');
console.log('Base directory:', matchRuntimeMin);

// 需要打包的文件（文本格式）
const textExtensions = ['.js', '.json', '.css', '.html', '.txt'];

// 收集所有文本资源
function collectTextAssets(dir, baseDir = dir) {
  const assets = {};

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return assets;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'images' || entry.name === 'data/stadiums' || entry.name === 'data/balls') {
        // 跳过二进制资源目录
        continue;
      }
      const subAssets = collectTextAssets(fullPath, baseDir);
      Object.assign(assets, subAssets);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (textExtensions.includes(ext)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          assets[relativePath] = content;
        } catch (e) {
          console.warn(`Failed to read ${relativePath}: ${e.message}`);
        }
      }
    }
  }

  return assets;
}

// 收集 match-runtime-min 目录下的所有文本资源
console.log('Collecting text assets from match-runtime-min...');
const assets = collectTextAssets(matchRuntimeMin);

console.log(`Collected ${Object.keys(assets).length} text assets`);

// 打印关键文件（不需要前缀，readRuntimeTextAsset 会自动处理）
const criticalFiles = [
  'shim-early.js',
  'vendor/pixi.fixed.js',
  'vendor/swig.min.js',
  'shim.js',
  'scripts/match.rebuilt.js',
  'standalone-match.js',
];

console.log('\nCritical files:');
for (const f of criticalFiles) {
  const has = f in assets;
  console.log(`  ${has ? '✓' : '✗'} ${f}${has ? ` (${assets[f].length} chars)` : ' (missing)'}`);
}

// 生成 JavaScript 代码
const outputPath = path.join(runtimeDir, 'runtime-text-assets.js');
const outputContent = `module.exports = ${JSON.stringify(assets, null, 2)};\n`;

fs.writeFileSync(outputPath, outputContent);
console.log(`\nWritten to ${outputPath} (${outputContent.length} bytes)`);
