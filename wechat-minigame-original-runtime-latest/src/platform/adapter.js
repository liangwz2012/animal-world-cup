const RUNTIME_ROOT = "runtime-assets";
const MATCH_RUNTIME_BASE = "/match-runtime-min";

function noop() {}

function safeSetGlobal(target, key, value) {
  try {
    target[key] = value;
    return target[key];
  } catch (e) {
    try {
      Object.defineProperty(target, key, {
        value,
        writable: true,
        configurable: true,
      });
      return target[key];
    } catch (defineError) {
      try {
        return target[key];
      } catch (readError) {
        return value;
      }
    }
  }
}

function safeObjectGlobal(target, key, fallback) {
  let current = null;
  try {
    current = target[key];
  } catch (e) {}
  if (current && (typeof current === "object" || typeof current === "function")) return current;
  safeSetGlobal(target, key, fallback);
  try {
    current = target[key];
  } catch (e) {}
  return current && (typeof current === "object" || typeof current === "function") ? current : fallback;
}

function makeLocation(initial) {
  const location = {
    href: initial.href,
    search: initial.search,
    origin: initial.origin,
    pathname: initial.pathname,
    hash: "",
    assign(url) { this.href = String(url || ""); },
    replace(url) { this.href = String(url || ""); },
    reload() {},
    toString() { return this.href; },
  };
  return location;
}

function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const code = (((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return out;
}

function utf8Encode(text) {
  const out = [];
  const s = String(text == null ? "" : text);
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (n - 0xdc00);
        i += 1;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function installBase64(global) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  if (!global.atob) {
    global.atob = function atobMini(input) {
      let str = String(input).replace(/=+$/, "");
      let output = "";
      for (let bc = 0, bs = 0, buffer, i = 0; (buffer = str.charAt(i++));) {
        const idx = alphabet.indexOf(buffer);
        if (idx < 0) continue;
        bs = bc % 4 ? bs * 64 + idx : idx;
        if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
      }
      return output;
    };
  }
  if (!global.btoa) {
    global.btoa = function btoaMini(input) {
      let str = String(input);
      let output = "";
      for (let block = 0, charCode, i = 0, map = alphabet; str.charAt(i | 0) || ((map = "="), i % 1); output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))) {
        charCode = str.charCodeAt((i += 3 / 4));
        block = (block << 8) | charCode;
      }
      return output;
    };
  }
}

class MiniEventTarget {
  constructor() {
    this._listeners = {};
  }

  addEventListener(type, listener) {
    if (!listener) return;
    const list = this._listeners[type] || (this._listeners[type] = []);
    if (list.indexOf(listener) === -1) list.push(listener);
  }

  removeEventListener(type, listener) {
    const list = this._listeners[type];
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    if (!event || !event.type) return true;
    event.target = event.target || this;
    const handler = this[`on${event.type}`];
    if (typeof handler === "function") handler.call(this, event);
    const list = (this._listeners[event.type] || []).slice();
    for (const listener of list) listener.call(this, event);
    return !event.defaultPrevented;
  }
}

class MiniEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options && options.detail;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class MiniClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class MiniElement extends MiniEventTarget {
  constructor(tagName) {
    super();
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.classList = new MiniClassList();
    this.parentNode = null;
  }

  appendChild(child) {
    if (child) {
      this.children.push(child);
      try { child.parentNode = this; } catch (e) {}
      if (child.tagName === "SCRIPT" && child.src) setTimeout(() => child.dispatchEvent(new MiniEvent("load")), 0);
    }
    return child;
  }

