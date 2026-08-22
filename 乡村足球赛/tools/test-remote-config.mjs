import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TEAMS, DEFAULT_TEAMS, applyTeamOverrides } = require("../src/data/game-options");
const {
  DEFAULT_FEATURES,
  initTeamConfig,
  isValidConfig,
  isValidRemoteConfig,
  normalizeFeatures,
  fetchConfig,
  PRODUCTION_CONFIG_URL,
} = require("../src/net/remote-config");
const {
  CAPTAIN_AVATAR_CUSTOMIZATION_READY,
  captainAvatarCustomizationAvailable,
} = require("../src/data/captain-avatar-customization");

const ids = () => TEAMS.map((t) => t.id);
const byId = (id) => TEAMS.find((t) => t.id === id);

// 基线：默认队列为 8 套乡村球队视觉模板；地区选择后再覆盖真实队名。
assert.equal(DEFAULT_TEAMS.length, 8);
assert.equal(byId("england").name, "红衫队");
assert.equal(byId("england").country, "乡村联队");

// 1) 覆盖已有队伍的 name/country/color（hex 字符串 → 数值）
assert.equal(applyTeamOverrides([{ id: "england", name: "巨狮", country: "大不列颠", color: "#ffffff" }]), true);
assert.equal(byId("england").name, "巨狮");
assert.equal(byId("england").country, "大不列颠");
assert.equal(byId("england").color, 0xffffff);
assert.equal(byId("france").country, "乡村联队", "未覆盖的副标题保留默认");
assert.equal(TEAMS.length, 8, "覆盖单队不改变总数");

// 2) 合规守卫：本地不存在的新 id 一律忽略（不接受云端下发未审核新队），
//    且每次都从默认基线重建 → england 名字恢复默认
assert.equal(applyTeamOverrides([{ id: "atlantis", name: "海怪队" }]), true);
assert.equal(ids().includes("atlantis"), false, "未知 id 不得被加入");
assert.equal(byId("england").name, "红衫队", "无补丁的队伍回落默认名");

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

// 9) 包内固定安全配置地址；服务不可用时仍回落本地关闭状态。
assert.equal(PRODUCTION_CONFIG_URL, "https://coaiz.com/rural-football/config/v1");
assert.equal(await fetchConfig(null, {}), null);

// 10) 云端功能必须成组校验：HTTP、ws、伪广告位均不得打开能力。
const unsafe = normalizeFeatures({
  leaderboard: { enabled: true, apiUrl: "http://unsafe.example.com" },
  friend: { enabled: true, wssUrl: "ws://unsafe.example.com" },
  monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "fake" },
});
assert.deepEqual(unsafe, DEFAULT_FEATURES);
assert.equal(isValidRemoteConfig({ features: {} }), true);
assert.equal(isValidRemoteConfig({ teams: [] }), false);

// 11) 远端有效配置通知功能开关、写入缓存；请求错误不会覆盖已经生效的安全状态。
const cache = new Map();
let requestUrl = "";
let received = null;
const configWx = {
  getStorageSync: (key) => cache.get(key),
  setStorage: ({ key, data }) => cache.set(key, data),
  request: ({ url, success }) => {
    requestUrl = url;
    success({ data: {
      version: 1,
      features: {
        leaderboard: { enabled: true, apiUrl: "https://rank.example.com/v1" },
        friend: { enabled: true, wssUrl: "wss://room.example.com/live" },
        monetization: { enabled: true, playGateEnabled: true, adUnlockEnabled: true, rewardedAdUnitId: "adunit-abcdef012345" },
      },
    } });
  },
};
assert.equal(await initTeamConfig(configWx, { __RURAL_FOOTBALL_CONFIG_URL__: "https://rank-config.example.com/v1" }, { onFeatures: (value) => { received = value; } }), true);
assert.equal(requestUrl, "https://rank-config.example.com/v1");
assert.equal(received.leaderboard.enabled, true);
assert.equal(received.friend.wssUrl, "wss://room.example.com/live");
assert.equal(received.monetization.adUnlockEnabled, true);
assert.equal(cache.size, 1);

// 12) 升级模块开关：包内默认全部关闭，云端点亮后参数带钳制与白名单。
for (const name of ["dailyTasks", "penaltyShootout", "regionHonorBoard", "regionRivalry", "playerCodex", "spectateCheer", "challengeCard"]) {
  assert.equal(DEFAULT_FEATURES[name].enabled, false, `${name} 包内必须默认关闭`);
}
assert.deepEqual(DEFAULT_FEATURES.home, { honorCard: false, rivalryBanner: false, taskStrip: false });

