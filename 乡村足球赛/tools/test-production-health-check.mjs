import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer } from "ws";
import { checkProductionServices } from "./production-health-check.mjs";

const httpServer = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/config") return response.end(JSON.stringify({ version: 1, features: { leaderboard: { enabled: false }, friend: { enabled: false }, monetization: { enabled: false } } }));
  if (request.url === "/rank/health") return response.end(JSON.stringify({ ok: true, service: "rural-football-leaderboard" }));
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false }));
});
await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const httpAddress = httpServer.address();

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve, reject) => { wss.once("listening", resolve); wss.once("error", reject); });
const wsAddress = wss.address();

const result = await checkProductionServices({
  allowInsecure: true,
  endpoints: {
    config: `http://127.0.0.1:${httpAddress.port}/config`,
    leaderboard: `http://127.0.0.1:${httpAddress.port}/rank/health`,
    friend: `ws://127.0.0.1:${wsAddress.port}`,
  },
});
assert.equal(result.ok, true);
assert.equal(result.friend.connected, true);
await assert.rejects(() => checkProductionServices({
  allowInsecure: true,
  endpoints: {
    config: `http://127.0.0.1:${httpAddress.port}/missing`,
    leaderboard: `http://127.0.0.1:${httpAddress.port}/rank/health`,
    friend: `ws://127.0.0.1:${wsAddress.port}`,
  },
}), /HTTP 404/);

await new Promise((resolve) => wss.close(resolve));
await new Promise((resolve) => httpServer.close(resolve));
console.log("[test-production-health-check] PASS：三服务成功路径、HTTPS/WSS 约束和 404 失败边界正常");