  insertBefore(child) {
    return this.appendChild(child);
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    if (child) {
      try { child.parentNode = null; } catch (e) {}
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  getContext(type, options) {
    if (this._wxCanvas && this._wxCanvas.getContext) return this._wxCanvas.getContext(type, options);
    return null;
  }

  // 设置实际的微信 canvas
  setWxCanvas(wxCanvas) {
    this._wxCanvas = wxCanvas;
  }
}

class MiniBlob {
  constructor(parts, options) {
    this.parts = parts || [];
    this.type = (options && options.type) || "";
    this._text = this.parts.map((part) => {
      if (typeof part === "string") return part;
      if (part instanceof Uint8Array) return utf8Decode(part);
      if (part && part.buffer instanceof ArrayBuffer) return utf8Decode(new Uint8Array(part.buffer));
      return String(part == null ? "" : part);
    }).join("");
  }
}

function makeStorage() {
  const store = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { for (const key of Object.keys(store)) delete store[key]; },
  };
}

function normalizeAssetPath(input) {
  let path = String(input || "").replace(/\\/g, "/").split("?")[0];
  if (path.indexOf("blob:minigame://") === 0) return path;
  if (/^https?:\/\//.test(path)) return path;
  path = path.replace(/^file:\/\//, "");
  while (path.startsWith("/")) path = path.slice(1);
  if (path.startsWith("match-runtime-min/")) return `${RUNTIME_ROOT}/${path}`;
  if (path.startsWith("animal-cup/")) return `${RUNTIME_ROOT}/${path}`;
  if (path.startsWith("app/match-runtime-min/")) return `${RUNTIME_ROOT}/${path.slice(4)}`;
  if (path.startsWith("app/animal-cup/")) return `${RUNTIME_ROOT}/${path.slice(4)}`;
  if (path.startsWith("data/") || path.startsWith("fonts/") || path.startsWith("images/") || path.startsWith("scripts/") || path.startsWith("styles/") || path.startsWith("vendor/")) {
    return `${RUNTIME_ROOT}/match-runtime-min/${path}`;
  }
  return path;
}

let runtimeTextAssetsLoaded = false;
let runtimeTextAssets = null;

function getRuntimeTextAssets() {
  if (runtimeTextAssetsLoaded) return runtimeTextAssets;
  runtimeTextAssetsLoaded = true;
  try {
    runtimeTextAssets = require("../../runtime-assets/runtime-text-assets");
  } catch (error) {
    console.error("[original-runtime-latest] runtime text index unavailable", error);
    runtimeTextAssets = null;
  }
  return runtimeTextAssets;
}

function readRuntimeTextAsset(path) {
  const assets = getRuntimeTextAssets();
  if (!assets) return null;
  const local = normalizeAssetPath(path);
  const candidates = [local, `/${local}`];
  if (local.startsWith(`${RUNTIME_ROOT}/`)) {
    const withoutRoot = local.slice(RUNTIME_ROOT.length);
    candidates.push(withoutRoot, withoutRoot.replace(/^\//, ""));
  }
  const matchIndex = local.indexOf("match-runtime-min/");
  if (matchIndex >= 0) {
    const matchKey = local.slice(matchIndex - 1 >= 0 && local[matchIndex - 1] === "/" ? matchIndex - 1 : matchIndex);
    candidates.push(matchKey, matchKey.startsWith("/") ? matchKey.slice(1) : `/${matchKey}`);
  }
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(assets, key)) return assets[key];
  }
  return null;
}

function publicUrlForLocalPath(localPath) {
  let path = String(localPath || "").replace(/\\/g, "/");
  if (path.startsWith(`${RUNTIME_ROOT}/match-runtime-min/`)) return MATCH_RUNTIME_BASE + path.slice(`${RUNTIME_ROOT}/match-runtime-min`.length);
  if (path.startsWith(`${RUNTIME_ROOT}/animal-cup/`)) return "/animal-cup/" + path.slice(`${RUNTIME_ROOT}/animal-cup/`.length);
  return path;
}

// 真机关键修复：把「分包内的本地图片文件路径」读成 base64 data URI 再交给 wx.createImage。
// 原因：真机上 wx.createImage() 直接加载分包文件路径时，onload 偶发永不触发 → 图片加载器
// 卡住（进度停在个位数）→ 90 秒后 B2 超时弹「引擎移植失败」。而 data URI 由 wx 直接解码，
// onload 稳定触发（关键指示器图集早已用此法内联）。这里把该做法推广到所有本地图片。
// DevTools 同样走 data URI，行为与真机一致，避免"模拟器正常、真机炸"的分叉。
const IMAGE_DATA_URI_CACHE = Object.create(null);
const IMAGE_DATA_URI_MAX_BYTES = 6 * 1024 * 1024; // 超大图不内联，避免主线程 base64 卡顿/内存尖峰
// 真机诊断计数：img 请求数、data URI 命中/未命中、load/error 送达数、探针补送数、
// 卡死数与最后一个卡死/未命中的路径。若资源仍卡加载页，这些数字会被并进 B2 超时
// 弹框，一张截图即可定位问题。
const IMG_STATS = {
  req: 0, dataUriHit: 0, dataUriMiss: 0,
  loaded: 0, failed: 0, rescued: 0, stuck: 0,
  lastSrc: "", lastMiss: "", lastStuck: "",
};
function localImageDataUri(localPath, wxApi) {
  const path = String(localPath || "");
  if (!path || /^data:/i.test(path) || /^https?:\/\//i.test(path) || path.indexOf("blob:") === 0) return null;
  if (Object.prototype.hasOwnProperty.call(IMAGE_DATA_URI_CACHE, path)) return IMAGE_DATA_URI_CACHE[path];
  const fs = wxApi && wxApi.getFileSystemManager ? wxApi.getFileSystemManager() : null;
  if (!fs || typeof fs.readFileSync !== "function") { IMAGE_DATA_URI_CACHE[path] = null; return null; }
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].indexOf(ext) === -1) { IMAGE_DATA_URI_CACHE[path] = null; return null; }
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "webp" ? "image/webp"
    : ext === "gif" ? "image/gif"
    : ext === "bmp" ? "image/bmp"
    : "image/png";
  const candidates = [path, `/${path}`];
  for (const key of candidates) {
    try {
      if (typeof fs.statSync === "function") {
        try { const st = fs.statSync(key); const size = st && (st.size != null ? st.size : (st.stats && st.stats.size)); if (size != null && size > IMAGE_DATA_URI_MAX_BYTES) { IMAGE_DATA_URI_CACHE[path] = null; return null; } } catch (statErr) {}
      }
      const b64 = fs.readFileSync(key, "base64");
      if (b64) { const uri = `data:${mime};base64,${b64}`; IMAGE_DATA_URI_CACHE[path] = uri; return uri; }
    } catch (err) {}
  }
  IMAGE_DATA_URI_CACHE[path] = null;
  return null;
}

// ⛔ 真机根因（勿再回退到任何「拦截原生 src」的设计）：
// 真机上 wx.createImage() 的 src 是「原生数据属性」—— getOwnPropertyDescriptor 只能
// 看到 {value, writable}（没有可抓的 setter），但赋值其实由引擎内部的原生回调拦截以
// 触发图片加载。对它做 Object.defineProperty / delete 会把这个原生回调**永久摧毁**：
// 此后 img.src=xxx 只是写一个普通 JS 属性，加载永远不会开始，onload/onerror 都不
// 触发（静默卡死）—— 正是「真机全部图片不显示 + 加载停在个位数 + B2 超时弹 FATAL、
// 而 DevTools 一切正常」的元凶（DevTools 里 src 是 HTMLImageElement 原型上的访问器，
// 怎么折腾实例都不影响，故 bug 只在真机复现）。
// 修复原则：**永不触碰原生 src 属性描述符**。路径归一化 / data URI 转换放进全新的
// __acSrc 访问器（添加新属性是安全的），最终用普通赋值 img.src=最终值 交给原生。
// 构建期会把打包产物里的所有 `.src=` 赋值改写为 `.__acSrc=`（见 tools/build.mjs），
// 非图片对象则由 Object.prototype 上的 __acSrc 兜底访问器原样转发回 .src。
function installAcSrcFallback() {
  try {
    if (Object.getOwnPropertyDescriptor(Object.prototype, "__acSrc")) return;
    Object.defineProperty(Object.prototype, "__acSrc", {
      configurable: true,
      enumerable: false,
      get() { return this.src; },
      set(value) { this.src = value; },
    });
  } catch (err) {}
}

function patchImage(img, global) {
  if (!img || img.__animalCupPatched) return img;
  safeSetGlobal(img, "__animalCupPatched", true);
  const listeners = {};
  safeSetGlobal(img, "addEventListener", function addEventListener(type, cb) {
    if (!cb) return;
    (listeners[type] || (listeners[type] = [])).push(cb);
  });
  safeSetGlobal(img, "removeEventListener", function removeEventListener(type, cb) {
    const list = listeners[type];
    if (!list) return;
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  });
  const fire = (type, includePropertyHandler = true) => {
    const event = new MiniEvent(type);
    event.target = img;
    if (includePropertyHandler) {
      const handler = img[`on${type}`];
      if (typeof handler === "function") handler.call(img, event);
    }
    for (const cb of (listeners[type] || []).slice()) cb.call(img, event);
  };
  let currentSrc = "";
  let settled = true;    // 当前这次 src 赋值的 load/error 是否已送达
  let probeToken = 0;

  const markSettled = (isLoad) => {
    if (settled) return;
    settled = true;
    if (isLoad) {
      IMG_STATS.loaded += 1;
      // 真机 wx image 没有 complete 属性，而 PIXI v4 依赖 source.complete 判定
      // 「图片已就绪」（loader 完成后再建 BaseTexture 时走立即可用捷径）。
      // 补一个普通属性 —— 添加新属性安全，不碰原生描述符；DevTools 里 complete
      // 是原型只读访问器，普通赋值静默无效，恰好不产生分叉。
      try { if (img.complete !== true) img.complete = true; } catch (err) {}
    } else {
      IMG_STATS.failed += 1;
    }
  };

  // 真机保险丝：万一 onload 事件丢失但图片其实已解码（width>0），手动补送 load。
  // PIXI 的 onload 处理器触发后会把 img.onload 置 null —— 因此「onload 仍是函数」
  // 即代表事件尚未送达，手动调用是安全的（本包装器与 PIXI 处理器都自带幂等保护）。
  const scheduleLoadProbe = () => {
    const token = ++probeToken;
    let ticks = 0;
    const check = () => {
      if (settled || token !== probeToken) return;
      const width = Number(img.naturalWidth || img.width) || 0;
      if (width > 0) {
        const handler = img.onload;
        if (typeof handler === "function") {
          IMG_STATS.rescued += 1;
          try { handler.call(img, { type: "load", target: img }); } catch (err) {}
          markSettled(true);   // handler 非本包装器时补记
        } else {
          settled = true;      // onload 已被消费方置 null → 事件其实已送达
        }
        return;
      }
      ticks += 1;
      if (ticks < 20) setTimeout(check, 600);
      else { IMG_STATS.stuck += 1; IMG_STATS.lastStuck = img.fakeSrc || currentSrc; }
    };
    setTimeout(check, 400);
  };

  const applySrc = (value) => {
    currentSrc = normalizeAssetPath(value);
    img.fakeSrc = publicUrlForLocalPath(currentSrc);
    // 本地图片一律读成 base64 data URI 再交给 wx：分包文件路径的解码时序在真机上
    // 不如 data URI 稳定；且 DevTools 同样走 data URI，行为与真机一致。
    let loadTarget = currentSrc;
    IMG_STATS.req += 1;
    IMG_STATS.lastSrc = currentSrc;
    const dataUri = localImageDataUri(currentSrc, global.wx);
    if (dataUri) { loadTarget = dataUri; IMG_STATS.dataUriHit += 1; }
    else if (currentSrc && !/^data:|^https?:\/\/|^blob:/i.test(currentSrc)) { IMG_STATS.dataUriMiss += 1; IMG_STATS.lastMiss = currentSrc; }
    settled = false;
    try {
      img.src = loadTarget;   // 普通赋值：原生属性从未被动过 → 真正触发 wx 加载
    } catch (err) {
      markSettled(false);
      setTimeout(() => fire("error"), 0);
      return;
    }
    scheduleLoadProbe();
  };
  try {
    Object.defineProperty(img, "__acSrc", {
      configurable: true,
      enumerable: false,
      get() { return currentSrc; },
      set: applySrc,
    });
  } catch (err) {
    // 极端环境定义失败：落回 Object.prototype 兜底（直写原生 src，不做归一化）。
  }
  const oldOnload = img.onload;
  const oldOnerror = img.onerror;
  img.onload = function onload(event) {
    markSettled(true);
    if (typeof oldOnload === "function") oldOnload.call(img, event);
    // 这里已经是原生 onload 回调；只通知 addEventListener 监听器。
    // 如果再次读取并调用 img.onload，会形成 onload -> fire -> onload 的无限递归。
    fire("load", false);
  };
  img.onerror = function onerror(event) {
    markSettled(false);
    if (typeof oldOnerror === "function") oldOnerror.call(img, event);
    fire("error", false);
  };
  safeSetGlobal(img, "setAttribute", function setAttribute(name, value) {
    if (name === "src") applySrc(value);
    else img[name] = value;
  });
  safeSetGlobal(img, "getAttribute", function getAttribute(name) {
    return name === "src" ? img.fakeSrc || img.src : img[name] || "";
  });
  if (!img.style) safeSetGlobal(img, "style", {});
  if (!img.dataset) safeSetGlobal(img, "dataset", {});
  if (!img.classList) safeSetGlobal(img, "classList", new MiniClassList());
  safeSetGlobal(img, "dispatchEvent", function dispatchEvent(event) {
    fire(event.type);
    return true;
  });
  global.__lastImage = img;
  return img;
}

function installTextCodec(global) {
  if (!global.TextEncoder) {
    global.TextEncoder = class TextEncoderMini {
      encode(text) {
        return utf8Encode(text);
      }
    };
  }
  if (!global.TextDecoder) {
    global.TextDecoder = class TextDecoderMini {
      decode(bytes) {
        if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
        return utf8Decode(bytes || new Uint8Array(0));
      }
    };
  }
}

function createXMLHttpRequest(global, fs) {
  return class MiniXMLHttpRequest extends MiniEventTarget {
    constructor() {
      super();
      this.method = "GET";
      this.url = "";
      this.async = true;
      this.status = 0;
      this.readyState = 0;
      this.responseText = "";
      this.response = null;
      this.responseType = "";
      this.headers = {};
    }

    open(method, url, async) {
      this.method = String(method || "GET").toUpperCase();
      this.url = String(url || "");
      this.async = async !== false;
      this.readyState = 1;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    send() {
      const done = (status, text, buffer) => {
        this.status = status;
        this.readyState = 4;
        this.responseText = text || "";
        if (this.responseType === "arraybuffer") this.response = buffer || utf8Encode(this.responseText).buffer;
        else if (this.responseType === "json") {
          try { this.response = JSON.parse(this.responseText); } catch { this.response = null; }
        } else this.response = this.responseText;
        this.dispatchEvent(new MiniEvent("readystatechange"));
        this.dispatchEvent(new MiniEvent("load"));
        this.dispatchEvent(new MiniEvent("loadend"));
      };

      const blob = global.__blobStore && global.__blobStore[this.url];
      if (blob) {
        done(200, blob._text);
        return;
      }

      if (/^https?:\/\//.test(this.url)) {
        if (!global.wx || !global.wx.request) {
          done(404, "");
          return;
        }
        global.wx.request({
          url: this.url,
          method: this.method,
          responseType: this.responseType === "arraybuffer" ? "arraybuffer" : "text",
          success: (res) => {
            const data = res.data instanceof ArrayBuffer ? utf8Decode(new Uint8Array(res.data)) : String(res.data == null ? "" : res.data);
            done(res.statusCode || 200, data, res.data);
          },
          fail: () => {
            this.status = 0;
            this.dispatchEvent(new MiniEvent("error"));
            this.dispatchEvent(new MiniEvent("loadend"));
          },
        });
        return;
      }

      const local = normalizeAssetPath(this.url);
      const bundledText = readRuntimeTextAsset(local);
      try {
        if (this.method === "HEAD") {
          if (bundledText != null) {
            done(200, "");
            return;
          }
          if (typeof fs.accessSync === "function") fs.accessSync(local);
          else fs.readFileSync(local);
          done(200, "");
          return;
        }
        if (bundledText != null) {
          const buffer = utf8Encode(bundledText).buffer;
          done(200, bundledText, buffer);
          return;
        }
        const encoding = this.responseType === "arraybuffer" ? undefined : "utf8";
        const data = fs.readFileSync(local, encoding);
        if (data instanceof ArrayBuffer) done(200, utf8Decode(new Uint8Array(data)), data);
        else done(200, String(data == null ? "" : data));
      } catch (err) {
        done(404, "");
      }
    }

    abort() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ""; }
  };
}

// ---- 浏览器 API 桩：match.rebuilt.js 在加载阶段就会用到这些，微信小游戏环境不提供 ----
function installBrowserApis(global, wxApi) {
  // Web Audio：运行时一加载就 `new (window.AudioContext||window.webkitAudioContext)()`，
  // 然后 ctx.listener.setOrientation(...)、createGain/createPanner、回调式 decodeAudioData。
  // 环境差异（真机曾因此卡 98% 弹 `createPanner is not a function` FATAL）：
  //   - DevTools：Chromium 完整原生 AudioContext；
  //   - 部分真机运行时：**会暴露全局 AudioContext 但不完整**（缺 PannerNode/listener 等）——
  //     所以绝不能用 `if (!global.AudioContext)` 一跳了之，必须逐实例验完整性；
  //   - 其余真机：完全没有，只有 wx.createWebAudioContext() 或什么都没有。
  // 策略（AudioContextShim 逐级降级，全部 try/catch，音频问题最多“没声”绝不打崩引导）：
  //   1) 环境自带 AudioContext：实例化后验完整性 —— 完整就原样返回（DevTools 零变化）；
  //      不完整就包装补缺（真实发声，PannerNode 用真实 GainNode 直通替代）；
  //   2) wx.createWebAudioContext()：包装补缺，真实发声；
  //   3) 静默全桩 —— 任何 create* 都有实现。
  {
    const NativeAudioContext = (typeof global.AudioContext === "function" && global.AudioContext)
      || (typeof global.webkitAudioContext === "function" && global.webkitAudioContext)
      || null;
    if (NativeAudioContext && NativeAudioContext.__animalCupAudioShim) {
      // 热重载等场景下已装过本 shim，跳过
    } else {
    function makeAudioParam() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }; }
    function makeAudioNode() {
      return {
        connect() { return this; }, disconnect() {},
        gain: makeAudioParam(), frequency: makeAudioParam(), playbackRate: makeAudioParam(), Q: makeAudioParam(), pan: makeAudioParam(), detune: 0,
        start() {}, stop() {}, noteOn() {}, noteOff() {}, buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        // PannerNode 形状（噪声容忍：字段可随意赋值，方法全 no-op）
        setPosition() {}, setOrientation() {}, setVelocity() {},
        panningModel: "HRTF", distanceModel: "inverse",
        refDistance: 1, maxDistance: 10000, rolloffFactor: 1,
        coneInnerAngle: 360, coneOuterAngle: 0, coneOuterGain: 0,
        onended: null, addEventListener() {}, removeEventListener() {},
      };
    }
    class MiniAudioContext {
      constructor() {
        this.state = "running";
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = makeAudioNode();
        // listener 上任意方法调用都 no-op
        this.listener = new Proxy({}, { get() { return () => {}; } });
      }
      createGain() { return makeAudioNode(); }
      createBufferSource() { return makeAudioNode(); }
      createOscillator() { return makeAudioNode(); }
      createPanner() { return makeAudioNode(); }
      createStereoPanner() { return makeAudioNode(); }
      createBiquadFilter() { return makeAudioNode(); }
      createDelay() { return Object.assign(makeAudioNode(), { delayTime: makeAudioParam() }); }
      createConvolver() { return makeAudioNode(); }
      createWaveShaper() { return Object.assign(makeAudioNode(), { curve: null, oversample: "none" }); }
      createChannelMerger() { return makeAudioNode(); }
      createChannelSplitter() { return makeAudioNode(); }
      createConstantSource() { return Object.assign(makeAudioNode(), { offset: makeAudioParam() }); }
      createScriptProcessor() { return Object.assign(makeAudioNode(), { onaudioprocess: null, bufferSize: 4096 }); }
      createMediaElementSource() { return makeAudioNode(); }
      createMediaStreamSource() { return makeAudioNode(); }
      createPeriodicWave() { return {}; }
      createDynamicsCompressor() { return makeAudioNode(); }
      createAnalyser() { return Object.assign(makeAudioNode(), { fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData() {}, getFloatFrequencyData() {}, getByteTimeDomainData() {} }); }
      createBuffer(channels, length) { return { numberOfChannels: channels || 1, length: length || 0, sampleRate: 44100, getChannelData() { return new Float32Array(length || 0); }, duration: 0 }; }
      // 引擎用回调式签名 decodeAudioData(data, success, error)；必须触发回调，否则
      // 音效永远停在“解码中”。静默桩给一个空 buffer 让流程走通。
      decodeAudioData(data, success, error) {
        const buffer = this.createBuffer(1, 1, 44100);
        if (typeof success === "function") setTimeout(() => { try { success(buffer); } catch (err) {} }, 0);
        return Promise.resolve(buffer);
      }
      resume() { this.state = "running"; return Promise.resolve(); }
      suspend() { this.state = "suspended"; return Promise.resolve(); }
      close() { this.state = "closed"; return Promise.resolve(); }
    }

    // 真机：包装 wx.createWebAudioContext()，输出真实声音。
    // ⛔ 设计前提（真机实测教训）：wx WebAudio 的原生绑定**不可信** —— 方法存在但可能
    // 对合法参数抛异常（已证实 BindingWXAudioListener.setOrientation 拒绝标准参数
    // (0,0,-1,0,1,0)；connect/start/AudioParam 均属同类风险面）。因此所有真实节点/
    // 参数/监听者一律套安全代理：方法调用吞掉一切异常、节点参数自动解包再传给原生、
    // 属性覆盖写入侧表兜底。音频问题最多“没声”，绝不允许把引导期打崩。
    function wrapRealAudioContext(real) {
      const audioWarn = (where, err) => {
        try { console.warn(`[original-runtime-latest] wx WebAudio ${where} 异常（已吞掉，音频降级）`, err && err.message || err); } catch (e) {}
      };
      // 传给原生前解包：安全代理 → 真实原生对象（原生 connect 只认原生节点）
      const unwrapAudioArg = (value) => {
        if (value && typeof value === "object") {
          let inner = null;
          try { inner = value.__acRealAudioNode; } catch (err) {}
          if (inner) return inner;
        }
        return value;
      };
      const isAudioParamLike = (value) => {
        try { return !!value && typeof value === "object" && typeof value.setValueAtTime === "function"; } catch (err) { return false; }
      };
      const isAudioNodeLike = (value) => {
        try { return !!value && typeof value === "object" && typeof value.connect === "function"; } catch (err) { return false; }
      };
      // AudioParam 安全代理：value 读写与调度方法全部 try/catch
      function safeParam(realParam) {
        return new Proxy({ __acRealAudioNode: realParam }, {
          get(target, key) {
            if (key === "__acRealAudioNode") return realParam;
            let value;
            try { value = realParam[key]; } catch (err) { return key === "value" ? 0 : noop; }
            if (typeof value === "function") {
              return function safeParamCall() {
                const args = Array.prototype.slice.call(arguments).map(unwrapAudioArg);
                try { return value.apply(realParam, args); } catch (err) { audioWarn(`AudioParam.${String(key)}()`, err); return undefined; }
              };
            }
            return value;
          },
          set(target, key, value) {
            try { realParam[key] = value; } catch (err) { audioWarn(`AudioParam.${String(key)}=`, err); }
            return true;
          },
        });
      }
      // 音频节点安全代理。代理目标是普通对象（侧表），避开原生对象的 Proxy 不变量限制：
      //   读：侧表覆盖优先（flat panner 的 setPosition 等），其次转发真实节点；
      //   写：先记侧表（保证之后一定读得回来），再尽力写真实节点（source.buffer 等要生效）；
      //   方法：参数解包 → 调用真实节点 → 异常吞掉（connect 失败返回原参数保持链式调用）。
      function safeNode(realNode) {
        if (!realNode || typeof realNode !== "object") return makeAudioNode();
        const overrides = { __acRealAudioNode: realNode };
        return new Proxy(overrides, {
          get(target, key) {
            if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
            let value;
            try { value = realNode[key]; } catch (err) { return noop; }
            if (typeof value === "function") {
              return function safeNodeCall() {
                const args = Array.prototype.slice.call(arguments).map(unwrapAudioArg);
                try {
                  const result = value.apply(realNode, args);
                  return isAudioNodeLike(result) ? safeNode(result) : result;
                } catch (err) {
                  audioWarn(`AudioNode.${String(key)}()`, err);
                  return key === "connect" ? arguments[0] : undefined;
                }
              };
            }
            if (isAudioParamLike(value)) return safeParam(value);
            return value;
          },
          set(target, key, value) {
            if (key !== "__acRealAudioNode") target[key] = value;   // 侧表兜底，读回必中
            try { realNode[key] = unwrapAudioArg(value); } catch (err) { audioWarn(`AudioNode.${String(key)}=`, err); }
            return true;
          },
        });
      }
      const makeFlatPanner = () => {
        let node = null;
        try { node = real.createGain(); } catch (err) { audioWarn("createGain(panner替身)", err); }
        if (!node) return makeAudioNode();
        // wx WebAudio 没有 PannerNode：用真实 GainNode 直通替代（不做空间化，正常出声）。
        // 3D 方法/属性写在安全代理的侧表上，不碰原生对象。
        const panner = safeNode(node);
        panner.setPosition = noop; panner.setOrientation = noop; panner.setVelocity = noop;
        panner.panningModel = "HRTF"; panner.distanceModel = "inverse";
        panner.refDistance = 1; panner.maxDistance = 10000; panner.rolloffFactor = 1;
        panner.coneInnerAngle = 360; panner.coneOuterAngle = 0; panner.coneOuterGain = 0;
        return panner;
      };
      // listener 绝不裸用：真机 wx 的 BindingWXAudioListener.setOrientation() 会对
      // **合法标准参数** (0,0,-1,0,1,0) 抛 "Property 'x,y,z' or 'upX,upY,upZ' invalid"。
      // 没有 PannerNode 的环境里听者朝向本来就无可闻效果，异常丢弃是无损的。
      const realListener = (() => {
        let inner = null;
        try { inner = real.listener || null; } catch (err) {}
        return new Proxy({}, {
          get(target, key) {
            let value = null;
            try { value = inner ? inner[key] : null; } catch (err) {}
            if (typeof value === "function") {
              return function safeListenerCall() {
                try { return value.apply(inner, arguments); } catch (err) { audioWarn(`listener.${String(key)}()`, err); return undefined; }
              };
            }
            if (value != null) return value;
            return noop;
          },
          set(target, key, value) {
            try { if (inner) inner[key] = value; } catch (err) {}
            return true;
          },
        });
      })();
      const wrapper = {
        listener: realListener,
        get destination() { try { return real.destination ? safeNode(real.destination) : makeAudioNode(); } catch (err) { return makeAudioNode(); } },
        get currentTime() { try { return real.currentTime || 0; } catch (err) { return 0; } },
        get sampleRate() { try { return real.sampleRate || 44100; } catch (err) { return 44100; } },
        get state() { try { return real.state || "running"; } catch (err) { return "running"; } },
        createPanner() {
          try { if (typeof real.createPanner === "function") return safeNode(real.createPanner()); } catch (err) { audioWarn("createPanner()", err); }
          return makeFlatPanner();
        },
        decodeAudioData(data, success, error) {
          let settled = false;
          const once = (fn) => (value) => {
            if (settled) return;
            settled = true;
            if (typeof fn === "function") { try { fn(value); } catch (err) {} }
          };
          const ok = once(success);
          const bad = once(error);
          try {
            const result = real.decodeAudioData(unwrapAudioArg(data), ok, bad);
            if (result && typeof result.then === "function") result.then(ok, bad);
            return result;
          } catch (err) { audioWarn("decodeAudioData()", err); bad(err); }
        },
        resume() { try { return real.resume ? real.resume() : Promise.resolve(); } catch (err) { return Promise.resolve(); } },
        suspend() { try { return real.suspend ? real.suspend() : Promise.resolve(); } catch (err) { return Promise.resolve(); } },
        close() { try { return real.close ? real.close() : Promise.resolve(); } catch (err) { return Promise.resolve(); } },
      };
      for (const name of [
        "createGain", "createBufferSource", "createOscillator", "createDynamicsCompressor",
        "createAnalyser", "createBiquadFilter", "createDelay", "createConvolver",
        "createWaveShaper", "createChannelMerger", "createChannelSplitter", "createStereoPanner",
        "createConstantSource", "createScriptProcessor", "createMediaElementSource",
        "createMediaStreamSource", "createPeriodicWave", "createBuffer",
      ]) {
        wrapper[name] = typeof real[name] === "function"
          ? function forwardAudioApi() {
            const args = Array.prototype.slice.call(arguments).map(unwrapAudioArg);
            let result = null;
            try { result = real[name].apply(real, args); } catch (err) { audioWarn(`${name}()`, err); return makeAudioNode(); }
            // createBuffer/createPeriodicWave 返回的不是节点，原样返回；节点才包安全代理
            return isAudioNodeLike(result) ? safeNode(result) : (result == null ? makeAudioNode() : result);
          }
          : function fallbackAudioApi() { return makeAudioNode(); };
      }
      return wrapper;
    }
    // 引擎音效播放的最小可用面：真实发声必须齐这些，否则宁可静默桩
    const isUsableAudioContext = (ctx) => {
      try {
        return !!ctx
          && typeof ctx.createGain === "function"
          && typeof ctx.createBufferSource === "function"
          && typeof ctx.decodeAudioData === "function"
          && !!ctx.destination;
      } catch (err) { return false; }
    };
    // 完整面：引擎直接调用的全部 API 都是原生实现，才允许“原样返回不包装”
    const isCompleteAudioContext = (ctx) => {
      try {
        return isUsableAudioContext(ctx)
          && typeof ctx.createPanner === "function"
          && !!ctx.listener
          && typeof ctx.listener.setOrientation === "function";
      } catch (err) { return false; }
    };
    const setAudioMode = (mode) => {
      safeSetGlobal(global, "__ANIMAL_AUDIO_MODE__", mode);
      console.info(`[original-runtime-latest] 音频模式: ${mode}`);
    };
    function AudioContextShim() {
      // 1) 环境自带 AudioContext（DevTools 完整；个别真机运行时不完整）
      if (NativeAudioContext) {
        let native = null;
        try { native = new NativeAudioContext(); } catch (err) {}
        if (isCompleteAudioContext(native)) { setAudioMode("native"); return native; }
        if (isUsableAudioContext(native)) { setAudioMode("native-wrapped"); return wrapRealAudioContext(native); }
      }
      // 2) wx WebAudio
      if (wxApi && typeof wxApi.createWebAudioContext === "function") {
        try {
          const real = wxApi.createWebAudioContext();
          if (isUsableAudioContext(real)) { setAudioMode("wx-webaudio"); return wrapRealAudioContext(real); }
        } catch (err) {
          console.warn("[original-runtime-latest] wx WebAudio 不可用，音频降级为静默", err && err.message || err);
        }
      }
      // 3) 静默全桩
      setAudioMode("silent-stub");
      return new MiniAudioContext();
    }
    AudioContextShim.__animalCupAudioShim = true;
    safeSetGlobal(global, "AudioContext", AudioContextShim);
    safeSetGlobal(global, "webkitAudioContext", AudioContextShim);
    if (!global.OfflineAudioContext) safeSetGlobal(global, "OfflineAudioContext", MiniAudioContext);
    }
  }

