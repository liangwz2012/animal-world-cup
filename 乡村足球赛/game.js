function reportBootstrapFatal(error) {
  const message = error && (error.message || error.errMsg) || String(error || "未知启动错误");
  try { console.error("[rural-football-bootstrap] FATAL", error && error.stack || message); } catch (logError) {}
  if (typeof wx !== "undefined" && wx.showModal) {
    wx.showModal({
      title: "乡村足球赛启动失败",
      content: `入口加载失败：${message}`.slice(0, 500),
      showCancel: false,
    });
  }
}

let reportFatal = reportBootstrapFatal;
try {
  // 先加载诊断模块，确保 app 顶层 require 或同步初始化失败也不会只剩黑屏。
  const boot = require("./src/boot/start");
  if (boot && typeof boot.reportFatal === "function") reportFatal = boot.reportFatal;
  const app = require("./src/app/main");
  const pending = app.startRuralFootballApp();
  if (pending && typeof pending.catch === "function") pending.catch(reportFatal);
} catch (error) {
  reportFatal(error);
}
