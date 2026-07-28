import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TEAMS, DEFAULT_TEAMS, applyTeamOverrides } = require("../src/data/game-options");
const { initTeamConfig, isValidConfig, fetchConfig, PRODUCTION_CONFIG_URL } = require("../src/net/remote-config");

const ids = () => TEAMS.map((t) => t.id);
const byId = (id) => TEAMS.find((t) => t.id === id);

// 基线：默认队列为 8 支动物队，动物主名 + 国名副标题
assert.equal(DEFAULT_TEAMS.length, 8);
assert.equal(byId("england").name, "雄狮");
assert.equal(byId("england").country, "英格兰");

// 1) 覆盖已有队伍的 name/country/color（hex 字符串 → 数值）
assert.equal(applyTeamOverrides([{ id: "england", name: "巨狮", country: "大不列颠", color: "#ffffff" }]), true);
assert.equal(byId("england").name, "巨狮");
assert.equal(byId("england").country, "大不列颠");
assert.equal(byId("england").color, 0xffffff);
assert.equal(byId("france").country, "法国", "未覆盖的队伍国名保留默认");
assert.equal(TEAMS.length, 8, "覆盖单队不改变总数");

// 2) 合规守卫：本地不存在的新 id 一律忽略（不接受云端下发未审核新队），
//    且每次都从默认基线重建 → england 名字恢复默认
assert.equal(applyTeamOverrides([{ id: "atlantis", name: "海怪队" }]), true);
assert.equal(ids().includes("atlantis"), false, "未知 id 不得被加入");
assert.equal(byId("england").name, "雄狮", "无补丁的队伍回落默认名");

// 3) 停用队伍：从队列移除，剩余仍 ≥2
assert.equal(applyTeamOverrides([{ id: "usa", enabled: false }, { id: "argentina", enabled: false }]), true);
assert.equal(TEAMS.length, 6);
assert.equal(ids().includes("usa"), false);
assert.equal(ids().includes("argentina"), false);

// 4) 兜底：有效队伍不足 2 支 → 返回 false 且不改动当前队列
const before = ids().join(",");
assert.equal(applyTeamOverrides(DEFAULT_TEAMS.map((t) => ({ id: t.id, enabled: t.id === "england" }))), false);
assert.equal(ids().join(","), before, "非法配置不得破坏当前队列");

// 5) 排序：order 生效
assert.equal(applyTeamOverrides([{ id: "usa", order: 0 }, { id: "england", order: 99 }]), true);
assert.equal(TEAMS[0].id, "usa", "order=0 排到最前");
assert.equal(TEAMS[TEAMS.length - 1].id, "england", "order=99 排到最后");

// 6) 非法输入回落
assert.equal(applyTeamOverrides(null), false);
assert.equal(applyTeamOverrides([]), false);
assert.equal(applyTeamOverrides("nonsense"), false);

// 7) 恢复完整默认队列
assert.equal(applyTeamOverrides(DEFAULT_TEAMS.map((t, i) => ({ id: t.id, order: i }))), true);
assert.equal(TEAMS.length, 8);

// 8) isValidConfig / initTeamConfig 无 wx 环境不抛错、回落 false
assert.equal(isValidConfig({ teams: [{ id: "england" }] }), true);
assert.equal(isValidConfig({ teams: [] }), false);
assert.equal(isValidConfig(null), false);
const applied = await initTeamConfig(null, {});
assert.equal(applied, false, "无 wx 环境后台拉取回落 false，不抛错");

// 9) 首发包不探测未登记域名；只有上线后显式注入通过微信登记的 HTTPS 地址才允许请求。
assert.equal(PRODUCTION_CONFIG_URL, "");
let requestCalled = false;
assert.equal(await fetchConfig({ request() { requestCalled = true; } }, {}), null);
assert.equal(requestCalled, false, "未配置远程地址时不得发起请求");

console.info("[test-remote-config] PASS：远程覆盖、合规守卫(忽略新id)、停用/排序、未配置远程地址与无网兜底均正常");
