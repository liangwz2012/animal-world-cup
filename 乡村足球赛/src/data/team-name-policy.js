"use strict";

const MIN_CUSTOM_TEAM_NAME_LENGTH = 2;
const MAX_CUSTOM_TEAM_NAME_LENGTH = 6;
const ALLOWED_NAME = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9·]+$/u;
const CONTACT_OR_LINK = /(?:https?:\/\/|www\.|\.com\b|\.cn\b|微信|微\s*信|v\s*x|q\s*q|群号|手机号|电话)/iu;
const IMPERSONATION = /(?:官方|国家队|中国队|微信|腾讯|公安|政府|法院|检察院)/u;

function normalizeTeamNameDraft(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    // 输入框里常见的“<一队>”“（青年队）”只是备注式装饰；去掉括号后仍按
    // 严格的队名白名单校验，既避免无意义的拒绝，也不会放开特殊字符。
    .replace(/[<>《》()（）\[\]【】{}]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function validateCustomTeamName(value, options = {}) {
  const normalized = normalizeTeamNameDraft(value);
  if (!normalized && options.allowEmpty) return { ok: true, value: "", code: "EMPTY" };
  const length = Array.from(normalized).length;
  if (length < MIN_CUSTOM_TEAM_NAME_LENGTH || length > MAX_CUSTOM_TEAM_NAME_LENGTH) {
    return {
      ok: false,
      value: normalized,
      code: "TEAM_NAME_LENGTH",
      message: `自定义队名需为 ${MIN_CUSTOM_TEAM_NAME_LENGTH}—${MAX_CUSTOM_TEAM_NAME_LENGTH} 个字`,
    };
  }
  if (!ALLOWED_NAME.test(normalized)) {
    return {
      ok: false,
      value: normalized,
      code: "TEAM_NAME_CHARACTERS",
      message: "队名只支持汉字、字母、数字和间隔点",
    };
  }
  if (CONTACT_OR_LINK.test(normalized)) {
    return { ok: false, value: normalized, code: "TEAM_NAME_CONTACT", message: "队名不能包含链接或联系方式" };
  }
  if (IMPERSONATION.test(normalized)) {
    return { ok: false, value: normalized, code: "TEAM_NAME_IMPERSONATION", message: "队名不能冒充官方或公共机构" };
  }
  if (/([A-Za-z0-9\u3400-\u9fff])\1{3,}/u.test(normalized)) {
    return { ok: false, value: normalized, code: "TEAM_NAME_REPEATED", message: "队名包含过多重复字符" };
  }
  return { ok: true, value: normalized, code: "LOCAL_PASS" };
}

module.exports = {
  ALLOWED_NAME,
  MAX_CUSTOM_TEAM_NAME_LENGTH,
  MIN_CUSTOM_TEAM_NAME_LENGTH,
  normalizeTeamNameDraft,
  validateCustomTeamName,
};
