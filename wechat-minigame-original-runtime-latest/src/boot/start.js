const { installMiniWindow } = require("../platform/adapter");
const { installTouchInput } = require("../input/touch");
const { createMatchSyncBridge } = require("../net/match-sync");
const { createTouchControlsOverlay } = require("../ui/touch-controls");

const IDENTITY = "original-runtime-latest";
const CRITICAL_INDICATOR_ATLAS = "/match-runtime-min/images/indicators.json";
const CRITICAL_INDICATOR_IMAGE = "runtime-assets/match-runtime-min/images/indicators.png";
// 关键指示器图集 4.3KB，内联为主包内 base64 data URI。真机上分包文件路径经
// wx.createImage() 加载偶发 onload 永不触发 → 整局卡在加载页。改用主包内联 base64：
// 立即可用、无分包文件 I/O、data URI 解码后 onload 稳定触发。见 generated/critical-atlas.static.js。
let CRITICAL_INDICATOR_DATA_URI = null;
try {
  CRITICAL_INDICATOR_DATA_URI = require("../../generated/critical-atlas.static");
} catch (error) {
  CRITICAL_INDICATOR_DATA_URI = null;
}
// 真机偶发单张图片 onload 迟迟不触发。主路径已是主包内联 base64（不依赖分包文件 I/O），
// 分包文件路径仅作最后兜底——因此把它压到「单次尝试 + 短超时」，一旦不稳就快速降级为
// 空图集让比赛照常开场，绝不再让整局在加载页干等几十秒后弹 FATAL。
const CRITICAL_ATLAS_ATTEMPT_TIMEOUT_MS = 6000;
const CRITICAL_ATLAS_MAX_ATTEMPTS = 1;
let fatalReported = false;
let criticalIndicatorLoad = null;

function gameGlobal() {
  if (typeof GameGlobal !== "undefined") return GameGlobal;
  if (typeof globalThis !== "undefined") return globalThis;
  return {};
}

function bindMatchSyncState(root, inputHost, matchSync) {
  const targets = [];
  for (const target of [root, root && root.window, inputHost, inputHost && inputHost.window]) {
    if (target && !targets.includes(target)) targets.push(target);
  }
  for (const target of targets) {
    target.__ORIGINAL_RUNTIME_MATCH_SYNC__ = matchSync;
    target.__ORIGINAL_RUNTIME_SYNC_ROLE__ = matchSync.role;
    target.__ORIGINAL_RUNTIME_SYNC_SESSION_KIND__ = matchSync.sessionKind;
    target.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT_2__ = matchSync.remoteInput;
    target.__touchInput2 = matchSync.remoteInput;
    target.__acP2 = matchSync.acceptsRemoteInput();
  }
  const runtimeWindow = inputHost && inputHost.window
    || root && root.window
    || inputHost
    || root;
  const touch2Bound = !!runtimeWindow && runtimeWindow.__touchInput2 === matchSync.remoteInput;
  for (const target of targets) {
    target.__ORIGINAL_RUNTIME_TOUCH2_BINDING_OK__ = target.__touchInput2 === matchSync.remoteInput;
  }
  if (typeof globalThis !== "undefined") globalThis.__ORIGINAL_RUNTIME_TOUCH2_BINDING_OK__ = touch2Bound;
  return { runtimeWindow, targets, touch2Bound };
}

function setStage(stage, detail) {
  const root = gameGlobal();
  root.__ORIGINAL_RUNTIME_LATEST_STAGE__ = stage;
  root.__ORIGINAL_RUNTIME_LATEST_DETAIL__ = detail || "";
  console.info(`[original-runtime-latest] ${stage}`, detail || "");
}

function reportFatal(error) {
  const root = gameGlobal();
  let normalized;
  if (error instanceof Error) normalized = error;
  else if (error && typeof error === "object") {
    const message = error.message || error.errMsg || (() => {
      try { return JSON.stringify(error); } catch (jsonError) { return String(error); }
    })();
    normalized = new Error(message || "未知对象错误");
    if (error.stack) normalized.stack = error.stack;
  } else normalized = new Error(String(error));
  if (isRecoverableTextureCacheError(normalized)) {
    root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = normalized;
    setStage("B2_TEXTURE_CACHE_RECOVERY", normalized.message);
    console.warn("[original-runtime-latest] 关键纹理缓存失效，正在静默恢复", normalized.stack || normalized.message);
    const retry = root.__ORIGINAL_RUNTIME_RETRY_TEXTURE_BOOT__;
    if (typeof retry === "function" && retry()) return;
    // 这类问题来自原引擎的缓存时序，不再用阻塞式 wx.showModal 覆盖整个比赛。
    // 正常路径会在开赛前完成硬校验；这里仅是全局异常钩子的最后保险。
    root.__ORIGINAL_RUNTIME_ACTIVE__ = false;
    return;
  }
  if (fatalReported) {
    console.warn("[original-runtime-latest] 后续错误（保留首个 FATAL）", normalized.stack || normalized.message);
    return;
  }
  fatalReported = true;
  // 保留真正的失败阶段。此前先 setStage("FATAL") 再拼弹窗，所有错误都会只显示
  // FATAL，无法区分是资源分包、索引解析还是比赛首帧阶段的问题。
  const failedStage = root.__ORIGINAL_RUNTIME_LATEST_STAGE__ || "UNKNOWN";
  root.__ORIGINAL_RUNTIME_FAILED_STAGE__ = failedStage;
  root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = normalized;
  root.__ORIGINAL_RUNTIME_ACTIVE__ = false;
  setStage("FATAL", normalized.stack || normalized.message);
  if (typeof wx !== "undefined" && wx.hideLoading) wx.hideLoading();
  if (typeof wx !== "undefined" && wx.showModal) {
    wx.showModal({
      title: "原版引擎移植失败",
      // 附 build 号与音频模式：真机截图即可确认包版本与音频降级路径
      content: `[SRCFIX-10 音频:${root.__ANIMAL_AUDIO_MODE__ || "未初始化"}] ${failedStage}: ${normalized.message}`.slice(0, 500),
      showCancel: false,
    });
  }
}