  // KeyboardEvent：运行时用到静态常量 DOM_KEY_LOCATION_*，以及构造器
  if (!global.KeyboardEvent) {
    class MiniKeyboardEvent extends MiniEvent {
      constructor(type, init) {
        super(type, init);
        init = init || {};
        this.code = init.code || "";
        this.key = init.key || "";
        this.keyCode = init.keyCode || 0;
        this.which = init.which || init.keyCode || 0;
        this.location = init.location != null ? init.location : MiniKeyboardEvent.DOM_KEY_LOCATION_STANDARD;
        this.repeat = !!init.repeat;
        this.ctrlKey = !!init.ctrlKey;
        this.shiftKey = !!init.shiftKey;
        this.altKey = !!init.altKey;
        this.metaKey = !!init.metaKey;
        this.isComposing = !!init.isComposing;
      }
    }
    MiniKeyboardEvent.DOM_KEY_LOCATION_STANDARD = 0;
    MiniKeyboardEvent.DOM_KEY_LOCATION_LEFT = 1;
    MiniKeyboardEvent.DOM_KEY_LOCATION_RIGHT = 2;
    MiniKeyboardEvent.DOM_KEY_LOCATION_NUMPAD = 3;
    global.KeyboardEvent = MiniKeyboardEvent;
  }

