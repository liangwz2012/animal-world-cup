// 场次解锁状态机测试：免费 2 局 → 四种解锁（转发/视频 ×1 局，累计 5 次 → 全天）。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createPlayGate, STORAGE_KEY } = require("../src/monetize/play-gate");

function makeWx(overrides = {}) {
  const store = new Map();
  const calls = { actionSheets: [], shares: [], toasts: [] };
  return {
    calls,
    store,
    getStorageSync: (k) => store.get(k),
    setStorageSync: (k, v) => store.set(k, v),
    shareAppMessage: (p) => calls.shares.push(p),
    showToast: (p) => calls.toasts.push(p.title),
    showActionSheet: (p) => calls.actionSheets.push(p),
    ...overrides,
  };
}

function makeGate(wx, extra = {}) {
  let day = extra.day || "2026-07-16";
  const gate = createPlayGate({
    wxApi: wx,
    now: () => new Date(`${day}T12:00:00`),
    adUnitId: extra.adUnitId != null ? extra.adUnitId : "adunit-test",
    rewardedAd: extra.rewardedAd,
    enabled: extra.enabled,
    shareUnlockEnabled: extra.shareUnlockEnabled,
    ...extra.opts,
  });
  return { gate, setDay: (d) => { day = d; } };
}

// 1) 每日免费 2 局，第 3 局被拦
{
  const wx = makeWx();
  const { gate } = makeGate(wx);
  assert.equal(gate.tryConsume().ok, true, "第 1 局免费");
  assert.equal(gate.tryConsume().ok, true, "第 2 局免费");
  const third = gate.tryConsume();
  assert.equal(third.ok, false, "第 3 局必须被拦");
  assert.equal(third.state.freeLeft, 0);
}

// 2) 单次解锁 +1 局；满 5 次升级全天
{
  const wx = makeWx();
  const { gate } = makeGate(wx);
  gate.tryConsume(); gate.tryConsume();
  for (let i = 1; i <= 4; i += 1) {
    const r = gate.grantSingle("ad");
    assert.equal(r.upgraded, false, `第 ${i} 个视频尚未升级全天`);
    assert.equal(gate.tryConsume().ok, true, `视频解锁的第 ${i} 局可开赛`);
    assert.equal(gate.tryConsume().ok, false, "额度只有 1 局");
  }
  const fifth = gate.grantSingle("ad");
  assert.equal(fifth.upgraded, true, "第 5 个视频升级全天畅玩");
  for (let i = 0; i < 10; i += 1) assert.equal(gate.tryConsume().ok, true, "全天畅玩不限次");
}

// 3) 转发解锁与视频计数互相独立
{
  const wx = makeWx();
  const { gate } = makeGate(wx);
  gate.tryConsume(); gate.tryConsume();
  gate.grantSingle("share");
  const s = gate.state();
  assert.equal(s.shareCount, 1);
  assert.equal(s.adCount, 0);
  assert.equal(gate.tryConsume().ok, true, "转发解锁 1 局");
}

// 4) 跨天重置：额度/计数/全天卡全部清零
{
  const wx = makeWx();
  const { gate, setDay } = makeGate(wx);
  gate.tryConsume(); gate.tryConsume();
  for (let i = 0; i < 5; i += 1) gate.grantSingle("ad");
  assert.equal(gate.state().dayPass, true);
  setDay("2026-07-17");
  const s = gate.state();
  assert.equal(s.dayPass, false, "次日全天卡失效");
  assert.equal(s.freeLeft, 2, "次日免费局重置");
  assert.equal(gate.tryConsume().ok, true, "次日第 1 局免费");
}

// 5) 解锁面板：四个选项齐全，选「看视频」走激励视频并解锁
{
  const wx = makeWx();
  const fakeAd = { available: () => true, show: ({ onReward }) => onReward() };
  const { gate } = makeGate(wx, { rewardedAd: fakeAd });
  gate.tryConsume(); gate.tryConsume();
  let unlocked = null;
  gate.requestUnlock({ onUnlocked: (state) => { unlocked = state; } });
  assert.equal(wx.calls.actionSheets.length, 1, "必须弹出解锁面板");
  const sheet = wx.calls.actionSheets[0];
  assert.equal(sheet.itemList.length, 4, "四个解锁选项");
  assert.ok(sheet.itemList[0].includes("转发"), "选项1=转发解锁1局");
  assert.ok(sheet.itemList[1].includes("视频"), "选项2=视频解锁1局");
  assert.ok(sheet.itemList[2].includes("畅玩一天"), "选项3=转发满5次畅玩一天");
  assert.ok(sheet.itemList[3].includes("畅玩一天"), "选项4=视频满5个畅玩一天");
  sheet.success({ tapIndex: 1 });
  assert.ok(unlocked, "看完视频必须回调解锁");
  assert.equal(gate.tryConsume().ok, true, "解锁后可开赛");
}

