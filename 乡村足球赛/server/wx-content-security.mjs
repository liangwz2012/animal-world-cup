import { ProtocolError } from "./protocol.mjs";

export function createWxTextSecurityChecker(options = {}) {
  const appId = String(options.appId || process.env.WX_APP_ID || "");
  const appSecret = String(options.appSecret || process.env.WX_APP_SECRET || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const tokenEndpoint = options.tokenEndpoint || "https://api.weixin.qq.com/cgi-bin/token";
  const checkEndpoint = options.checkEndpoint || "https://api.weixin.qq.com/wxa/msg_sec_check";
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 5000));
  let cachedToken = "";
  let tokenExpiresAt = 0;

  async function fetchJson(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new ProtocolError("CONTENT_CHECK_UPSTREAM", `微信内容安全服务返回 HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (error?.name === "AbortError") throw new ProtocolError("CONTENT_CHECK_TIMEOUT", "微信内容安全检查超时");
      throw new ProtocolError("CONTENT_CHECK_UPSTREAM", "无法连接微信内容安全服务");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function accessToken() {
    const now = Date.now();
    if (cachedToken && tokenExpiresAt > now + 60_000) return cachedToken;
    const url = new URL(tokenEndpoint);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", appId);
    url.searchParams.set("secret", appSecret);
    const data = await fetchJson(url, { method: "GET" });
    if (!data?.access_token) throw new ProtocolError("CONTENT_CHECK_AUTH", `微信内容安全凭证获取失败（${data?.errcode || "missing_token"}）`);
    cachedToken = String(data.access_token);
    tokenExpiresAt = now + Math.max(300, Number(data.expires_in || 7200) - 120) * 1000;
    return cachedToken;
  }

  const check = async ({ content, openid }) => {
    if (!check.available) throw new ProtocolError("CONTENT_CHECK_CONFIG_MISSING", "用户文本安全检查尚未配置");
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new ProtocolError("INVALID_USER_TEXT", "待检查文本不能为空");
    const token = await accessToken();
    const url = new URL(checkEndpoint);
    url.searchParams.set("access_token", token);
    const data = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, version: 2, scene: 2, openid: String(openid || "") }),
    });
    if (data?.errcode) throw new ProtocolError("CONTENT_CHECK_REJECTED", `用户文本安全检查失败（${data.errcode}）`);
    if (data?.result?.suggest !== "pass") throw new ProtocolError("CONTENT_CHECK_REJECTED", "用户文本未通过内容安全检查");
    return true;
  };
  check.available = !!appId && !!appSecret && typeof fetchImpl === "function";
  return check;
}
