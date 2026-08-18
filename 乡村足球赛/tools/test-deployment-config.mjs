import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = path.join(root, "server/deploy");
const names = [
  "nginx-rural-football.conf.example",
  "rural-football.env.example",
  "rural-football-friend.service.example",
  "rural-football-leaderboard.service.example",
  "rural-football-config.service.example",
];
const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(deployDir, name), "utf8")])));
const combined = Object.values(files).join("\n");
assert.doesNotMatch(combined, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|WX_APP_SECRET=\S+|\bsk-[A-Za-z0-9_-]{20,}/, "部署模板不得携带真实凭据");
const nginx = files["nginx-rural-football.conf.example"];
for (const route of ["/rural-football/config/v1", "/rural-rank/", "/rural-ws"]) assert.match(nginx, new RegExp(route.replace(/\//g, "\\/")));
assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
assert.match(nginx, /limit_req zone=rural_api/);
assert.match(nginx, /limit_conn rural_socket/);
for (const name of names.filter((name) => name.endsWith(".service.example"))) {
  const unit = files[name];
  assert.match(unit, /User=rural-football/);
  assert.match(unit, /Environment=HOST=127\.0\.0\.1/);
  assert.match(unit, /EnvironmentFile=\/etc\/rural-football\/rural-football\.env/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(unit, /HOST=0\.0\.0\.0/);
}
console.log("[test-deployment-config] PASS：三服务进程隔离、仅本机监听、Nginx 限流/WSS 与无凭据模板正常");

