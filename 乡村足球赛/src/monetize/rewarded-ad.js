// 激励视频广告管理器：懒创建 + 预加载 + 「完整看完才发奖」。
// 所有 wx 调用都容错：未开通流量主 / 无广告位 / 加载失败时 available() 为 false，
// 入口自动隐藏，绝不阻塞游戏流程。
function createRewardedAd(options) {
  const wxApi = options.wxApi;
  const adUnitId = String(options.adUnitId || "");
  let ad = null;
  let broken = false;
  let pending = null; // { onReward, onFail } 当前这次展示的回调

  const supported = !!(wxApi && typeof wxApi.createRewardedVideoAd === "function" && adUnitId);

  function ensure() {
    if (ad || broken || !supported) return ad;
    try {
      ad = wxApi.createRewardedVideoAd({ adUnitId });
      if (ad && typeof ad.onError === "function") {
        ad.onError((error) => {
          console.warn("[rewarded-ad] 广告加载错误", error && (error.errMsg || error.errCode) || error);
          const current = pending;
          pending = null;
          if (current && current.onFail) current.onFail("广告暂时不可用，请稍后再试");
        });
      }
      if (ad && typeof ad.onClose === "function") {
        ad.onClose((result) => {
          const current = pending;
          pending = null;
          if (!current) return;
          // 完整观看（isEnded）才发放奖励；旧接口无 result 时按完成处理。
          const finished = result == null || result.isEnded === true;
          if (finished) current.onReward();
          else if (current.onFail) current.onFail("需要完整观看视频才能解锁");
        });
      }
    } catch (error) {
      broken = true;
      ad = null;
      console.warn("[rewarded-ad] 创建激励视频失败", error && error.message || error);
    }
    return ad;
  }

  return {
    available() {
      return supported && !broken;
    },
    show(callbacks) {
      const onReward = callbacks && callbacks.onReward || (() => {});
      const onFail = callbacks && callbacks.onFail || (() => {});
      const instance = ensure();
      if (!instance || typeof instance.show !== "function") {
        onFail("广告能力不可用");
        return;
      }
      pending = { onReward, onFail };
      const fail = (reason) => {
        pending = null;
        onFail(reason || "广告暂时不可用，请稍后再试");
      };
      try {
        const shown = instance.show();
        if (shown && typeof shown.catch === "function") {
          shown.catch(() => {
            // 首次 show 失败通常是未加载完成：load 后重试一次（官方推荐姿势）。
            try {
              const loaded = typeof instance.load === "function" ? instance.load() : null;
              if (loaded && typeof loaded.then === "function") {
                loaded.then(() => instance.show()).catch(() => fail());
              } else fail();
            } catch (error) { fail(); }
          });
        }
      } catch (error) { fail(); }
    },
  };
}

module.exports = { createRewardedAd };
