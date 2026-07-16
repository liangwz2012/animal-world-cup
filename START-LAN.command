#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

echo "Animal Cup LAN"
echo "=============="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required: https://nodejs.org/"
  read -k 1 "?Press any key to close..."
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Current version: $(node --version)"
  read -k 1 "?Press any key to close..."
  exit 1
fi

if [ ! -x "node_modules/.bin/next" ]; then
  echo "Installing locked dependencies..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile
  else
    echo "pnpm/corepack not found; using npm without creating package-lock.json."
    npm install --no-package-lock
  fi
fi

BUILD_STAMP=".next/BUILD_ID"
SOURCE_CHANGED=""
if [ -f "$BUILD_STAMP" ]; then
  SOURCE_CHANGED=$(find app public online cloudflare script package.json pnpm-lock.yaml next.config.mjs \
    -type f -newer "$BUILD_STAMP" -print -quit 2>/dev/null || true)
fi

if [ ! -f "$BUILD_STAMP" ] || [ -n "$SOURCE_CHANGED" ]; then
  echo "Building the game..."
  npm run build
fi

LAN_IP=${LAN_IP:-$(node -e "const os=require('os');let out='127.0.0.1';outer:for(const xs of Object.values(os.networkInterfaces()))for(const ni of xs||[])if(ni.family==='IPv4'&&!ni.internal&&/^(192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(ni.address)){out=ni.address;break outer;}console.log(out)")}
export LAN_IP

echo ""
echo "Main screen:        http://localhost:13000/"
echo "Classic LAN room:   http://localhost:13000/lobby"
echo "Challenge station:  http://localhost:13000/lan-kiosk"
echo "Phone controller:   http://${LAN_IP}:13000/pad"
echo ""
echo "Keep this window open while playing."
echo ""

node script/lan-server.mjs &
LAN_PID=$!

cleanup() {
  kill "$LAN_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

./node_modules/.bin/next start -H 0.0.0.0 -p 13000
