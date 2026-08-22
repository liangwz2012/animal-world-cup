import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGameShell, leaderboardTeamNameForScope } = require("../src/ui/game-shell.js");
const { defaults } = require("../src/data/game-options.js");
const { RURAL_SQUAD, ruralPlayersForSide } = require("../src/data/rural-squad.js");

class Point {
  constructor() { this.x = 0; this.y = 0; }
  set(x, y) { this.x = x; this.y = y == null ? x : y; }
}

class Anchor extends Point {}

class Container {
  constructor() {
    this.children = [];
    this.position = new Point();
    this.scale = new Point();
    this.scale.set(1, 1);
    this.parent = null;
    this.visible = true;
  }
  addChild(...children) {
    for (const child of children) {
      if (child.parent) child.parent.removeChild(child);
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }
  removeChildren() {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }
  getChildByName(name) { return this.children.find((child) => child.name === name); }
  destroy() { this.removeChildren(); }
}

class Graphics extends Container {
  clear() { return this; }
  lineStyle() { return this; }
  beginFill() { return this; }
  drawRect() { return this; }
  drawRoundedRect() { return this; }
  drawCircle() { return this; }
  endFill() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
}

const imagePaths = [];
class Sprite extends Container {
  constructor(path) {
    super();
    this.path = path;
    this.anchor = new Anchor();
    this.alpha = 1;
    this.rotation = 0;
  }
  static fromImage(path) {
    imagePaths.push(path);
    return new Sprite(path);
  }
}

class Text extends Container {
  constructor(value, style) {
    super();
    this.text = String(value);
    this.style = style;
    this.anchor = new Anchor();
  }
}

let rendererOptions = null;
const renderer = {
  render() {},
  resize(width, height) { this.lastResize = { width, height }; },
};
const PIXI = {
  Container,
  Graphics,
  Sprite,
  Text,
  autoDetectRenderer(width, height, options) {
    rendererOptions = { width, height, options };
    return renderer;
  },
};

let touchStart = null;
let mouseDown = null;
let action = null;
let actionConfig = null;
let actionPayload = null;
const storage = {};
const wxApi = {
  getSystemInfoSync() { return { windowWidth: 915, windowHeight: 412, pixelRatio: 2 }; },
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  onTouchStart(handler) { touchStart = handler; },
  offTouchStart(handler) { if (touchStart === handler) touchStart = null; },
  onMouseDown(handler) { mouseDown = handler; },
  offMouseDown(handler) { if (mouseDown === handler) mouseDown = null; },
};

const canvasListeners = {};
const canvas = {
  addEventListener(type, handler) { canvasListeners[type] = handler; },
  removeEventListener(type, handler) { if (canvasListeners[type] === handler) delete canvasListeners[type]; },
};

const shell = createGameShell({
  PIXI,
  canvas,
  wxApi,
  width: 915,
  height: 412,
  resolution: 2,
  pixelRatio: 3,
  config: defaults(),
  friendEntryEnabled: true,
  onAction(type, config, payload) {
    action = type;
    actionConfig = config;
    actionPayload = payload;
  },
  requestFrame() { return 1; },
  cancelFrame() {},
});
shell.showHome(defaults());

assert.equal(rendererOptions.options.resolution, 2, "高 DPI 真机必须以 2 倍分辨率渲染");
assert.equal(rendererOptions.options.autoResize, true);
assert.equal(typeof touchStart, "function", "真机选队页必须在 touchstart 即时响应");
assert.equal(typeof mouseDown, "function", "PC 小游戏鼠标必须接入选队页");
assert.equal(typeof canvasListeners.mousedown, "function", "开发者工具 Canvas 鼠标必须接入选队页");
const currentNodes = () => {
  const nodes = [];
  const visit = (node) => {
    if (!node) return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(shell.stage);
  return nodes;
};
const homeSquadSprites = currentNodes().filter((node) => typeof node.path === "string" && node.path.startsWith("shell-assets/squad/"));
assert.equal(homeSquadSprites.length, 12, "首页左右必须各紧凑展示6名乡村人物");
assert.match(homeSquadSprites[0].path, /graduate-forward\.png$/, "返乡大学生必须位于主队第一张人物卡");
assert.equal(new Set(homeSquadSprites.map((node) => node.path)).size, 12, "主客队 6+6 必须使用完整且互不重复的12张半身像");
const redSquadPaths = new Set(homeSquadSprites.slice(0, 6).map((node) => node.path));
const blueSquadPaths = new Set(homeSquadSprites.slice(6, 12).map((node) => node.path));
assert.ok(
  [...redSquadPaths].every((playerPath) => !blueSquadPaths.has(playerPath)),
  "主队与客队人物不得重复",
);
for (const player of RURAL_SQUAD) {
  assert.ok(player.id && player.number, "首页人物资源必须由完整乡村队名单驱动");
}
const captainCustomLabels = currentNodes().filter((node) => node.text === "自定义");
assert.equal(captainCustomLabels.length, 0, "头像自定义尚未接通时首页不得显示空入口");
const expectedVocations = [
  ...ruralPlayersForSide("red"),
  ...ruralPlayersForSide("blue"),
].map((player) => player.vocation);
const initialHomeTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
for (const vocation of expectedVocations) {
  assert.equal(initialHomeTexts.filter((value) => value === vocation).length, 1, `首页必须显示职业标签：${vocation}`);
}
assert.equal(initialHomeTexts.includes("待定"), false, "球员卡不得再用待定占位");

// 915×412 的横版模拟器会把 1280×720 设计坐标按高度缩放并水平居中。
const designScale = 412 / 720;
const designOffsetX = (915 - 1280 * designScale) / 2;
const pointAt = (x, y) => ({ clientX: designOffsetX + x * designScale, clientY: y * designScale });
const clickAt = async (x, y) => {
  canvasListeners.mousedown(pointAt(x, y));
  await new Promise((resolve) => setTimeout(resolve, 130));
};

action = null;
actionPayload = null;
await clickAt(112, 254);
assert.notEqual(action, "home-captain-custom", "原自定义角标区域不得继续触发体型面板");

// 首页地区队：四级“我的地域”入口始终可见，后三级在上一级选好前保持锁定。
shell.showHome(Object.assign({}, defaults(), {
  redRegion: { path: [], customName: "", displayName: "" },
  blueRegion: { path: [], customName: "", displayName: "" },
}));
action = null;
actionPayload = null;
const initialRegionTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
for (const placeholder of ["我的省", "我的市", "我的县", "我的乡镇"]) assert.ok(initialRegionTexts.includes(placeholder));
for (const placeholder of ["对方省", "对方市", "对方县", "对方乡镇"]) assert.ok(initialRegionTexts.includes(placeholder));
for (const placeholder of ["我的省", "我的市", "我的县", "我的乡镇", "对方省", "对方市", "对方县", "对方乡镇"]) {
  assert.equal(initialRegionTexts.filter((value) => value === placeholder).length, 1, `主客队地区占位词必须各归其位：${placeholder}`);
}
for (const removedCopy of ["XX省", "XX市", "XX县", "XX镇", "逐级下拉选择家乡地区，选完自动匹配对手", "使用上次选择的家乡队"]) {
  assert.equal(initialRegionTexts.includes(removedCopy), false, `首页不得显示冗余提示：${removedCopy}`);
}
await clickAt(182, 150);
assert.equal(action, "home-region-dropdown", "主队未选择地区时必须从省份下拉开始");
assert.deepEqual(actionPayload, { side: "red", levelIndex: 0, parentCode: "" });

const regionalConfig = Object.assign({}, defaults(), {
  redRegion: {
    path: [{ code: "440000", parentCode: "", level: "province", name: "广东省", shortName: "广东" }],
    displayName: "广东",
  },
  blueRegion: {
    path: [{ code: "360000", parentCode: "", level: "province", name: "江西省", shortName: "江西" }],
    displayName: "江西",
  },
});
shell.showHome(regionalConfig);
const regionalTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
assert.ok(regionalTexts.includes("广东队"), "主队地区名称必须在首页显示");
assert.ok(regionalTexts.includes("江西队"), "自动匹配的客队地区名称必须在首页显示");
for (const vocation of expectedVocations) {
  assert.equal(regionalTexts.filter((value) => value === vocation).length, 1, `切换地区后职业标签仍须保持：${vocation}`);
}

action = null;
actionPayload = null;
await clickAt(268, 150);
assert.equal(action, "home-region-dropdown", "选完省份后必须出现城市下拉入口");
assert.deepEqual(actionPayload, { side: "red", levelIndex: 1, parentCode: "440000" });

const fullPathConfig = Object.assign({}, regionalConfig, {
  redRegion: {
    path: [
      { code: "440000", parentCode: "", level: "province", name: "广东省", shortName: "广东" },
      { code: "440900", parentCode: "440000", level: "city", name: "茂名市", shortName: "茂名" },
      { code: "440983", parentCode: "440900", level: "county", name: "信宜市", shortName: "信宜" },
      { code: "440983100001", parentCode: "440983", level: "town", name: "镇隆镇", shortName: "镇隆" },
    ],
    displayName: "镇隆",
  },
});
shell.showHome(fullPathConfig);
const inlineCustomNode = currentNodes().find((node) => node.text === "自定义村名/队名");
assert.ok(inlineCustomNode, "主队选满四级后必须显示自定义村名/队名入口");
assert.equal(Math.round(inlineCustomNode.position.y), 150, "自定义入口必须与省市县镇处于同一行");
action = null;
await clickAt(510, 150);
assert.equal(action, "home-region-custom", "主队选定乡镇后必须提供自定义村名/队名入口");
shell.showHome(regionalConfig);

action = null;
await clickAt(1141, 150);
assert.equal(action, "home-opponent-reroll", "客队必须支持换一个同级对手");
// 客队地区与主队一样走级联下拉直改，不再有"手动选择"按钮
action = null;
actionPayload = null;
await clickAt(788, 150);
assert.equal(action, "home-region-dropdown", "客队地区必须支持下拉直改");
assert.deepEqual(actionPayload, { side: "blue", levelIndex: 0, parentCode: "" });
const blueTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
assert.ok(!blueTexts.includes("手动选择"), "客队面板不得再出现手动选择按钮");
shell.showHome(regionalConfig);

// 首页只保留三个入口；排行榜和观战收进“战绩与好友”弹窗。
action = null;
await clickAt(1028, 582);
assert.equal(shell.screen, "mode-hub", "首页战绩与好友入口必须先打开聚合弹窗");
await clickAt(474, 281);
assert.equal(action, "leaderboard", "战绩与好友弹窗必须提供排行榜入口");
shell.showLeaderboard({
  profile: {},
  region: {
    code: "440983101000",
    name: "镇隆",
    level: "town",
    fullTeamName: "广东省茂名市信宜市镇隆镇乡亲联队",
  },
  stats: { matches: 5, wins: 3, draws: 1, losses: 1, goalsFor: 7, goalsAgainst: 3, cleanSheets: 3, points: 10, bestWinStreak: 2 },
  values: { points: 10, wins: 3, goals: 7, winRate: 60, cleanSheets: 3, streak: 2 },
  metrics: [{ id: "points", label: "积分" }, { id: "goals", label: "进球" }, { id: "winRate", label: "胜率", suffix: "%" }],
  qualified: true,
  onlineEnabled: true,
  online: true,
  remoteMetric: "points",
  remoteScopeId: "nation",
  remoteScope: { key: "CN:rural", title: "全国乡村榜" },
  remoteScopeOptions: [
    { id: "nation", label: "全国", key: "CN:rural", title: "全国乡村榜", enabled: true },
    { id: "province", label: "我的省", key: "440000:rural", title: "广东乡村榜", enabled: true },
    { id: "city", label: "我的市", key: "440900:rural", title: "茂名乡村榜", enabled: true },
    { id: "county", label: "我的县", key: "440983:rural", title: "信宜乡村榜", enabled: true },
    { id: "town", label: "我的乡镇", key: "440983101000:village", title: "镇隆村队榜", enabled: true },
  ],
  remoteRows: [
    { rank: 1, fullTeamName: "贵州省贵阳市开阳县楠木渡镇乡亲联队", value: 88 },
    { rank: 2, fullTeamName: "云南省昆明市富民县东村镇乡亲联队", value: 82 },
    { rank: 3, fullTeamName: "福建省福州市闽侯县青口镇乡亲联队", value: 76 },
    { rank: 4, fullTeamName: "湖南省长沙市长沙县高桥镇乡亲联队", value: 70 },
    { rank: 5, fullTeamName: "四川省成都市金堂县竹篙镇乡亲联队", value: 66 },
  ],
});
assert.equal(shell.screen, "leaderboard", "排行榜必须保持横版遮罩界面");
const leaderboardTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
for (const label of ["乡村足球荣耀榜", "一村一队 · 为家乡而战", "全国", "我的省", "我的市", "我的县", "我的乡镇", "积分榜", "进球榜", "胜率榜"]) {
  assert.ok(leaderboardTexts.includes(label), `荣耀榜必须显示：${label}`);
}
for (const removed of ["胜场", "零封", "连胜", "全国省队榜"]) assert.equal(leaderboardTexts.includes(removed), false, `荣耀榜不得再显示：${removed}`);
assert.deepEqual(
  currentNodes().filter((node) => node.__ruralHonorStyle).map((node) => node.__ruralHonorStyle),
  ["gold-crown", "silver-shield", "bronze-laurel"],
  "前三名必须使用金冠、银盾、铜桂冠",
);
assert.deepEqual(
  currentNodes().filter((node) => node.__ruralHonorRankNumeral).map((node) => node.__ruralHonorRankNumeral),
  [1, 2, 3],
  "前三名装饰内必须保留数字 1/2/3",
);
action = null;
actionPayload = null;
await clickAt(650, 167);
assert.equal(action, "leaderboard-scope", "我的省标签必须切换地区榜范围");
assert.deepEqual(actionPayload, { scopeId: "province", metric: "points" });
shell.showLeaderboard({
  profile: { nickname: "", avatarUrl: "" },
  region: { code: "440983101000", name: "镇隆", level: "town", fullTeamName: "广东省茂名市信宜市镇隆镇乡亲联队" },
  stats: { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
  values: { points: 0, goals: 0, winRate: 0 },
  metrics: [{ id: "points", label: "积分" }, { id: "goals", label: "进球" }, { id: "winRate", label: "胜率", suffix: "%" }],
  onlineEnabled: true,
  online: true,
  remoteMetric: "points",
  remoteScopeId: "province",
  remoteScope: { key: "440000:rural", title: "广东省乡村榜" },
  remoteScopeOptions: [
    { id: "nation", label: "全国", key: "CN:rural", title: "全国乡村榜", enabled: true },
    { id: "province", label: "我的省", key: "440000:rural", title: "广东省乡村榜", enabled: true },
  ],
});
await new Promise((resolve) => setTimeout(resolve, 140));
action = null;
actionPayload = null;
await clickAt(650, 167);
assert.equal(action, "leaderboard-scope-browse", "当前省榜标签再次点击必须打开其他地区浏览器");
assert.deepEqual(actionPayload, { scopeId: "province", metric: "points" });
assert.equal(
  leaderboardTeamNameForScope({
    fullTeamName: "广东省茂名市信宜市镇隆镇天后街队",
    path: [
      { code: "440000", name: "广东省" },
      { code: "440900", name: "茂名市" },
      { code: "440983", name: "信宜市" },
      { code: "440983101000", name: "镇隆镇" },
    ],
  }, { key: "440900:rural" }),
  "信宜市镇隆镇天后街队",
  "市榜行必须裁掉共同的省、市前缀",
);
// 先点“加入排行榜”制造异步授权未完成时的点击锁，再点返回；返回必须无条件生效。
action = null;
await clickAt(302, 522);
assert.equal(action, "leaderboard-profile", "加入排行榜必须仍可触发授权动作");
await clickAt(640, 609);
assert.equal(shell.screen, "home", "返回选队不得被异步动作遗留的点击锁拦住");

// 地区选择只在排行榜里打开，首页不增加新入口；所有级别都能继续下钻或确认当前地区。
action = null;
shell.showRegionPicker({
  path: [],
  entries: [{ code: "440000", name: "广东省", shortName: "广东", level: "province" }],
});
assert.equal(shell.screen, "region-picker", "地区选择器必须保持横版弹窗");
await clickAt(206, 238);
assert.equal(action, "leaderboard-region-step", "省份卡片必须进入下一级地区");
action = null;
shell.showRegionPicker({
  path: [{ code: "440000", name: "广东省", shortName: "广东", level: "province" }],
  entries: [{ code: "440100", name: "广州市", shortName: "广州", level: "city" }],
});
await clickAt(960, 636);
assert.equal(action, "leaderboard-region-confirm", "当前地区必须能直接确认参赛，不强迫选择到更细层级");
action = null;
shell.showRegionPicker({
  mode: "leaderboard-browse",
  title: "选择要查看的省",
  targetLevel: "province",
  allowConfirm: true,
  path: [{ code: "440000", name: "广东省", shortName: "广东", level: "province" }],
  entries: [],
});
const browseTexts = currentNodes().filter((node) => typeof node.text === "string").map((node) => node.text);
assert.ok(browseTexts.includes("查看 广东省 排名"), "浏览模式确认按钮必须明确只查看排名");
await new Promise((resolve) => setTimeout(resolve, 140));
await clickAt(960, 636);
assert.equal(action, "leaderboard-region-confirm", "浏览模式必须复用安全的地区确认动作");
shell.showHome(defaults());

// Android 某些基础库会返回设备物理像素，而 Canvas 为节省性能只按 2 倍渲染。
// “立即开赛”主按钮几何中心为 (640, 580)，换算 3 倍设备像素。
const startPoint = pointAt(640, 580);
touchStart({ touches: [{ clientX: startPoint.clientX * 3, clientY: startPoint.clientY * 3 }] });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "ai", "设备像素比与 Canvas 分辨率不同时仍必须命中立即对战按钮");

action = null;
shell.showHome(defaults());
mouseDown(pointAt(640, 580));
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "ai", "PC 小游戏逻辑像素鼠标必须命中立即对战按钮");

action = null;
shell.showHome(defaults());
await clickAt(1028, 582);
await clickAt(806, 281);
assert.equal(action, "watch", "战绩与好友弹窗必须提供观看对战入口");

// 挑战玩法在独立弹窗中，避免首页堆叠具体玩法。
action = null;
shell.showHome(defaults());
await clickAt(253, 582);
assert.equal(shell.screen, "mode-hub", "挑战玩法必须先打开聚合弹窗");
await clickAt(640, 274);
assert.equal(action, "season", "挑战玩法弹窗必须可进入赛季征程");
action = null;
shell.showHome(defaults());
await clickAt(253, 582);
await clickAt(640, 392);
assert.equal(action, "daily", "挑战玩法弹窗必须可进入每日挑战");

action = null;
shell.showHome(defaults());
await clickAt(1028, 582);
await clickAt(640, 382);
assert.equal(action, "friend-prepare", "好友对战必须先进入赛前设置，再创建邀请");
assert.equal(shell.screen, "mode-hub");

shell.setFriendState({ status: "waiting_host", roomId: "room-test" });
assert.equal(shell.friendState.status, "waiting_host", "公共状态方法必须能驱动等待好友界面");
shell.setFriendState({ status: "guest_can_spectate", role: "guest" });
assert.equal(shell.friendState.status, "guest_can_spectate", "好友端必须可表达观看热身赛状态");
shell.setFriendState({ status: "queue_after_warmup", role: "guest", guestSpectating: false });
assert.equal(shell.friendState.status, "queued_after_warmup", "服务端热身排队状态必须映射到等待层");

action = null;
shell.setFriendState({ status: "waiting_host", role: "host" });
canvasListeners.mousedown({ clientX: 458, clientY: 258 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "warmup-ai", "房主等待时必须可先开始 AI 热身");

action = null;
shell.setFriendState({ status: "host_warmup", role: "host" });
canvasListeners.mousedown({ clientX: 530, clientY: 258 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "queue-friend-after-warmup", "好友上线后房主必须可选择踢完当前热身局");

// 提审版关闭好友入口：社交卡不留空白，仍保留排行榜和观看对战。
let gatedTouchStart = null;
let gatedMouseDown = null;
const gatedCanvasListeners = {};
const gatedWxApi = {
  getSystemInfoSync() { return { windowWidth: 915, windowHeight: 412, pixelRatio: 2 }; },
  onTouchStart(handler) { gatedTouchStart = handler; },
  offTouchStart(handler) { if (gatedTouchStart === handler) gatedTouchStart = null; },
  onMouseDown(handler) { gatedMouseDown = handler; },
  offMouseDown(handler) { if (gatedMouseDown === handler) gatedMouseDown = null; },
};
const gatedCanvas = {
  addEventListener(type, handler) { gatedCanvasListeners[type] = handler; },
  removeEventListener(type, handler) { if (gatedCanvasListeners[type] === handler) delete gatedCanvasListeners[type]; },
};
const gatedShell = createGameShell({
  PIXI,
  canvas: gatedCanvas,
  wxApi: gatedWxApi,
  width: 915,
  height: 412,
  resolution: 2,
  pixelRatio: 3,
  config: defaults(),
  friendEntryEnabled: false,
  onAction(type, config, payload) {
    action = type;
    actionConfig = config;
    actionPayload = payload;
  },
  requestFrame() { return 1; },
  cancelFrame() {},
});
gatedShell.showHome(defaults());
action = null;
gatedCanvasListeners.mousedown(pointAt(1028, 582));
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(gatedShell.screen, "mode-hub", "好友入口关闭后仍需打开战绩与好友弹窗");
gatedCanvasListeners.mousedown(pointAt(474, 281));
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "leaderboard", "好友入口关闭后战绩与好友弹窗必须保留排行榜");
gatedShell.showHome(defaults()); // 实际应用会切入排行榜并重置导航锁；测试显式模拟该状态切换。
action = null;
gatedCanvasListeners.mousedown(pointAt(640, 580));
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "ai", "好友入口关闭后立即开赛必须保持可点");
gatedShell.destroy();

// 新手引导：首次未看过 → showTutorial 必须切到引导遮罩
assert.equal(shell.hasSeenTutorial(), false, "首次进入应未看过新手引导");
let tutorialDone = false;
shell.showTutorial(() => { tutorialDone = true; });
assert.equal(shell.screen, "tutorial", "showTutorial 必须切到引导遮罩");
assert.equal(tutorialDone, false, "未点开始前不应触发完成回调");

// 所有本地开赛路径先进入赛前弹窗；阵型只能在这里修改，首次同时展示操作教学。
action = null;
actionConfig = null;
actionPayload = null;
shell.showPreMatch(defaults(), { kind: "ai", title: "开赛前设置" });
assert.equal(shell.screen, "prematch", "立即开赛必须先进入赛前设置弹窗");
assert.equal(shell.preMatchState.showTutorial, true, "首次赛前弹窗必须包含操作教学");
assert.ok(
  currentNodes().some((node) => node.text === "脚印＝队友传球方向 · 按传/挑找接应"),
  "赛前操作教学必须解释常驻脚印的含义和使用方式",
);
await clickAt(473, 260); // 主队第二个阵型：3-2-1
assert.equal(shell.screen, "prematch", "调整阵型后必须留在赛前弹窗");
assert.equal(shell.config.redFormation, "3-2-1", "赛前弹窗修改的阵型必须写回对局配置");
await clickAt(805, 633);
assert.equal(action, "prematch-start", "赛前确认后才允许进入真实开赛流程");
assert.equal(actionPayload.kind, "ai");
assert.equal(actionConfig.redFormation, "3-2-1", "确认时必须把赛前阵型传给应用层");
assert.equal(shell.hasSeenTutorial(), true, "首次确认后必须记录操作教学已看过");

action = null;
shell.showPreMatch(defaults(), { kind: "season", lockedRules: true, title: "赛季征程" });
assert.equal(shell.preMatchState.showTutorial, false, "第二次赛前弹窗不应重复教学");
await clickAt(475, 633);
assert.equal(action, "prematch-cancel", "取消赛前弹窗必须回到选队，而不是启动比赛");
assert.equal(shell.screen, "home", "取消赛前弹窗必须立即回到选队主页");

shell.destroy();
assert.equal(touchStart, null, "销毁页面必须注销真机触摸监听");
assert.equal(mouseDown, null, "销毁页面必须注销 PC 鼠标监听");
assert.equal(canvasListeners.mousedown, undefined, "销毁页面必须注销 Canvas 鼠标监听");

const desktopShell = createGameShell({
  PIXI,
  canvas,
  wxApi,
  width: 1280,
  height: 720,
  resolution: 1,
  pixelRatio: 1,
  desktopControls: true,
  config: defaults(),
  onAction() {},
  requestFrame() { return 1; },
  cancelFrame() {},
});
desktopShell.showPreMatch(defaults(), { kind: "ai", title: "开赛前设置" });
const desktopTexts = [];
const collectDesktop = (node) => {
  if (!node) return;
  if (typeof node.text === "string") desktopTexts.push(node.text);
  for (const child of node.children || []) collectDesktop(child);
};
collectDesktop(desktopShell.stage);
for (const label of ["WASD  移动", "方向键  右手动作", "SPACE  射门", "电脑版微信键盘操作"]) {
  assert.ok(desktopTexts.includes(label), `电脑版赛前教学必须显示：${label}`);
}
assert.equal(desktopTexts.includes("左手"), false, "电脑版教学不得继续显示手机左手摇杆说明");
assert.equal(desktopTexts.includes("右手"), false, "电脑版教学不得继续显示手机右手触屏说明");
desktopShell.destroy();

console.info("[test:game-shell] PASS：主包头像、高 DPI、Android 触点和开发者工具鼠标正常");