function isRecoverableTextureCacheError(error) {
  const detail = error && `${error.message || ""}\n${error.stack || ""}` || String(error || "");
  return /frameId\s+["']?[^\n]+does not exist in the texture cache|Texture\.fromFrame|fromFrame\b[^\n]*texture cache/i.test(detail);
}

function loadRuntimeSubpackage(wxApi, onProgress) {
  if (!wxApi || !wxApi.loadSubpackage) return Promise.resolve();
  setStage("A1_SUBPACKAGE_LOADING");
  return new Promise((resolve, reject) => {
    const task = wxApi.loadSubpackage({
      // 分包别名必须与实际根目录一致。此前这里用 camelCase 别名，而根目录是
      // runtime-assets；部分开发者工具会把它缓存成一个不存在的 JS 模块，之后即使
      // 文件已经在磁盘上仍持续报 loadSubpackage:fail module not found。
      // 统一为目录名后，工具和真机都按同一个物理分包入口解析。
      name: "runtime-assets",
      success: resolve,
      fail: (result) => reject(new Error(`runtime-assets 分包加载失败: ${JSON.stringify(result || {})}`)),
    });
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate((result) => {
        const progress = result.progress || 0;
        gameGlobal().__ORIGINAL_RUNTIME_LATEST_PROGRESS__ = progress;
        if (typeof onProgress === "function") onProgress(progress);
      });
    }
  });
}

// 全局钩子（wx.onError / unhandledrejection / window.error）是最后的安全网，
// 会捕获整个运行期的所有异步错误。若无差别升级为阻塞式致命弹窗，切后台回前台
// 的 GL 上下文重建、音频/网络桩偶发 reject 等本可自恢复的错误，都会误杀一整局。
// 这里按阶段分级：比赛已可见运行后只记录不弹框；仍在引导阶段才当启动失败上报。
function reportBackgroundError(error) {
  const root = gameGlobal();
  const normalized = error instanceof Error
    ? error
    : new Error((error && (error.message || error.errMsg)) || String(error));
  // 音频类运行期错误一律非致命：真机 wx WebAudio 原生绑定存在参数校验 bug
  // （如 BindingWXAudioListener.setOrientation 拒绝合法参数）。音频问题最多
  // “没声”，绝不允许把一整局打崩。适配层已在源头兜住，这里是最后保险。
  if (/WXAudio|WebAudio|AudioListener|AudioParam|AudioNode|AudioContext/i.test(normalized.message || "")) {
    root.__ORIGINAL_RUNTIME_LAST_BACKGROUND_ERROR__ = normalized.message;
    console.warn("[original-runtime-latest] 音频运行期错误（已忽略，不中断比赛）", normalized.stack || normalized.message);
    return;
  }
  // 可恢复的纹理缓存错误交给 reportFatal 走静默重试（它本身不弹框）。
  if (isRecoverableTextureCacheError(normalized)) {
    reportFatal(normalized);
    return;
  }
  if (root.__ORIGINAL_RUNTIME_ACTIVE__ === true) {
    root.__ORIGINAL_RUNTIME_LAST_BACKGROUND_ERROR__ = normalized.message;
    console.warn("[original-runtime-latest] 运行期异步错误（已忽略，不中断比赛）", normalized.stack || normalized.message);
    return;
  }
  // 仍在引导阶段（比赛尚未可见）：视为启动失败。
  reportFatal(normalized);
}

function installGlobalFailureHooks(root) {
  if (root.__ORIGINAL_RUNTIME_LATEST_FAILURE_HOOKS__) return;
  root.__ORIGINAL_RUNTIME_LATEST_FAILURE_HOOKS__ = true;
  if (root.addEventListener) {
    root.addEventListener("error", (event) => reportBackgroundError(event && (event.error || event.message || event)));
    root.addEventListener("unhandledrejection", (event) => reportBackgroundError(event && (event.reason || event)));
  }
  if (typeof wx !== "undefined" && wx.onError) wx.onError((message) => reportBackgroundError(message));
  if (typeof wx !== "undefined" && wx.onUnhandledRejection) wx.onUnhandledRejection((event) => reportBackgroundError(event && event.reason));
}

