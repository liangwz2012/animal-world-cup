#!/bin/bash
# 用 esbuild 重新打包 PIXI.js 为自包含 IIFE
# 直接用 window.PIXI = ... 导出，绕过 UMD 的 this 问题

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/wechat-minigame/runtime/match-runtime-min/vendor"
OUTPUT_FILE="$VENDOR_DIR/pixi.bundle.js"

echo "=== 打包 PIXI.js 为自包含 IIFE ==="
echo "输入: $VENDOR_DIR/pixi.min.js"
echo "输出: $OUTPUT_FILE"

# 创建入口文件，用 CommonJS require 导入 PIXI 并重新导出到 window
cat > /tmp/pixi-entry.js << 'EOF'
const PIXI = require('./pixi.min.js');
window.PIXI = PIXI;
EOF

# 用 esbuild 打包
# --format=iife: 输出立即执行函数
# --platform=browser: 浏览器环境
# --minify: 压缩代码
cd "$VENDOR_DIR"

esbuild /tmp/pixi-entry.js \
  --bundle \
  --format=iife \
  --platform=browser \
  --minify \
  --banner:js='/*! pixi.js - v4.8.9 (rebuilt as IIFE) */' \
  --outfile="$OUTPUT_FILE"

echo ""
echo "=== 打包完成 ==="
echo "输出文件: $OUTPUT_FILE"
echo "文件大小: $(wc -c < "$OUTPUT_FILE") bytes"
echo ""
echo "对比原始文件: $(wc -c < pixi.min.js) bytes"