const upgraded = normalizeFeatures({
  dailyTasks: {
    enabled: true,
    tasks: [
      { id: "goals", kind: "score_goals", target: 2, reward: "honor-60" },
      { id: "bad-kind", kind: "share_spam", target: 1, reward: "x" },
      { id: "too-big", kind: "win_matches", target: 999, reward: "y" },
      "garbage",
    ],
  },
  penaltyShootout: { enabled: true, rounds: 99 },
  regionHonorBoard: { enabled: true, scopes: ["nation", "galaxy", "county"] },
  regionRivalry: { enabled: true, settleDayOfWeek: 9, rewardTitle: "村BA总冠军称号是个很长很长的名字会被截断超长的部分" },
  playerCodex: { enabled: true },
  spectateCheer: { enabled: true, presets: [{ icon: "🍺", text: "干一杯" }, { icon: "", text: "空图标" }] },
  challengeCard: { enabled: true, title: "镇隆还没输过水口" },
  home: { honorCard: true, rivalryBanner: true, taskStrip: true },
});
assert.equal(upgraded.dailyTasks.enabled, true);
assert.equal(upgraded.dailyTasks.tasks.length, 2, "非法任务类型与非对象项必须被丢弃");
assert.equal(upgraded.dailyTasks.tasks[1].target, 99, "任务目标钳制到 99");
assert.equal(upgraded.penaltyShootout.rounds, 7, "点球轮数钳制到 3-7");
assert.deepEqual(upgraded.regionHonorBoard.scopes, ["nation", "county"], "榜单层级白名单过滤");
assert.equal(upgraded.regionRivalry.settleDayOfWeek, 6, "结算日钳制到 0-6");
assert.equal(upgraded.regionRivalry.rewardTitle.length, 24, "称号截断到 24 字");
assert.equal(upgraded.spectateCheer.presets.length, 1, "空图标助威被丢弃");
assert.equal(upgraded.challengeCard.title, "镇隆还没输过水口");
assert.deepEqual(upgraded.home, { honorCard: true, rivalryBanner: true, taskStrip: true });
assert.equal(upgraded.playerCodex.enabled, true);

// 头像自定义只预留专用云端契约；客户端实现未就绪时绝不能显示空入口。
assert.deepEqual(DEFAULT_FEATURES.captainAvatarCustomization, { enabled: false, apiUrl: "" });
const avatarEnabled = normalizeFeatures({
  captainAvatarCustomization: { enabled: true, apiUrl: "https://avatar.example.com/v1" },
});
assert.deepEqual(avatarEnabled.captainAvatarCustomization, {
  enabled: true,
  apiUrl: "https://avatar.example.com/v1",
});
for (const apiUrl of ["", "http://avatar.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://avatar.example.com/v1?token=secret"]) {
  assert.deepEqual(
    normalizeFeatures({ captainAvatarCustomization: { enabled: true, apiUrl } }).captainAvatarCustomization,
    { enabled: false, apiUrl: "" },
    `非法头像服务地址必须关闭：${apiUrl}`,
  );
}
assert.equal(CAPTAIN_AVATAR_CUSTOMIZATION_READY, false);
assert.equal(captainAvatarCustomizationAvailable(avatarEnabled.captainAvatarCustomization), false, "包内实现未就绪时云端误开也不得显示入口");

// 乡村荣耀榜与地域分享使用专用白名单，未知指标/范围/模板占位符必须被丢弃或回退。
assert.deepEqual(DEFAULT_FEATURES.ruralLeaderboard, {
  enabled: false,
  metrics: ["points", "goals", "winRate"],
  scopes: ["nation", "province", "city", "county", "town"],
  defaultScope: "nation",
});
const ruralCloud = normalizeFeatures({
  ruralLeaderboard: {
    enabled: true,
    metrics: ["goals", "cleanSheets", "points", "goals"],
    scopes: ["town", "planet", "province"],
    defaultScope: "town",
  },
  regionalShare: {
    enabled: true,
    sameCountyTemplate: "{{commonRegion}}村超｜{{redLeaf}} VS {{blueLeaf}}，来踢球！",
    sameProvinceTemplate: "<script>{{redFull}}</script>",
    crossProvinceTemplate: "{{unknown}} VS {{blueFull}}",
  },
});
assert.deepEqual(ruralCloud.ruralLeaderboard, {
  enabled: true,
  metrics: ["goals", "points"],
  scopes: ["town", "province"],
  defaultScope: "town",
});
assert.equal(ruralCloud.regionalShare.sameCountyTemplate, "{{commonRegion}}村超｜{{redLeaf}} VS {{blueLeaf}}，来踢球！");
assert.equal(ruralCloud.regionalShare.sameProvinceTemplate, DEFAULT_FEATURES.regionalShare.sameProvinceTemplate, "HTML 模板必须回退包内默认");
assert.equal(ruralCloud.regionalShare.crossProvinceTemplate, DEFAULT_FEATURES.regionalShare.crossProvinceTemplate, "未知占位符必须回退包内默认");

