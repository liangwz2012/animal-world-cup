// 场次解锁状态机：每天 N 局免费；用完后四种解锁方式 ——
//   ① 转发 1 次 → 解锁 1 局      ② 看 1 个激励视频 → 解锁 1 局
//   ③ 当日累计转发满 5 次 → 解锁全天  ④ 当日累计看满 5 个视频 → 解锁全天
// 单次转发/视频除了 +1 局外同时累进当日 5 次进度，第 5 次自动升级为全天畅玩。
// 纯逻辑与 wx 交互分离：storage/clock/ad/share 全部可注入，便于单元测试。
const CONFIG = require("./monetize-config");
const { createRewardedAd } = require("./rewarded-ad");

const STORAGE_KEY = "rural-football:play-gate:v1";

function createPlayGate(options) {
  const opts = options || {};
  const wxApi = opts.wxApi || (typeof wx !== "undefined" ? wx : null);
  const now = opts.now || (() => new Date());
  const enabled = opts.enabled != null ? !!opts.enabled : CONFIG.PLAY_GATE_ENABLED;
  const freePerDay = Number(opts.freePerDay != null ? opts.freePerDay : CONFIG.FREE_MATCHES_PER_DAY) || 0;
  const singleUnlock = Number(opts.singleUnlock != null ? opts.singleUnlock : CONFIG.SINGLE_UNLOCK_MATCHES) || 1;
  const dayPassThreshold = Number(opts.dayPassThreshold != null ? opts.dayPassThreshold : CONFIG.DAY_PASS_THRESHOLD) || 5;
  const shareEnabled = (opts.shareUnlockEnabled != null ? !!opts.shareUnlockEnabled : CONFIG.SHARE_UNLOCK_ENABLED);
  const adUnlockEnabled = (opts.adUnlockEnabled != null ? !!opts.adUnlockEnabled : CONFIG.AD_UNLOCK_ENABLED);
  const adUnitId = opts.adUnitId != null ? opts.adUnitId : CONFIG.REWARDED_AD_UNIT_ID;
  const rewardedAd = opts.rewardedAd || createRewardedAd({ wxApi, adUnitId });

  function today() {
    const d = now();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function readStorage() {
    try {
      if (wxApi && typeof wxApi.getStorageSync === "function") {
        const raw = wxApi.getStorageSync(STORAGE_KEY);
        if (raw && typeof raw === "object") return raw;
        if (typeof raw === "string" && raw) return JSON.parse(raw);
      }
    } catch (error) {}
    return null;
  }

  function writeStorage(state) {
    try {
      if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(STORAGE_KEY, state);
    } catch (error) {}
  }

  function freshState(day) {
    return { day, freeUsed: 0, credits: 0, adCount: 0, shareCount: 0, dayPass: false };
  }

  function loadState() {
    const day = today();
    let state = readStorage();
    if (!state || state.day !== day) state = freshState(day);
    state.freeUsed = Math.max(0, Number(state.freeUsed) || 0);
    state.credits = Math.max(0, Number(state.credits) || 0);
    state.adCount = Math.max(0, Number(state.adCount) || 0);
    state.shareCount = Math.max(0, Number(state.shareCount) || 0);
    state.dayPass = state.dayPass === true;
    return state;
  }

  function snapshot(state) {
    return {
      day: state.day,
      freeLeft: Math.max(0, freePerDay - state.freeUsed),
      credits: state.credits,
      adCount: state.adCount,
      shareCount: state.shareCount,
      dayPass: state.dayPass,
      enabled,
    };
  }

  // 开赛时调用：占用一个场次。返回 {ok} 或 {ok:false, state}
  function tryConsume() {
    if (!enabled) return { ok: true, state: null };
    const state = loadState();
    if (state.dayPass) return { ok: true, state: snapshot(state) };
    if (state.freeUsed < freePerDay) {
      state.freeUsed += 1;
      writeStorage(state);
      return { ok: true, state: snapshot(state) };
    }
    if (state.credits > 0) {
      state.credits -= 1;
      writeStorage(state);
      return { ok: true, state: snapshot(state) };
    }
    return { ok: false, state: snapshot(state) };
  }

  // 一次转发/一次视频完成后调用：+1 局并累进当日进度，满 5 次升级全天。
  function grantSingle(kind) {
    const state = loadState();
    if (kind === "ad") state.adCount += 1;
    else state.shareCount += 1;
    const count = kind === "ad" ? state.adCount : state.shareCount;
    let upgraded = false;
    if (count >= dayPassThreshold) {
      // 已经是全天卡时再转发/看视频只累进次数，不再重复弹「已解锁畅玩一天」。
      upgraded = !state.dayPass;
      state.dayPass = true;
    } else {
      state.credits += singleUnlock;
    }
    writeStorage(state);
    return { upgraded, state: snapshot(state) };
  }

  function doShare() {
    // 微信自 2018 年起不再返回转发成功回调，也无法验证是否转到「不同的群」。
    // 业界通行做法：点击转发即计数（用户取消也会计入，属产品自担的宽松口径）。
    try {
      if (wxApi && typeof wxApi.shareAppMessage === "function") {
        wxApi.shareAppMessage({ title: CONFIG.SHARE_TITLE, query: "from=unlock" });
        return true;
      }
    } catch (error) {}
    return false;
  }

  function toast(title) {
    try {
      if (wxApi && typeof wxApi.showToast === "function") wxApi.showToast({ title, icon: "none", duration: 2200 });
    } catch (error) {}
  }

  // 免费用完时的解锁面板。默认注入的 present（项目风格 PIXI 卡片）优先；
  // 缺失或返回 false 时回落到原生 ActionSheet。onUnlocked() 解锁成功后回调。
  function requestUnlock(callbacks) {
    const onUnlocked = callbacks && callbacks.onUnlocked || (() => {});
    const onCancel = callbacks && callbacks.onCancel || (() => {});
    const state = loadState();
    const adOk = adUnlockEnabled && rewardedAd.available();

    // 防双击：面板按钮快速连点只执行一次；视频失败时解除，允许换方式重试。
    let unlocking = false;
    const runShare = () => {
      if (unlocking) return;
      unlocking = true;
      if (!doShare()) { toast("当前环境不支持转发"); unlocking = false; return; }
      const result = grantSingle("share");
      toast(result.upgraded ? "今日已解锁畅玩一天！" : `已解锁 ${singleUnlock} 局（今日转发 ${result.state.shareCount}/${dayPassThreshold} 次可畅玩一天）`);
      onUnlocked(result.state);
    };
    const runAd = () => {
      if (unlocking) return;
      unlocking = true;
      rewardedAd.show({
        onReward: () => {
          const result = grantSingle("ad");
          toast(result.upgraded ? "今日已解锁畅玩一天！" : `已解锁 ${singleUnlock} 局（今日看满 ${dayPassThreshold} 个视频可畅玩一天）`);
          onUnlocked(result.state);
        },
        // 视频失败/中途退出：只提示，停留在面板上让玩家换一种方式。
        onFail: (reason) => { toast(reason || "视频未完成"); unlocking = false; },
      });
    };

    const entries = [];
    if (shareEnabled) entries.push({ kind: "share", tier: "single", label: `转发给好友 · 解锁 ${singleUnlock} 局`, run: runShare });
    if (adOk) entries.push({ kind: "ad", tier: "single", label: `看个视频 · 解锁 ${singleUnlock} 局`, run: runAd });
    if (shareEnabled) entries.push({ kind: "share", tier: "day", label: `转发满 ${dayPassThreshold} 次 · 畅玩一天（今日 ${state.shareCount}/${dayPassThreshold}）`, run: runShare });
    if (adOk) entries.push({ kind: "ad", tier: "day", label: `看满 ${dayPassThreshold} 个视频 · 畅玩一天（今日 ${state.adCount}/${dayPassThreshold}）`, run: runAd });

    if (!entries.length) {
      // 无可用解锁渠道（未配置广告位且关闭转发）：直接放行，绝不锁死玩家。
      onUnlocked(snapshot(state));
      return;
    }

    const payload = {
      title: "免费场次踢完啦",
      // 羊了个羊式双通道：转发或看视频任选其一，都可继续；取消则留在选队页。
      subtitle: `今日 ${freePerDay} 局免费已用完～转发给好友 或 看个小视频，任选一种继续踢`,
      entries,
      onCancel,
    };
    const presenter = opts.present;
    if (typeof presenter === "function") {
      try {
        if (presenter(payload) !== false) return;
      } catch (error) {
        console.warn("[play-gate] 自定义解锁面板异常，回落 ActionSheet", error && error.message || error);
      }
    }
    if (!wxApi || typeof wxApi.showActionSheet !== "function") { onUnlocked(snapshot(state)); return; }
    const open = () => wxApi.showActionSheet({
      alertText: `${payload.subtitle}：`,
      itemList: entries.map((entry) => entry.label),
      success: (res) => {
        const entry = entries[res.tapIndex];
        if (entry) entry.run();
        else onCancel();
      },
      fail: () => onCancel(),
    });
    try { open(); } catch (error) { onUnlocked(snapshot(state)); }
  }

  return { tryConsume, grantSingle, requestUnlock, state: () => snapshot(loadState()), enabled: () => enabled };
}

module.exports = { createPlayGate, STORAGE_KEY };