function mirrorTouchTelemetry(root, inputHost) {
  const defaults = {
    __ORIGINAL_RUNTIME_TOUCH_EVENTS__: 0,
    __ORIGINAL_RUNTIME_LAST_TOUCH__: null,
    __ORIGINAL_RUNTIME_INPUT_SEEN__: false,
  };

  for (const key of Object.keys(defaults)) {
    try {
      if (root === inputHost) {
        // 开发者工具中 GameGlobal 可能就是 globalThis。此时 getter 若再读取
        // inputHost[key]，会变成读取自身并无限递归；同时覆盖热重载遗留的旧 getter。
        const descriptor = Object.getOwnPropertyDescriptor(root, key);
        const value = descriptor && "value" in descriptor
          ? descriptor.value
          : defaults[key];
        Object.defineProperty(root, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
      } else {
        Object.defineProperty(root, key, {
          configurable: true,
          get() { return inputHost[key]; },
          set(value) { inputHost[key] = value; },
        });
      }
    } catch (error) {
      console.warn(`[original-runtime-latest] 触控诊断镜像失败: ${key}`, error);
    }
  }
}

function resolveRuntimePixi(root, inputHost) {
  const candidates = [
    inputHost && inputHost.window,
    root && root.window,
    inputHost,
    root,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const direct = candidate.PIXI;
    if (direct && direct.Container && direct.Graphics) return direct;
    if (typeof candidate.require === "function") {
      try {
        const runtimePixi = candidate.require("pixi");
        if (runtimePixi && runtimePixi.Container && runtimePixi.Graphics) return runtimePixi;
      } catch (error) {}
    }
  }
  return null;
}

function detectPhysicalMobileDevice(wxApi) {
  if (!wxApi) return false;
  let info = null;
  try {
    if (typeof wxApi.getDeviceInfo === "function") info = wxApi.getDeviceInfo();
    else if (typeof wxApi.getSystemInfoSync === "function") info = wxApi.getSystemInfoSync();
  } catch (error) {}
  const platform = String(info && (info.platform || info.system) || "").toLowerCase();
  // 反转为白名单：只有明确是开发者工具时才走桌面高内存动态观众烘焙路径；
  // 其余一律按真机低内存降级（含平台名缺失/异常的定制安卓、鸿蒙 next 变体）。
  // 旧逻辑用移动端黑名单正则，异常平台名会被误判为桌面 → 在低端机上跑高内存
  // 观众烘焙导致卡死/崩溃，正是最该避免的路径。
  if (platform === "devtools") return false;
  return true;
}

function waitForBaseTexture(baseTexture, timeoutMs) {
  if (!baseTexture) return Promise.reject(new Error("关键图集没有创建 BaseTexture"));
  if (baseTexture.valid || baseTexture.hasLoaded) return Promise.resolve(baseTexture);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof baseTexture.off === "function") {
        baseTexture.off("loaded", onLoaded);
        baseTexture.off("error", onError);
      }
      if (error) reject(error);
      else resolve(baseTexture);
    };
    const onLoaded = () => finish();
    const onError = (event) => finish(new Error(`关键图集图片加载失败: ${event && (event.message || event.errMsg) || CRITICAL_INDICATOR_IMAGE}`));
    if (typeof baseTexture.once === "function") {
      baseTexture.once("loaded", onLoaded);
      baseTexture.once("error", onError);
    } else if (typeof baseTexture.on === "function") {
      baseTexture.on("loaded", onLoaded);
      baseTexture.on("error", onError);
    } else {
      finish(new Error("关键图集 BaseTexture 不支持加载事件"));
      return;
    }
    timer = setTimeout(() => finish(new Error(`关键图集加载超时: ${CRITICAL_INDICATOR_IMAGE}`)), timeoutMs || 12000);
  });
}

function textureCacheOf(PIXI) {
  return PIXI && PIXI.utils && PIXI.utils.TextureCache || {};
}

function registerCriticalTextureRestore(PIXI, targets, textures) {
  const addToCache = PIXI.Texture.addToCache || PIXI.Texture.addTextureToCache;
  if (typeof addToCache !== "function") throw new Error("Pixi 纹理缓存登记 API 不可用");
  const getCriticalTexture = (frameName) => {
    const texture = textures[frameName];
    if (!texture) throw new Error(`关键纹理不存在: ${frameName}`);
    addToCache.call(PIXI.Texture, texture, frameName);
    return texture;
  };
  const restore = () => {
    let restored = 0;
    for (const frameName of Object.keys(textures)) {
      getCriticalTexture(frameName);
      restored += 1;
    }
    if (!textureCacheOf(PIXI)["indicators/sight.png"]) {
      throw new Error('关键纹理登记失败: indicators/sight.png');
    }
    return restored;
  };
  for (const target of targets || []) {
    if (!target) continue;
    target.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__ = restore;
    target.__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__ = getCriticalTexture;
  }
  restore();
  return restore;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 清除关键图集在 Pixi 全局缓存里的记录。真机上一次失败的加载会残留一张
// 永不再触发 loaded 的“死” BaseTexture；不清掉它，后续每次 fromImage 都会
// 复用它并再次超时，于是本次会话会“经常”卡在加载页弹致命框。
function purgeCriticalAtlasCache(PIXI, staleBaseTexture) {
  try {
    const utils = PIXI && PIXI.utils;
    if (utils) {
      if (utils.BaseTextureCache) delete utils.BaseTextureCache[CRITICAL_INDICATOR_IMAGE];
      if (utils.TextureCache) delete utils.TextureCache[CRITICAL_INDICATOR_IMAGE];
    }
    if (staleBaseTexture && !staleBaseTexture.valid && typeof staleBaseTexture.destroy === "function") {
      staleBaseTexture.destroy();
    }
  } catch (error) {
    console.warn("[original-runtime-latest] 关键图集缓存清理失败", error && error.message || error);
  }
}

// 自建 Image 加载 base64 data URI：不依赖 PIXI 内部 loader，也不依赖分包文件路径。
// data URI 由 wx 直接解码，onload 稳定触发；解码后的图片元素交给 PIXI 构造 BaseTexture，
// 此时图片已 complete，PIXI 无需再等待任何加载事件。
function loadImageFromDataUri(dataUri, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ImageCtor = (typeof Image !== "undefined" && Image)
      || (typeof globalThis !== "undefined" && globalThis.Image)
      || (typeof window !== "undefined" && window.Image);
    if (typeof ImageCtor !== "function") {
      reject(new Error("关键图集内联加载失败：Image 构造函数不可用"));
      return;
    }
    let settled = false;
    const img = new ImageCtor();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(img);
    };
    const timer = setTimeout(
      () => finish(new Error(`关键图集内联加载超时（base64 data URI）`)),
      timeoutMs || CRITICAL_ATLAS_ATTEMPT_TIMEOUT_MS,
    );
    img.onload = () => finish();
    img.onerror = (event) => finish(new Error(`关键图集内联加载失败：${event && (event.message || event.errMsg) || "onerror"}`));
    img.src = dataUri;
  });
}

