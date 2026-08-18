// 变现/场次解锁配置。上线前把 REWARDED_AD_UNIT_ID 换成微信公众平台
// 「流量主 → 广告位管理」签发的真实激励视频广告位 ID（形如 adunit-xxxx）。
// 未配置时视频类解锁选项自动隐藏，不影响提审。
//
// 首发默认无限畅玩。后续只允许由已登记的云端配置开启真实激励广告；
// 不使用“转发解锁”，避免任何强制或诱导分享风险。
module.exports = {
  PLAY_GATE_ENABLED: false,       // 总开关：false = 无限畅玩（首发默认）
  FREE_MATCHES_PER_DAY: 2,        // 每天免费场次
  SINGLE_UNLOCK_MATCHES: 1,       // 单次转发/单次视频解锁的场次数
  DAY_PASS_THRESHOLD: 5,          // 当日累计 5 次（转发或视频各自计数）→ 解锁全天
  SHARE_UNLOCK_ENABLED: false,    // 永不以转发作为解锁路径
  AD_UNLOCK_ENABLED: false,       // 仅在云端配置真实广告位后开启
  REWARDED_AD_UNIT_ID: "",        // 激励视频广告位 ID，空 = 隐藏视频选项
  SHARE_TITLE: "乡村足球赛开踢！来代表你的家乡踢一场",
};
