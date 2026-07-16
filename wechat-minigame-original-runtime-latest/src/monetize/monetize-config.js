// 变现/场次解锁配置。上线前把 REWARDED_AD_UNIT_ID 换成微信公众平台
// 「流量主 → 广告位管理」签发的真实激励视频广告位 ID（形如 adunit-xxxx）。
// 未配置时视频类解锁选项自动隐藏，不影响提审。
//
// 合规定位（羊了个羊模式）：转发与看视频是**并列可选、互为替代**的双通道，
// 面板可随时取消，分享绝不是继续游戏的唯一路径 —— 这是与《运营规范》
// 「强制/诱导分享」红线拉开距离的关键。因此必须始终保证：
//   1) SHARE_UNLOCK_ENABLED 与 AD_UNLOCK_ENABLED 不允许出现「只剩转发」的组合
//      上线形态（广告位未配置时代码会自动隐藏视频项，此时转发独存 —— 广告位
//      开通前若要上线，建议临时把 PLAY_GATE_ENABLED 关掉）；
//   2) 文案只描述「任选其一」，不出现「必须转发/转发到不同群」等表述。
module.exports = {
  PLAY_GATE_ENABLED: true,        // 总开关：false = 无限畅玩（提审最稳）
  FREE_MATCHES_PER_DAY: 2,        // 每天免费场次
  SINGLE_UNLOCK_MATCHES: 1,       // 单次转发/单次视频解锁的场次数
  DAY_PASS_THRESHOLD: 5,          // 当日累计 5 次（转发或视频各自计数）→ 解锁全天
  SHARE_UNLOCK_ENABLED: true,     // 转发解锁开关（见上方合规提示）
  AD_UNLOCK_ENABLED: true,        // 激励视频解锁开关
  REWARDED_AD_UNIT_ID: "",        // 激励视频广告位 ID，空 = 隐藏视频选项
  SHARE_TITLE: "动物足球赛开踢！雄狮 VS 苍狼，来跟我踢一场",
};