// 6) 转发选项：点转发即计数并解锁
{
  const wx = makeWx();
  const fakeAd = { available: () => false, show: () => {} };
  const { gate } = makeGate(wx, { rewardedAd: fakeAd });
  gate.tryConsume(); gate.tryConsume();
  let unlocked = null;
  gate.requestUnlock({ onUnlocked: (s) => { unlocked = s; } });
  const sheet = wx.calls.actionSheets[0];
  assert.equal(sheet.itemList.length, 2, "无广告位时只剩转发两项");
  sheet.success({ tapIndex: 0 });
  assert.equal(wx.calls.shares.length, 1, "必须调起转发");
  assert.ok(unlocked && unlocked.shareCount === 1, "转发计数累进");
}

// 7) 无任何解锁渠道时直接放行，绝不锁死玩家
{
  const wx = makeWx();
  const fakeAd = { available: () => false, show: () => {} };
  const { gate } = makeGate(wx, { rewardedAd: fakeAd, shareUnlockEnabled: false });
  gate.tryConsume(); gate.tryConsume();
  let unlocked = false;
  gate.requestUnlock({ onUnlocked: () => { unlocked = true; } });
  assert.equal(unlocked, true, "无渠道必须直接放行");
  assert.equal(wx.calls.actionSheets.length, 0);
}

// 8) 总开关关闭 = 无限畅玩（提审模式）
{
  const wx = makeWx();
  const { gate } = makeGate(wx, { enabled: false });
  for (let i = 0; i < 20; i += 1) assert.equal(gate.tryConsume().ok, true);
}

// 9) 存储键稳定（防止误改导致玩家额度丢失）
assert.equal(STORAGE_KEY, "animal-football:play-gate:v1");

console.log("[test-play-gate] PASS：免费2局、四选项解锁、5次升级全天、跨天重置、提审开关均正常");

// 10) 自定义呈现器（项目风格面板）：拿到结构化条目并可执行解锁
{
  const wx = makeWx();
  const fakeAd = { available: () => true, show: ({ onReward }) => onReward() };
  let presented = null;
  const gate = createPlayGate({
    wxApi: wx,
    now: () => new Date("2026-07-16T12:00:00"),
    adUnitId: "adunit-test",
    rewardedAd: fakeAd,
    present: (payload) => { presented = payload; return true; },
  });
  gate.tryConsume(); gate.tryConsume();
  let unlocked = null;
  gate.requestUnlock({ onUnlocked: (s) => { unlocked = s; } });
  assert.ok(presented, "必须走自定义面板");
  assert.equal(wx.calls.actionSheets.length, 0, "走面板时不得弹 ActionSheet");
  assert.equal(presented.entries.length, 4, "四个解锁条目");
  assert.deepEqual(presented.entries.map((e) => e.kind), ["share", "ad", "share", "ad"]);
  assert.deepEqual(presented.entries.map((e) => e.tier), ["single", "single", "day", "day"]);
  presented.entries[1].run();
  assert.ok(unlocked, "面板条目 run() 必须能解锁");
}

// 11) 呈现器返回 false → 回落 ActionSheet
{
  const wx = makeWx();
  const fakeAd = { available: () => true, show: () => {} };
  const gate = createPlayGate({
    wxApi: wx,
    now: () => new Date("2026-07-16T12:00:00"),
    adUnitId: "adunit-test",
    rewardedAd: fakeAd,
    present: () => false,
  });
  gate.tryConsume(); gate.tryConsume();
  gate.requestUnlock({});
  assert.equal(wx.calls.actionSheets.length, 1, "呈现器拒绝时必须回落 ActionSheet");
}

console.log("[test-play-gate] PASS：自定义面板呈现器与 ActionSheet 回落正常");

// 12) 防双击：面板条目连点只生效一次
{
  const wx = makeWx();
  const fakeAd = { available: () => false, show: () => {} };
  let presented = null;
  const gate = createPlayGate({
    wxApi: wx,
    now: () => new Date("2026-07-16T12:00:00"),
    adUnitId: "",
    rewardedAd: fakeAd,
    present: (payload) => { presented = payload; return true; },
  });
  gate.tryConsume(); gate.tryConsume();
  gate.requestUnlock({ onUnlocked: () => {} });
  presented.entries[0].run();
  presented.entries[0].run(); // 快速连点
  assert.equal(wx.calls.shares.length, 1, "连点只触发一次转发");
  assert.equal(gate.state().shareCount, 1, "连点只计数一次");
}

console.log("[test-play-gate] PASS：防双击守卫正常");