// 关键图集加载：优先用主包内联 base64（真机稳定），失败或缺失再回退到分包文件路径重试。
async function loadCriticalAtlasTexture(PIXI, options) {
  const maxAttempts = (options && options.maxAttempts) || CRITICAL_ATLAS_MAX_ATTEMPTS;
  const perAttemptTimeout = (options && options.timeoutMs) || CRITICAL_ATLAS_ATTEMPT_TIMEOUT_MS;

  // 首选路径：主包内联 base64 data URI，真机上不依赖分包文件 I/O。
  // 关键：微信 image 没有 .complete 属性，PIXI v4 无法据此判定“已加载”而会
  // 挂起等待一个已经触发过的 load 事件。因此把已解码的图片画进 wx canvas，
  // 再用 canvas（带 getContext）建 BaseTexture —— PIXI 判定为立即可用，绝不挂起。
  if (CRITICAL_INDICATOR_DATA_URI) {
    try {
      const image = await loadImageFromDataUri(CRITICAL_INDICATOR_DATA_URI, perAttemptTimeout);
      const width = image.width || 512;
      const height = image.height || 128;
      const wxApi = typeof wx !== "undefined" ? wx : null;
      let source = image;
      if (wxApi && typeof wxApi.createCanvas === "function") {
        const canvas = wxApi.createCanvas();
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        source = canvas;
      }
      const baseTexture = new PIXI.BaseTexture(source);
      // 双保险：显式标记已加载，防止个别环境未走 getContext 快路径。
      if (!baseTexture.hasLoaded) {
        baseTexture.hasLoaded = true;
        baseTexture.width = width;
        baseTexture.height = height;
        baseTexture.realWidth = width;
        baseTexture.realHeight = height;
        if (typeof baseTexture.emit === "function") baseTexture.emit("loaded", baseTexture);
      }
      const atlasTexture = new PIXI.Texture(baseTexture);
      console.info("[original-runtime-latest] 关键图集已通过主包内联 base64 加载", `${width}x${height}`);
      return atlasTexture;
    } catch (error) {
      console.warn(`[original-runtime-latest] 内联 base64 关键图集加载失败，回退到分包文件路径：${error && error.message || error}`);
    }
  }

  // 回退路径：分包文件路径 + 带缓存清除的多次重试。
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    purgeCriticalAtlasCache(PIXI);
    const atlasTexture = PIXI.Texture.fromImage(CRITICAL_INDICATOR_IMAGE);
    const baseTexture = atlasTexture && (atlasTexture.baseTexture || atlasTexture);
    try {
      await waitForBaseTexture(baseTexture, perAttemptTimeout);
      if (attempt > 1) {
        console.info(`[original-runtime-latest] 关键图集在第 ${attempt} 次重试后加载成功`);
      }
      return atlasTexture;
    } catch (error) {
      lastError = error;
      console.warn(`[original-runtime-latest] 关键图集第 ${attempt}/${maxAttempts} 次加载失败：${error && error.message || error}`);
      purgeCriticalAtlasCache(PIXI, baseTexture);
      if (attempt < maxAttempts) await delay(400 * attempt);
    }
  }
  throw lastError || new Error(`关键图集加载失败: ${CRITICAL_INDICATOR_IMAGE}`);
}

