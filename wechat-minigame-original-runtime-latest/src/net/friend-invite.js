const FRIEND_PROTOCOL_VERSION = 1;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;

function normalizeInviteToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return INVITE_TOKEN_PATTERN.test(token) ? token : "";
}

function parseFriendInvite(launchOptions) {
  const query = launchOptions && launchOptions.query || {};
  const rawToken = query.invite;
  if (rawToken == null || rawToken === "") return { ok: false, reason: "missing" };

  const token = normalizeInviteToken(rawToken);
  if (!token) return { ok: false, reason: "invalid_token" };

  const version = Number(query.v);
  if (version !== FRIEND_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: "incompatible_version",
      token,
      version: Number.isFinite(version) ? version : null,
    };
  }

  return { ok: true, token, version };
}

function buildFriendInviteQuery(token) {
  const normalized = normalizeInviteToken(token);
  if (!normalized) throw new Error("好友邀请令牌格式无效");
  return `invite=${encodeURIComponent(normalized)}&v=${FRIEND_PROTOCOL_VERSION}`;
}

function sameInvite(left, right) {
  return !!left && !!right
    && left.ok === true
    && right.ok === true
    && left.version === right.version
    && left.token === right.token;
}

module.exports = {
  FRIEND_PROTOCOL_VERSION,
  INVITE_TOKEN_PATTERN,
  buildFriendInviteQuery,
  normalizeInviteToken,
  parseFriendInvite,
  sameInvite,
};
