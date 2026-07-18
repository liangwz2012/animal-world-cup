/**
 * 修复 PIXI.js 的 UMD 导出问题
 * 
 * PIXI.js UMD 结构：
 * !function(t){ e.PIXI=t; }(function(){...return PIXI对象}())
 * 
 * 问题：在 new Function() 中执行时，UMD 的 this 不是 window
 * 所以 e.PIXI=t 不会设置到 window
 * 
 * 解决方案：追加一个 IIFE 来捕获 UMD 函数的参数 t（就是 PIXI 对象），并导出到 window
 */
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '../wechat-minigame/runtime/match-runtime-min/vendor/pixi.min.js');
const outputFile = path.join(__dirname, '../wechat-minigame/runtime/match-runtime-min/vendor/pixi.fixed.js');

console.log('=== 修复 PIXI.js UMD 导出问题 ===');

const pixiCode = fs.readFileSync(inputFile, 'utf8');
console.log('原始文件大小:', pixiCode.length, 'bytes');

if (pixiCode.includes('/*PIXI_FIX_START*/')) {
  console.log('文件已经包含修复，跳过');
  process.exit(0);
}

// 关键修复代码
// PIXI.js UMD 函数的参数名是 t，所以我们用 t 来捕获
const fixCode = `;/*PIXI_FIX_START*/(function(t){if(t&&typeof window!=="undefined"){window.PIXI=t;console.info("[PIXI_FIX] PIXI exported to window, version:",t.VERSION);}})(PIXI);/*PIXI_FIX_END*/`;

const fixedCode = pixiCode + fixCode;

console.log('修复后文件大小:', fixedCode.length, 'bytes');

fs.writeFileSync(outputFile, fixedCode);

console.log('\n=== 修复完成 ===');
console.log('已将修复后的文件保存到:', outputFile);
console.log('\n说明：修复代码通过 IIFE 捕获 UMD 函数的参数 t（即 PIXI 对象）并导出到 window');