// 兜底：当所有真实加载路径都失败时，用 wx canvas 造一张有效的空图集（尺寸覆盖所有 frame）。
// canvas 自带 getContext → PIXI 判定为立即可用、绝不挂起。这样即使图集加载失败，
// 比赛也照常开场（指示器暂时透明），永远不再卡加载页弹 FATAL。
function createBlankAtlasTexture(PIXI, atlas) {
  let width = 2;
  let height = 2;
  const frames = (atlas && atlas.frames) || {};
  for (const frameName of Object.keys(frames)) {
    const descriptor = frames[frameName];
    const frame = descriptor && (descriptor.frame || descriptor);
    if (frame && Number.isFinite(frame.x) && Number.isFinite(frame.w)) width = Math.max(width, frame.x + frame.w);
    if (frame && Number.isFinite(frame.y) && Number.isFinite(frame.h)) height = Math.max(height, frame.y + frame.h);
  }
  const meta = atlas && atlas.meta && atlas.meta.size;
  if (meta && Number.isFinite(meta.w)) width = Math.max(width, meta.w);
  if (meta && Number.isFinite(meta.h)) height = Math.max(height, meta.h);
  width = Math.max(2, Math.ceil(width));
  height = Math.max(2, Math.ceil(height));

  const wxApi = typeof wx !== "undefined" ? wx : null;
  let source = null;
  if (wxApi && typeof wxApi.createCanvas === "function") {
    const canvas = wxApi.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    source = canvas;
  }
  const baseTexture = source ? new PIXI.BaseTexture(source) : new PIXI.BaseTexture();
  if (!baseTexture.hasLoaded) {
    baseTexture.hasLoaded = true;
    baseTexture.width = width;
    baseTexture.height = height;
    baseTexture.realWidth = width;
    baseTexture.realHeight = height;
    if (typeof baseTexture.emit === "function") baseTexture.emit("loaded", baseTexture);
  }
  return new PIXI.Texture(baseTexture);
}

async function ensureCriticalIndicatorTextures(PIXI, targets, options) {
  if (!PIXI || !PIXI.Texture || !PIXI.Rectangle) {
    throw new Error("关键图集预加载失败：Pixi Texture/Rectangle 不可用");
  }
  const existingRestore = (targets || []).map((target) => target && target.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__).find((value) => typeof value === "function");
  if (existingRestore && !(options && options.forceReload)) {
    existingRestore();
    return existingRestore;
  }
  if (criticalIndicatorLoad && !(options && options.forceReload)) return criticalIndicatorLoad;

  criticalIndicatorLoad = (async () => {
    const textAssets = require("../../runtime-assets/runtime-text-assets");
    const atlasSource = textAssets && textAssets[CRITICAL_INDICATOR_ATLAS];
    if (!atlasSource) throw new Error(`关键图集索引缺失: ${CRITICAL_INDICATOR_ATLAS}`);
    const atlas = JSON.parse(atlasSource);
    let atlasTexture;
    try {
      atlasTexture = await loadCriticalAtlasTexture(PIXI, options);
    } catch (error) {
      // 所有真实加载路径都失败：降级为空图集，让比赛照常开场而不是卡加载页弹 FATAL。
      console.warn("[original-runtime-latest] 关键图集全部加载路径失败，降级为空图集（比赛照常开场）", error && error.stack || error && error.message || error);
      atlasTexture = createBlankAtlasTexture(PIXI, atlas);
    }
    const baseTexture = atlasTexture && (atlasTexture.baseTexture || atlasTexture);

    const textures = {};
    for (const frameName of Object.keys(atlas.frames || {})) {
      const descriptor = atlas.frames[frameName];
      const frame = descriptor && (descriptor.frame || descriptor);
      if (!frame || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)
        || !Number.isFinite(frame.w) || !Number.isFinite(frame.h)) continue;
      textures[frameName] = new PIXI.Texture(
        baseTexture,
        new PIXI.Rectangle(frame.x, frame.y, frame.w, frame.h),
      );
    }
    if (!textures["indicators/sight.png"]) {
      throw new Error('关键图集定义缺失: indicators/sight.png');
    }
    const restore = registerCriticalTextureRestore(PIXI, targets, textures);
    console.info("[original-runtime-latest] 关键图集已硬预载", `frames=${Object.keys(textures).length}`);
    return restore;
  })().catch((error) => {
    criticalIndicatorLoad = null;
    throw error;
  });
  return criticalIndicatorLoad;
}

