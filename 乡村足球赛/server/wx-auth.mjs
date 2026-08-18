import { ProtocolError } from "./protocol.mjs";

const CODE_PATTERN = /^[A-Za-z0-9_-]{6,256}$/;

export function createWxCodeVerifier(options = {}) {
  const appId = String(options.appId || process.env.WX_APP_ID || "");
  const appSecret = String(options.appSecret || process.env.WX_APP_SECRET || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = options.endpoint || "https://api.weixin.qq.com/sns/jscode2session";

  return async function verifyWxCode(code) {
    if (!appId || !appSecret) {
      throw new ProtocolError("AUTH_CONFIG_MISSING", "服务端尚未配置微信 AppID 和 AppSecret");
    }
    if (typeof fetchImpl !== "function") {
      throw new ProtocolError("AUTH_UNAVAILABLE", "当前 Node 运行环境不支持微信登录校验请求");
    }
    if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
      throw new ProtocolError("AUTH_INVALID_CODE", "wx.login code 格式错误");
    }

    const url = new URL(endpoint);
    url.searchParams.set("appid", appId);
    url.searchParams.set("secret", appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 5000));
    timeout.unref?.();
    try {
      const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
      if (!response.ok) throw new ProtocolError("AUTH_UPSTREAM_ERROR", `微信登录服务返回 HTTP ${response.status}`);
      const data = await response.json();
      if (data.errcode || !data.openid) {
        throw new ProtocolError("AUTH_REJECTED", `微信登录校验失败（${data.errcode || "missing_openid"}）`);
      }
      return { userId: String(data.openid), unionId: data.unionid ? String(data.unionid) : "" };
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (error?.name === "AbortError") throw new ProtocolError("AUTH_TIMEOUT", "微信登录校验超时");
      throw new ProtocolError("AUTH_UPSTREAM_ERROR", "无法连接微信登录服务");
    } finally {
      clearTimeout(timeout);
    }
  };
}