  // 鼠标 / 触摸 / 指针事件构造器
  if (!global.MouseEvent) {
    class MiniMouseEvent extends MiniEvent {
      constructor(type, init) {
        super(type, init);
        init = init || {};
        this.clientX = init.clientX || 0;
        this.clientY = init.clientY || 0;
        this.button = init.button || 0;
        this.buttons = init.buttons || 0;
      }
    }
    global.MouseEvent = MiniMouseEvent;
  }
  if (!global.TouchEvent) global.TouchEvent = class MiniTouchEvent extends MiniEvent { constructor(t, i) { super(t, i); this.touches = (i && i.touches) || []; this.changedTouches = (i && i.changedTouches) || []; } };
  if (!global.PointerEvent) global.PointerEvent = global.MouseEvent;
  if (!global.WheelEvent) global.WheelEvent = class MiniWheelEvent extends MiniEvent { constructor(t, i) { super(t, i); this.deltaX = 0; this.deltaY = 0; this.deltaZ = 0; } };

  // HTMLAudioElement / Audio 构造器：`new Audio` 在 match.rebuilt.js 加载期出现
  if (!global.Audio) {
    class MiniAudio extends MiniEventTarget {
      constructor(src) {
        super();
        this._srcVal = "";
        this.currentTime = 0;
        this.duration = 0;
        this.paused = true;
        this.volume = 1;
        this.loop = false;
        this.muted = false;
        this.readyState = 0;
        this.playbackRate = 1;
        // 尝试用微信音频，失败则静默
        try {
          if (wxApi && wxApi.createInnerAudioContext) this._inner = wxApi.createInnerAudioContext();
        } catch (e) {}
        if (src) this.src = src;
      }
      play() { this.paused = false; if (this._inner) { try { this._inner.play(); } catch (e) {} } return Promise.resolve(); }
      pause() { this.paused = true; if (this._inner) { try { this._inner.pause(); } catch (e) {} } }
      load() {}
      canPlayType() { return "maybe"; }
      set src(v) { this._srcVal = v; if (this._inner) { try { this._inner.src = normalizeAssetPath(v); } catch (e) {} } }
      get src() { return this._srcVal || ""; }
    }
    global.Audio = MiniAudio;
    global.HTMLAudioElement = global.HTMLAudioElement || MiniAudio;
  }