async function bootOriginalRuntime(options) {
  options = options || {};
  const root = gameGlobal();
  const wxApi = typeof wx !== "undefined" ? wx : null;
  root.__ORIGINAL_RUNTIME_LATEST__ = IDENTITY;
  root.__ORIGINAL_RUNTIME_ACTIVE__ = false;
  root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = null;
  fatalReported = false;
  setStage("A0_PLATFORM_INSTALL");

  const screenCanvas = typeof canvas !== "undefined" && canvas
    ? canvas
    : root.canvas;
  const platform = installMiniWindow({ canvas: screenCanvas });
  installGlobalFailureHooks(root);
  const inputHost = typeof globalThis !== "undefined" ? globalThis : root;
  const physicalDevice = detectPhysicalMobileDevice(wxApi);
  // 动态观众（视线跟球、进球欢呼）真机也开启 —— 引导链路已修复稳定（SRCFIX 系列），
  // 不再一刀切禁用。保底仍在：standalone 的 fans.load 12 秒超时会把该旗标置回 true
  // 并跳过观众继续开赛，低端机烘不动时比赛照常进行，只是没有观众。
  const mobileSafeFans = false;
  const deviceTargets = [root, root.window, inputHost, inputHost.window];
  for (const target of deviceTargets) {
    if (target) target.__ORIGINAL_RUNTIME_MOBILE_SAFE_FANS__ = mobileSafeFans;
  }
  console.info("[original-runtime-latest] DEVICE_PROFILE", physicalDevice ? "physical-mobile(dynamic-fans-on)" : "desktop-or-devtools");

  // Pixi 本身位于主包，可以在 9.77 MiB 资源分包下载前先绘制品牌加载页。
  const PIXIExport = require("../../generated/pixi.static");
  root.PIXI = PIXIExport && (PIXIExport.default || PIXIExport.PIXI) || PIXIExport;
  if (!root.PIXI || root.PIXI.VERSION !== "4.8.9") {
    throw new Error(`Pixi 运行时身份错误: ${root.PIXI && root.PIXI.VERSION}`);
  }
  if (typeof options.onPlatformReady === "function") {
    await options.onPlatformReady({
      root,
      inputHost,
      wxApi,
      canvas: platform.canvas,
      platform,
      PIXI: root.PIXI,
    });
  }

  const touchInput = installTouchInput(
    inputHost,
    wxApi,
    inputHost.innerWidth || root.innerWidth || 1280,
    inputHost.innerHeight || root.innerHeight || 720,
    platform.info && platform.info.safeArea,
  );
  inputHost.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT__ = touchInput;
  // 微信小游戏的 GameGlobal 与原版脚本闭包中的 window 可能不是同一对象。
  // 原版必须读取 inputHost.__touchInput；GameGlobal 这里只保留可观测镜像。
  root.__touchInput = touchInput;
  root.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT__ = touchInput;
  root.__ORIGINAL_RUNTIME_INJECT_TOUCH__ = inputHost.__ORIGINAL_RUNTIME_INJECT_TOUCH__;
  mirrorTouchTelemetry(root, inputHost);

  const matchSync = createMatchSyncBridge({ role: "off" });
  bindMatchSyncState(root, inputHost, matchSync);

  if (!options.onPlatformReady && wxApi && wxApi.showLoading) wxApi.showLoading({ title: "原版引擎加载中", mask: true });
  if (typeof options.onProgress === "function") options.onProgress(0);
  await loadRuntimeSubpackage(wxApi, options.onProgress);
  setStage("A2_STATIC_MODULES_LOADING");
  if (typeof options.onProgress === "function") options.onProgress(92);

  const swigExport = require("../../generated/swig.static");
  if (!root.swig) root.swig = swigExport && swigExport.default || swigExport;
  if (!root.swig || typeof root.swig.setDefaults !== "function") {
    throw new Error("Swig 静态运行时未正确注册");
  }
  require("../../generated/shim.static");
  require("../../generated/match.static");
  require("../../generated/standalone.static");
  // 开发者工具热重载可能复用上一版 standalone 模块，从而不会
  // 再执行模块顶层的 touchInput2 绑定。这里始终重新镜像；内核每帧
  // 都动态读 window.__touchInput2，因此对已缓存模块也能立即生效。
  const syncBinding = bindMatchSyncState(root, inputHost, matchSync);
  const runtimeWindow = syncBinding.runtimeWindow;
  matchSync.bindRuntime(runtimeWindow);
  inputHost.__matchZoom = inputHost.__matchZoom
    || inputHost.window && inputHost.window.__matchZoom
    || root.__matchZoom
    || root.window && root.window.__matchZoom;

  const runtimePixi = resolveRuntimePixi(root, inputHost) || root.PIXI;
  const criticalTextureTargets = [root, root.window, inputHost, inputHost.window];
  await ensureCriticalIndicatorTextures(runtimePixi, criticalTextureTargets);
  setStage("B1_CRITICAL_TEXTURES_READY", "indicators/sight.png");

  const touchBindingOK = typeof globalThis !== "undefined"
    && globalThis.__ORIGINAL_RUNTIME_TOUCH_BINDING_OK__ === true;
  root.__ORIGINAL_RUNTIME_TOUCH_BINDING_OK__ = touchBindingOK;
  if (!touchBindingOK) {
    throw new Error("B1 失败：原版 window.__touchInput 未绑定微信共享触控对象");
  }
  const touch2BindingOK = typeof globalThis !== "undefined"
    && globalThis.__ORIGINAL_RUNTIME_TOUCH2_BINDING_OK__ === true;
  root.__ORIGINAL_RUNTIME_TOUCH2_BINDING_OK__ = touch2BindingOK;
  if (!touch2BindingOK) {
    console.warn("[original-runtime-latest] B1_TOUCH2_DEGRADED：单机可继续，好友局将在开赛前拦截");
  }
  const playModeOK = typeof globalThis !== "undefined"
    && globalThis.__ORIGINAL_RUNTIME_PLAY_MODE_OK__ === true;
  root.__ORIGINAL_RUNTIME_PLAY_MODE_OK__ = playModeOK;
  if (!playModeOK) {
    throw new Error("B1 失败：原版比赛未进入单人操控模式");
  }

  const moduleCount = root.define && root.define._modules
    ? Object.keys(root.define._modules).length
    : root.__ORIGINAL_RUNTIME_MODULE_COUNT__ || 0;
  if (typeof root.__startStandaloneMatch !== "function") {
    throw new Error("B1 失败：原版 __startStandaloneMatch 未注册");
  }
  setStage("B1_MODULES_REGISTERED", `modules=${moduleCount}`);
  if (typeof options.onProgress === "function") options.onProgress(100);

  const runtimeEvents = root.__animalCupEvents || root;
  let currentMatchOptions = null;
  let startSequence = 0;
  let textureRecoveryAttempts = 0;
  let textureRecoveryPending = false;
  runtimeEvents.addEventListener("ab-match-started", (event) => {
    try {
      const game = root.__matchGame || inputHost.__matchGame;
      const runtimePixi = resolveRuntimePixi(root, inputHost);
      if (!runtimePixi) throw new Error("原版 AMD pixi 模块未暴露 Container/Graphics");
      console.info(
        "[original-runtime-latest] CONTROL_PIXI_RESOLVED",
        `version=${runtimePixi.VERSION}, Container=${typeof runtimePixi.Container}, Graphics=${typeof runtimePixi.Graphics}`,
      );
      const spectatorWarmup = currentMatchOptions
        && currentMatchOptions.syncRole === "guest"
        && currentMatchOptions.sessionKind === "warmup";
      const overlay = currentMatchOptions
        && (currentMatchOptions.mode === "watch" || spectatorWarmup)
        ? null
        : createTouchControlsOverlay({
          globalObject: inputHost,
          PIXI: runtimePixi,
          game,
          input: touchInput,
        });
      // match 模块首次 require("pixi") 时会主动删除 window.PIXI；覆盖层创建成功后
      // 再恢复运行时身份，避免宿主的全局属性行为影响传入的构造器对象。
      root.PIXI = runtimePixi;
      inputHost.PIXI = runtimePixi;
      root.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__ = overlay;
      root.__ORIGINAL_RUNTIME_CONTROLS_VISIBLE__ = !!overlay;
    } catch (error) {
      setStage("B2_CONTROLS_FAILED", error && (error.stack || error.message) || String(error));
      reportFatal(new Error(`B2 控制层失败：${error && error.message || error}`));
      return;
    }
    root.__ORIGINAL_RUNTIME_ACTIVE__ = true;
    textureRecoveryAttempts = 0;
    textureRecoveryPending = false;
    root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = null;
    root.__ORIGINAL_RUNTIME_LATEST_MATCH__ = event && event.detail || {};
    setStage("B2_VISIBLE_MATCH_STARTED", JSON.stringify(root.__ORIGINAL_RUNTIME_LATEST_MATCH__));
    if (wxApi && wxApi.hideLoading) wxApi.hideLoading();
    if (typeof options.onMatchStarted === "function") {
      options.onMatchStarted(event && event.detail || {}, currentMatchOptions);
    }

    if (currentMatchOptions
      && (currentMatchOptions.mode === "watch" || currentMatchOptions.syncRole === "guest")) return;
    const controlSequence = startSequence;
    let controlChecks = 0;
    const checkHumanControl = () => {
      if (controlSequence !== startSequence) return;
      const active = typeof globalThis !== "undefined"
        && globalThis.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__ === true;
      root.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__ = active;
      if (active) {
        console.info("[original-runtime-latest] B3_HUMAN_CONTROL_ACTIVE red-team-player-ready");
        root.__ORIGINAL_RUNTIME_HUMAN_CONTROL_DETAIL__ = "red-team-player-ready";
        return;
      }
      controlChecks += 1;
      if (controlChecks < 40) {
        setTimeout(checkHumanControl, 250);
        return;
      }
      root.__ORIGINAL_RUNTIME_HUMAN_CONTROL_DETAIL__ = "play-mode-on-but-player-not-claimed";
      setStage("B3_CONTROL_DEGRADED", "已进入玩家模式，但 10 秒内未绑定红队球员");
      console.error("[original-runtime-latest] B3 操控失败：已进入玩家模式，但 10 秒内未绑定红队球员");
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: "操控初始化失败，请返回重试", icon: "none" });
    };
    checkHumanControl();
  });

  function invokeStandaloneMatch() {
    const redFormation = currentMatchOptions.redFormation;
    const blueFormation = currentMatchOptions.blueFormation;
    if (redFormation && blueFormation) {
      inputHost.__matchFormations = { red: redFormation, blue: blueFormation };
      root.__matchFormations = inputHost.__matchFormations;
    }
    root.__startStandaloneMatch({
      red: currentMatchOptions.redTeam,
      blue: currentMatchOptions.blueTeam,
      stadium: currentMatchOptions.stadium,
      ball: currentMatchOptions.ball,
      side: currentMatchOptions.side,
      ai: currentMatchOptions.ai,
      time: currentMatchOptions.time,
    });
  }

  const retryTextureBoot = () => {
    if (textureRecoveryPending) return true;
    if (!currentMatchOptions || textureRecoveryAttempts >= 2) return false;
    textureRecoveryPending = true;
    textureRecoveryAttempts += 1;
    setTimeout(async () => {
      try {
        const restore = await ensureCriticalIndicatorTextures(runtimePixi, criticalTextureTargets);
        restore();
        root.__ORIGINAL_RUNTIME_BOOT_ERROR__ = null;
        root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = null;
        textureRecoveryPending = false;
        setStage("B2_TEXTURE_CACHE_RESTORED", `attempt=${textureRecoveryAttempts}`);
        invokeStandaloneMatch();
      } catch (recoveryError) {
        textureRecoveryPending = false;
        root.__ORIGINAL_RUNTIME_LATEST_ERROR__ = recoveryError;
        setStage("B2_TEXTURE_RECOVERY_FAILED", recoveryError && recoveryError.message || String(recoveryError));
        console.error("[original-runtime-latest] 关键纹理静默恢复失败", recoveryError);
      }
    }, 80);
    return true;
  };
  for (const target of criticalTextureTargets) {
    if (target) target.__ORIGINAL_RUNTIME_RETRY_TEXTURE_BOOT__ = retryTextureBoot;
  }

  function startMatch(matchOptions) {
    currentMatchOptions = Object.assign({
      redTeam: "argentina",
      blueTeam: "portugal",
      redFormation: null,
      blueFormation: null,
      stadium: "international",
      ball: "classic_1",
      side: "home",
      ai: 1,
      time: 6,
      mode: "ai",
      syncRole: "off",
      sessionKind: "friend",
      matchId: "",
    }, matchOptions || {});
    const syncOptions = currentMatchOptions.matchSync || {};
    currentMatchOptions.syncRole = syncOptions.role || currentMatchOptions.syncRole || "off";
    currentMatchOptions.sessionKind = syncOptions.sessionKind
      || currentMatchOptions.sessionKind
      || "friend";
    currentMatchOptions.matchId = syncOptions.matchId
      || currentMatchOptions.matchId
      || "";
    matchSync.configure({
      role: currentMatchOptions.syncRole,
      sessionKind: currentMatchOptions.sessionKind,
      matchId: currentMatchOptions.matchId,
      sendSnapshot: syncOptions.sendSnapshot
        || currentMatchOptions.sendSnapshot
        || currentMatchOptions.onSnapshot,
      snapshotHz: syncOptions.snapshotHz || currentMatchOptions.snapshotHz || 20,
      bufferMs: syncOptions.bufferMs || currentMatchOptions.bufferMs || 120,
      startPaused: syncOptions.startPaused === true || currentMatchOptions.startPaused === true,
    });
    bindMatchSyncState(root, inputHost, matchSync);
    if (currentMatchOptions.syncRole !== "off" && !currentMatchOptions.matchId) {
      throw new Error("好友局启动被拦截：缺少服务端签发的 matchId");
    }
    if (currentMatchOptions.syncRole === "host" && !matchSync.hasSnapshotSink) {
      throw new Error("好友局启动被拦截：房主权威帧发送器未注册");
    }
    if (currentMatchOptions.syncRole !== "off"
      && runtimeWindow.__touchInput2 !== matchSync.remoteInput) {
      throw new Error("好友局启动被拦截：原版 window.__touchInput2 未绑定远程蓝方输入");
    }
    const sequence = ++startSequence;
    textureRecoveryAttempts = 0;
    textureRecoveryPending = false;
    root.__ORIGINAL_RUNTIME_ACTIVE__ = false;
    inputHost.__ORIGINAL_RUNTIME_PLAY_MODE__ = currentMatchOptions.mode !== "watch";
    root.__ORIGINAL_RUNTIME_PLAY_MODE__ = inputHost.__ORIGINAL_RUNTIME_PLAY_MODE__;
    setStage("B2_ORIGINAL_BOOT_CALLED", JSON.stringify(currentMatchOptions));
    const restoreCriticalTextures = criticalTextureTargets
      .map((target) => target && target.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__)
      .find((value) => typeof value === "function");
    if (!restoreCriticalTextures) throw new Error("比赛启动被拦截：关键纹理恢复器未注册");
    restoreCriticalTextures();
    invokeStandaloneMatch();

    setTimeout(() => {
      if (sequence !== startSequence) return;
      if (root.__ORIGINAL_RUNTIME_BOOT_ERROR__) {
        reportFatal(root.__ORIGINAL_RUNTIME_BOOT_ERROR__);
        return;
      }
      if (!root.__ORIGINAL_RUNTIME_ACTIVE__) {
        const game = root.__matchGame;
        const renderer = game && game.renderer;
        const s = root.__ANIMAL_IMG_STATS__ || {};
        const imgTail = s.lastStuck
          ? " 卡:" + String(s.lastStuck).split("/").pop()
          : (s.lastMiss ? " 缺:" + String(s.lastMiss).split("/").pop() : "");
        const imgInfo = `img请求=${s.req || 0} 命中=${s.dataUriHit || 0} 未命中=${s.dataUriMiss || 0} 成功=${s.loaded || 0} 失败=${s.failed || 0} 补送=${s.rescued || 0} 卡死=${s.stuck || 0}${imgTail}`;
        reportFatal(new Error(`B2 超时：30 秒未出首帧；renderer=${!!renderer}, gl=${!!(renderer && renderer.gl)}, progress=${root.__loadProgress || 0}; ${imgInfo}`));
      }
    }, 30000);
  }

  const api = {
    platform,
    PIXI: root.PIXI,
    root,
    inputHost,
    touchInput,
    matchSync,
    startMatch,
    setRemoteInput(input, metadata) {
      return matchSync.setRemoteInput(input, metadata);
    },
    pushAuthoritativeSnapshot(payload, metadata) {
      return matchSync.pushSnapshot(payload, metadata);
    },
    clearRemoteInput() {
      return matchSync.clearRemoteInput();
    },
    setRemotePlayerEnabled(enabled) {
      const result = matchSync.setRemoteControlEnabled(enabled);
      bindMatchSyncState(root, inputHost, matchSync);
      return result;
    },
    pauseMatchSync(reason) {
      return matchSync.pause(reason);
    },
    resumeMatchSync() {
      return matchSync.resume();
    },
  };
  if (!options.deferStart) startMatch(options.matchOptions);
  return api;
}

module.exports = {
  bootOriginalRuntime,
  ensureCriticalIndicatorTextures,
  detectPhysicalMobileDevice,
  isRecoverableTextureCacheError,
  mirrorTouchTelemetry,
  bindMatchSyncState,
  reportFatal,
  resolveRuntimePixi,
};
