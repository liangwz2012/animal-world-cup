// 队长头像自拍/Q版生成尚未实现。云端配置只能在客户端完整交付并通过审核后
// 控制开放节奏，不能把一个未实现的入口远程点亮。
const CAPTAIN_AVATAR_CUSTOMIZATION_READY = false;

function captainAvatarCustomizationAvailable(feature) {
  const source = feature && typeof feature === "object" ? feature : {};
  return CAPTAIN_AVATAR_CUSTOMIZATION_READY
    && source.enabled === true
    && typeof source.apiUrl === "string"
    && /^https:\/\//i.test(source.apiUrl);
}

module.exports = {
  CAPTAIN_AVATAR_CUSTOMIZATION_READY,
  captainAvatarCustomizationAvailable,
};