  // DOMParser：运行时用来解析 XML/SVG，返回最小化文档即可
  if (!global.DOMParser) {
    class MiniDOMParser {
      parseFromString(text) {
        const doc = new MiniElement("#document");
        doc.documentElement = new MiniElement("root");
        doc.getElementsByTagName = () => [];
        doc.querySelector = () => null;
        doc.querySelectorAll = () => [];
        doc.textContent = String(text || "");
        return doc;
      }
    }
    global.DOMParser = MiniDOMParser;
  }

  // WebGLRenderingContext：仅作特性检测 `if(!window.WebGLRenderingContext)return false`
  if (!global.WebGLRenderingContext) global.WebGLRenderingContext = function WebGLRenderingContextStub() {};

  // 防御性：部分代码可能读取这些
  if (!global.requestIdleCallback) global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining() { return 50; } }), 0);
  if (!global.cancelIdleCallback) global.cancelIdleCallback = clearTimeout;
  if (!global.getComputedStyle) global.getComputedStyle = () => ({ getPropertyValue() { return ""; }, length: 0 });
  if (!global.matchMedia) global.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
}

function installMiniWindow(options) {
  const wxApi = typeof wx !== "undefined" ? wx : null;
  const info = wxApi && wxApi.getSystemInfoSync ? wxApi.getSystemInfoSync() : { windowWidth: 1280, windowHeight: 720, pixelRatio: 1 };
  const rawW = info.windowWidth || info.screenWidth || 1280;
  const rawH = info.windowHeight || info.screenHeight || 720;
  const logicalWidth = Math.max(rawW, rawH);
  const logicalHeight = Math.min(rawW, rawH);
  const pixelRatio = Math.min(info.pixelRatio || 1, 3);
  const screenCanvas = options.canvas || (wxApi && wxApi.createCanvas ? wxApi.createCanvas() : null);
  const fs = wxApi && wxApi.getFileSystemManager ? wxApi.getFileSystemManager() : null;
  const global = globalThis;

  safeSetGlobal(global, "wx", wxApi);
  const runtimeWindow = safeObjectGlobal(global, "window", global);
  safeSetGlobal(global, "self", runtimeWindow || global);
  safeSetGlobal(global, "global", global);
  safeSetGlobal(global, "EventTarget", global.EventTarget || MiniEventTarget);
  safeSetGlobal(global, "Event", global.Event || MiniEvent);
  safeSetGlobal(global, "CustomEvent", global.CustomEvent || MiniEvent);
  // 小游戏的原生 EventTarget 会拒绝来自适配层/不同运行上下文的 Event 对象。
  // 原版游戏自己的业务事件因此使用独立总线；系统 error/resize 仍保留宿主实现。
  const animalCupEvents = new MiniEventTarget();
  safeSetGlobal(global, "__animalCupEvents", animalCupEvents);
  safeSetGlobal(global, "__animalCupCustomEvent", (type, options) => new MiniEvent(type, options));
  safeSetGlobal(global, "innerWidth", logicalWidth);
  safeSetGlobal(global, "innerHeight", logicalHeight);
  safeSetGlobal(global, "devicePixelRatio", pixelRatio);
  safeSetGlobal(global, "screen", { width: logicalWidth, height: logicalHeight });
  const navigator = safeObjectGlobal(global, "navigator", {});
  if (!navigator.userAgent) safeSetGlobal(navigator, "userAgent", "MicroMessenger MiniGame");
  if (!navigator.language) safeSetGlobal(navigator, "language", "zh-CN");
  safeSetGlobal(navigator, "maxTouchPoints", 5);
  // 原网页引擎的键盘/手柄模块会在每帧轮询该 API。微信真机没有浏览器
  // Gamepad API；返回空列表即可保持触摸控制主循环正常运行。
  if (typeof navigator.getGamepads !== "function") safeSetGlobal(navigator, "getGamepads", () => []);
  const miniLocation = makeLocation({
    href: "https://minigame.local/match?red=england&blue=brazil&play=1&touch=1",
    search: "?red=england&blue=brazil&play=1&touch=1",
    origin: "https://minigame.local",
    pathname: "/match",
  });
  safeSetGlobal(global, "__animalCupLocation", miniLocation);
  let existingLocation = null;
  try { existingLocation = global.location; } catch (e) {}
  if (!existingLocation || typeof existingLocation !== "object" || !existingLocation.href) {
    safeSetGlobal(global, "location", miniLocation);
  }
  safeSetGlobal(global, "localStorage", global.localStorage || makeStorage());
  safeSetGlobal(global, "sessionStorage", global.sessionStorage || makeStorage());
  safeSetGlobal(global, "performance", global.performance || { now: () => Date.now() });
  safeSetGlobal(global, "requestAnimationFrame", global.requestAnimationFrame || (wxApi && wxApi.requestAnimationFrame) || ((fn) => setTimeout(() => fn(global.performance.now()), 16)));
  safeSetGlobal(global, "cancelAnimationFrame", global.cancelAnimationFrame || (wxApi && wxApi.cancelAnimationFrame) || clearTimeout);
  const windowEvents = animalCupEvents;
  safeSetGlobal(global, "addEventListener", global.addEventListener || windowEvents.addEventListener.bind(windowEvents));
  safeSetGlobal(global, "removeEventListener", global.removeEventListener || windowEvents.removeEventListener.bind(windowEvents));
  safeSetGlobal(global, "dispatchEvent", global.dispatchEvent || windowEvents.dispatchEvent.bind(windowEvents));
  safeSetGlobal(global, "close", global.close || noop);

  installBase64(global);
  installTextCodec(global);
  installBrowserApis(global, wxApi);
  installAcSrcFallback();

  if (screenCanvas) {
    screenCanvas.width = logicalWidth * pixelRatio;
    screenCanvas.height = logicalHeight * pixelRatio;
    screenCanvas.style = screenCanvas.style || {};
    screenCanvas.style.width = `${logicalWidth}px`;
    screenCanvas.style.height = `${logicalHeight}px`;
  }

  global.__blobStore = global.__blobStore || {};
  global.Blob = global.Blob || MiniBlob;
  global.URL = global.URL || function URLMini(url) { this.href = String(url); };
  if (!global.URL.createObjectURL) {
    let blobId = 0;
    global.URL.createObjectURL = function createObjectURL(blob) {
      const url = `blob:minigame://${++blobId}`;
      global.__blobStore[url] = blob;
      return url;
    };
  }
  global.URL.revokeObjectURL = global.URL.revokeObjectURL || ((url) => { delete global.__blobStore[url]; });
  if (!global.URLSearchParams) {
    global.URLSearchParams = class URLSearchParamsMini {
      constructor(search) {
        this.map = {};
        String(search || "").replace(/^\?/, "").split("&").forEach((pair) => {
          if (!pair) return;
          const idx = pair.indexOf("=");
          const k = decodeURIComponent(idx >= 0 ? pair.slice(0, idx) : pair);
          const v = decodeURIComponent(idx >= 0 ? pair.slice(idx + 1) : "");
          this.map[k] = v;
        });
      }
      get(key) { return Object.prototype.hasOwnProperty.call(this.map, key) ? this.map[key] : null; }
      set(key, value) { this.map[key] = String(value); }
    };
  }

  // 只补 DOM 形状，不改写 getContext。PIXI 必须拿到微信原生 WebGL，
  // 旧项目用 Canvas2D 假装 WebGL，缺少 shader/texture/framebuffer 语义。
  function decorateWxCanvas(wxCanvas) {
    if (!wxCanvas || !wxCanvas.getContext) return wxCanvas;
    try { wxCanvas.tagName = "CANVAS"; } catch (e) {}
    try { wxCanvas.style = wxCanvas.style || {}; } catch (e) {}
    try { wxCanvas.dataset = wxCanvas.dataset || {}; } catch (e) {}
    try { wxCanvas.classList = wxCanvas.classList || new MiniClassList(); } catch (e) {}
    if (!wxCanvas.addEventListener) safeSetGlobal(wxCanvas, "addEventListener", noop);
    if (!wxCanvas.removeEventListener) safeSetGlobal(wxCanvas, "removeEventListener", noop);
    if (!wxCanvas.dispatchEvent) safeSetGlobal(wxCanvas, "dispatchEvent", noop);
    if (!wxCanvas.setAttribute) safeSetGlobal(wxCanvas, "setAttribute", function setAttribute(name, value) { this[name] = value; });
    if (!wxCanvas.getAttribute) safeSetGlobal(wxCanvas, "getAttribute", function getAttribute(name) { return this[name]; });
    if (!wxCanvas.getBoundingClientRect) {
      safeSetGlobal(wxCanvas, "getBoundingClientRect", function getBoundingClientRect() {
        return { left: 0, top: 0, width: global.innerWidth, height: global.innerHeight, right: global.innerWidth, bottom: global.innerHeight };
      });
    }
    return wxCanvas;
  }

  decorateWxCanvas(screenCanvas);

  const body = new MiniElement("body");
  const head = new MiniElement("head");
  const document = safeObjectGlobal(global, "document", {});
  const documentApi = {
    body,
    head,
    documentElement: new MiniElement("html"),
    readyState: "complete",
    createElement(tag) {
      const name = String(tag || "").toLowerCase();
      if (name === "canvas") {
        const canvas = wxApi && wxApi.createCanvas
          ? decorateWxCanvas(wxApi.createCanvas())
          : new MiniElement("canvas");
        return canvas;
      }
      if (name === "img" || name === "image") return patchImage(wxApi && wxApi.createImage ? wxApi.createImage() : new MiniElement("img"), global);
      return new MiniElement(name);
    },
    createTextNode(text) { return { textContent: String(text || "") }; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener: body.addEventListener.bind(body),
    removeEventListener: body.removeEventListener.bind(body),
    dispatchEvent: body.dispatchEvent.bind(body),
  };
  for (const key of Object.keys(documentApi)) safeSetGlobal(document, key, documentApi[key]);
  safeSetGlobal(global, "document", document);
  global.Element = global.Element || MiniElement;
  global.HTMLElement = global.HTMLElement || MiniElement;
  global.HTMLCanvasElement = global.HTMLCanvasElement || (screenCanvas && screenCanvas.constructor) || MiniElement;
  global.HTMLImageElement = global.HTMLImageElement || MiniElement;
  global.HTMLScriptElement = global.HTMLScriptElement || MiniElement;
  global.HTMLLinkElement = global.HTMLLinkElement || MiniElement;
  global.HTMLAudioElement = global.HTMLAudioElement || MiniElement;
  global.HTMLSourceElement = global.HTMLSourceElement || MiniElement;
  global.Image = function ImageMini() {
    return patchImage(wxApi && wxApi.createImage ? wxApi.createImage() : new MiniElement("img"), global);
  };

  if (fs) global.XMLHttpRequest = createXMLHttpRequest(global, fs);
  global.__animalCupResolvePath = normalizeAssetPath;
  global.__animalCupReadText = function readText(path) {
    const bundledText = readRuntimeTextAsset(path);
    if (bundledText != null) return bundledText;
    if (!fs) return "";
    return fs.readFileSync(normalizeAssetPath(path), "utf8");
  };
  global.__bundleReadText = function bundleReadText(path) {
    return readRuntimeTextAsset(path);
  };
  global.__animalCupScreenCanvas = screenCanvas;
  global.__bundleTextOnly = true;
  global.__wxMiniGameRuntime = true;
  global.__ANIMAL_IMG_STATS__ = IMG_STATS;

  return { canvas: screenCanvas, fs, info, window: runtimeWindow, resolvePath: normalizeAssetPath };
}

module.exports = {
  installMiniWindow,
  normalizeAssetPath,
};