// 13) 场次闸门参数云端可调，且带钳制；恶意值回落默认。
assert.equal(upgraded.monetization.freeMatchesPerDay, 2, "未提供时回落默认 2 局");
const gateTuned = normalizeFeatures({ monetization: { freeMatchesPerDay: 0, singleUnlockMatches: 99, dayPassThreshold: 1, shareTitle: "来踢球" } });
assert.equal(gateTuned.monetization.freeMatchesPerDay, 0, "0 局免费是合法运营值");
assert.equal(gateTuned.monetization.singleUnlockMatches, 10, "单次解锁钳制到 10");
assert.equal(gateTuned.monetization.dayPassThreshold, 2, "全天阈值越界钳制到下界 2");
assert.equal(gateTuned.monetization.shareTitle, "来踢球");

// 14) 公告与维护开关：畸形输入回落默认。
const { normalizeAnnouncement, normalizeMaintenance } = require("../src/net/remote-config");
assert.deepEqual(normalizeAnnouncement({ text: "今晚 8 点县域杯开赛", level: "warn" }), { text: "今晚 8 点县域杯开赛", level: "warn" });
assert.deepEqual(normalizeAnnouncement({ text: "x", level: "hack" }), { text: "x", level: "info" });
assert.deepEqual(normalizeAnnouncement(null), { text: "", level: "info" });
assert.deepEqual(normalizeMaintenance({ onlineBlocked: 1, message: "服务器维护中", minClientVersion: "1.0.2" }), { onlineBlocked: true, message: "服务器维护中", minClientVersion: "1.0.2" });
assert.deepEqual(normalizeMaintenance(undefined), { onlineBlocked: false, message: "", minClientVersion: "" });
assert.equal(isValidRemoteConfig({ announcement: { text: "hi" } }), true, "仅公告也是合法配置");
assert.equal(isValidRemoteConfig({ maintenance: { onlineBlocked: true } }), true, "仅维护开关也是合法配置");
assert.equal(isValidRemoteConfig({ events: [] }), true, "仅活动列表也是合法配置");

// 15) 预留扩展模块：天气/杯赛/通行证/成就/高光/方言/反馈/实验组/自定义槽/活动。
const { normalizeRemoteConfig } = require("../src/net/remote-config");
const extended = normalizeRemoteConfig({
  features: {
    weather: { enabled: true, types: ["rain", "acid", "mud"], probability: 130 },
    tournament: { enabled: true, title: "丰收杯", format: "swiss", rounds: 99 },
    seasonPass: { enabled: true, days: 3 },
    achievements: { enabled: true, list: [{ id: "hat-trick", title: "帽子戏法", desc: "单场三球", target: 3 }, { id: "", title: "无id" }] },
    highlights: { enabled: true },
    dialectPack: { enabled: true, pack: "guangdong_v1" },
    feedback: { enabled: true },
    experiments: { home_layout: "b", "bad-key!": "x", "": "y", "__proto__": "polluted" },
    customModules: { lucky_draw: { enabled: true, note: "转盘抽奖" }, "BAD NAME": { enabled: true }, "__proto__": { enabled: true, note: "polluted" } },
  },
  events: [
    { id: "harvest", title: "丰收杯", kind: "cup", startAt: 1770000000000, endAt: 1771000000000 },
    { id: "bad", title: "类型非法", kind: "lottery" },
  ],
  teams: Array.from({ length: 40 }, (_, index) => ({ id: `team${index}` })),
});
assert.deepEqual(extended.features.weather, { enabled: true, types: ["rain", "mud"], probability: 100 }, "天气类型白名单+概率钳制");
assert.equal(extended.features.tournament.format, "knockout", "非法赛制回落淘汰赛");
assert.equal(extended.features.tournament.rounds, 6, "杯赛轮数钳制到 6");
assert.equal(extended.features.seasonPass.days, 7, "通行证天数钳制下界 7");
assert.equal(extended.features.achievements.list.length, 1, "无 id 成就被丢弃");
assert.equal(extended.features.highlights.enabled, true);
assert.equal(extended.features.dialectPack.pack, "guangdong_v1");
assert.deepEqual(extended.features.experiments, { home_layout: "b" }, "实验组键名白名单");
assert.deepEqual(extended.features.customModules, { lucky_draw: { enabled: true, note: "转盘抽奖" } }, "自定义槽只收合法键名");
assert.equal(Object.getPrototypeOf(extended.features.customModules), Object.prototype, "__proto__ 键不得触发原型链污染");
assert.equal(extended.events.length, 1, "非法活动类型被丢弃");
assert.equal(extended.events[0].kind, "cup");
assert.equal(extended.teams.length, 32, "teams 超大载荷截断到 32（与服务端 safeTeams 对齐）");

console.info("[test-remote-config] PASS：远程队伍覆盖、云端功能开关、升级模块白名单与钳制、公告维护开关与 HTTPS/WSS/广告位校验均正常");
