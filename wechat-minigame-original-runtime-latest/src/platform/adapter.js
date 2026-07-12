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
  // wx.createImage() 的 src 是数据属性（非访问器），直接 defineProperty 覆盖会让原生加载失效。
  // 改为：每次 set 时先删除访问器→原生赋值触发加载→再重装访问器，保证读返回规范化的 currentSrc。
  const installSrcAccessor = () => {
    Object.defineProperty(img, "src", {
      configurable: true,
      enumerable: true,
      get() { return currentSrc; },
      set(value) {
        currentSrc = normalizeAssetPath(value);
        img.fakeSrc = publicUrlForLocalPath(currentSrc);
        try {
          delete img.src;                 // 移除访问器，恢复原生数据属性
          img.src = currentSrc;           // 原生赋值 → 触发 wx 图片加载 → onload
        } catch (err) {
          setTimeout(() => fire("error"), 0);
        } finally {
          installSrcAccessor();           // 重新装回访问器
        }
      },
    });
  };
  installSrcAccessor();
  const oldOnload = img.onload;
  const oldOnerror = img.onerror;
  img.onload = function onload(event) {
    if (typeof oldOnload === "function") oldOnload.call(img, event);
    // 这里已经是原生 onload 回调；只通知 addEventListener 监听器。
    // 如果再次读取并调用 img.onload，会形成 onload -> fire -> onload 的无限递归。
    fire("load", false);
  };
  img.onerror = function onerror(event) {
    if (typeof oldOnerror === "function") oldOnerror.call(img, event);
    fire("error", false);
  };
  safeSetGlobal(img, "setAttribute", function setAttribute(name, value) {
    if (name === "src") img.src = value;
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
  // 并调用 ctx.listener.setOrientation(...) 等。用 no-op 实现，音频静默不影响渲染。
  if (!global.AudioContext) {
    function makeAudioParam() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }; }
    function makeAudioNode() {
      return {
        connect() { return this; }, disconnect() {},
        gain: makeAudioParam(), frequency: makeAudioParam(), playbackRate: makeAudioParam(), Q: makeAudioParam(),
        start() {}, stop() {}, noteOn() {}, noteOff() {}, buffer: null, loop: false, loopStart: 0, loopEnd: 0, detune: 0,
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
      createDynamicsCompressor() { return makeAudioNode(); }
      createAnalyser() { return Object.assign(makeAudioNode(), { getByteFrequencyData() {}, getFloatFrequencyData() {} }); }
      createBuffer(channels, length) { return { numberOfChannels: channels || 1, length: length || 0, sampleRate: 44100, getChannelData() { return new Float32Array(length || 0); }, duration: 0 }; }
      decodeAudioData() { return Promise.resolve(this.createBuffer(1, 1, 44100)); }
      resume() { this.state = "running"; return Promise.resolve(); }
      suspend() { this.state = "suspended"; return Promise.resolve(); }
      close() { this.state = "closed"; return Promise.resolve(); }
    }
    global.AudioContext = MiniAudioContext;
    global.webkitAudioContext = MiniAudioContext;
    global.OfflineAudioContext = MiniAudioContext;
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

  return { canvas: screenCanvas, fs, info, window: runtimeWindow, resolvePath: normalizeAssetPath };
}

module.exports = {
  installMiniWindow,
  normalizeAssetPath,
};
