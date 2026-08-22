// 云端功能开关的单一读口。main.js 在每次应用远程配置后写入；玩法与界面模块
// 一律从这里读取，不各自缓存。配置未拉取或服务端不可用时全部为关闭/默认值，
// 单机游戏不受影响（失败关闭）。
let currentFeatures = null;
let currentAnnouncement = { text: "", level: "info" };
let currentMaintenance = { onlineBlocked: false, message: "", minClientVersion: "" };
let currentEvents = [];

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function setRemoteState(next) {
  const source = plainObject(next) ? next : {};
  currentFeatures = plainObject(source.features) ? source.features : null;
  if (plainObject(source.announcement)) {
    currentAnnouncement = {
      text: typeof source.announcement.text === "string" ? source.announcement.text : "",
      level: typeof source.announcement.level === "string" ? source.announcement.level : "info",
    };
  }
  if (plainObject(source.maintenance)) {
    currentMaintenance = {
      onlineBlocked: source.maintenance.onlineBlocked === true,
      message: typeof source.maintenance.message === "string" ? source.maintenance.message : "",
      minClientVersion: typeof source.maintenance.minClientVersion === "string" ? source.maintenance.minClientVersion : "",
    };
  }
  if (Array.isArray(source.events)) currentEvents = source.events;
}

// 升级模块统一形状 { enabled:boolean, ...参数 }；未配置时返回 null，调用方按关闭处理。
function features() {
  return currentFeatures;
}

function isEnabled(name) {
  const entry = currentFeatures && currentFeatures[name];
  return !!(entry && entry.enabled);
}

function getAnnouncement() {
  return currentAnnouncement;
}

function getMaintenance() {
  return currentMaintenance;
}

function getEvents() {
  return currentEvents;
}

module.exports = { setRemoteState, features, isEnabled, getAnnouncement, getMaintenance, getEvents };
