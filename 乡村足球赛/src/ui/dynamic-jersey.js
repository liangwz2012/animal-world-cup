const KITS = ["home", "away", "goalkeeper"];
const FACES = ["front", "back"];
const DEFAULT_SIZE = { width: 56, height: 52 };
const MAX_CACHE_ENTRIES = 12;
const BACK_LABEL_Y_RATIO = 0.25;
// 队服文字是增强效果，绝不能把原版比赛首帧卡住。
const DEFAULT_PREPARE_TIMEOUT_MS = 2600;
const { resolveJerseyLocation } = require("../data/administrative-regions");

function cleanText(value, limit) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>`{}\\]/g, "")
    .replace(/\s+/g, "")
    .trim())
    .slice(0, limit || 18)
    .join("");
}

function shorten(value, limit) {
  const chars = Array.from(String(value || ""));
  return chars.length > limit ? chars.slice(0, limit).join("") : chars.join("");
}

function normalizeJerseyIdentity(input) {
  const source = input && typeof input === "object" ? input : {};
  const province = cleanText(source.province, 12);
  const cityOrCounty = cleanText(source.cityOrCounty || source.city || source.county, 12);
  const village = cleanText(source.village, 12);
  const customName = cleanText(source.customName || source.name, 18);
  const locationLabel = cleanText(source.locationLabel || source.regionName, 18);
  const displayName = customName || locationLabel || village || cityOrCounty || province;
  const numeric = Math.round(Number(source.number));
  return {
    province,
    cityOrCounty,
    village,
    customName,
    locationLabel,
    number: Number.isFinite(numeric) && numeric >= 1 && numeric <= 99 ? String(numeric) : "",
    displayName,
    frontLabel: shorten(displayName, 4),
    backLabel: shorten(displayName, 6),
    enabled: !!displayName,
  };
}

async function resolveMatchJerseyIdentity(input, options) {
  const source = input && typeof input === "object" ? input : {};
  // 已在选择器中确认过的显示名与自定义队名都可直接使用。只有调用方仅提供行政区
  // 代码、没有任何显示文本时才按需解析；避免每次开赛都重新载入四万条乡镇数据。
  if (cleanText(source.customName || source.name || source.locationLabel || source.regionName, 18)
    || !Array.isArray(source.locationCodes)
    || !source.locationCodes.length) {
    return normalizeJerseyIdentity(source);
  }
  const location = await resolveJerseyLocation(source, { wxApi: options && options.wxApi });
  return normalizeJerseyIdentity(Object.assign({}, source, location.jersey));
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceAssetPath(teamId, kit, face) {
  return `/match-runtime-min/data/teams/${teamId}/${kit}/shirt_${face}.png`;
}

function dynamicAssetPath(sourcePath, signature) {
  const cleanPath = String(sourcePath || "").replace(/\.png(?:\?.*)?$/i, "");
  return `${cleanPath}.jersey-${stableHash(signature)}.png`;
}

function createCanvasFactory(options) {
  if (typeof options.createCanvas === "function") return options.createCanvas;
  const wxApi = options.wxApi;
  const globalObject = options.globalObject || {};
  if (wxApi && typeof wxApi.createOffscreenCanvas === "function") {
    return (width, height) => {
      const canvas = wxApi.createOffscreenCanvas({ type: "2d", width, height });
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
  }
  if (typeof globalObject.OffscreenCanvas === "function") {
    return (width, height) => new globalObject.OffscreenCanvas(width, height);
  }
  return null;
}

function createImageLoader(options) {
  if (typeof options.loadImage === "function") return options.loadImage;
  const wxApi = options.wxApi;
  return (source) => new Promise((resolve, reject) => {
    if (!wxApi || typeof wxApi.createImage !== "function") {
      reject(new Error("当前运行环境不支持离屏队服绘制"));
      return;
    }
    const image = wxApi.createImage();
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(image);
    };
    const timer = setTimeout(() => done(new Error(`队服底图加载超时: ${source}`)), 2200);
    image.onload = () => done();
    image.onerror = () => done(new Error(`队服底图加载失败: ${source}`));
    try {
      if ("__rfSrc" in image) image.__rfSrc = source;
      else image.src = source;
    } catch (error) {
      done(error);
    }
  });
}

function serializeCanvas(canvas) {
  if (canvas && typeof canvas.toDataURL === "function") {
    const value = canvas.toDataURL("image/png");
    if (typeof value === "string" && value) return Promise.resolve(value);
  }
  // 标准 OffscreenCanvas（DevTools Chrome 内核）：只有 convertToBlob，没有
  // toDataURL / toTempFilePath；缺失这条路径会导致队服文字全部静默回退。
  if (canvas && typeof canvas.convertToBlob === "function" && typeof FileReader === "function") {
    return canvas.convertToBlob({ type: "image/png" }).then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("队服 Canvas Blob 读取失败"));
      reader.readAsDataURL(blob);
    }));
  }
  if (canvas && typeof canvas.toTempFilePath === "function") {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (payload && payload.tempFilePath) resolve(payload.tempFilePath);
        else reject(new Error("队服临时文件为空"));
      };
      // 部分开发者工具版本的 OffscreenCanvas 既不返回 Promise 也不回调；必须及时回退。
      const timer = setTimeout(() => finish(new Error("队服 Canvas 导出超时")), 900);
      try {
        const result = canvas.toTempFilePath({
          fileType: "png",
          success: (payload) => finish(null, payload),
          fail: (error) => finish(error),
        });
        if (result && typeof result.then === "function") {
          result.then((payload) => finish(null, payload), (error) => finish(error));
        }
      } catch (error) {
        finish(error);
      }
    });
  }
  return Promise.reject(new Error("离屏 Canvas 不支持导出图片"));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textWidth(context, label, size) {
  if (!context || !label) return 0;
  context.font = `900 ${size}px sans-serif`;
  if (typeof context.measureText === "function") {
    const metrics = context.measureText(label);
    const width = finiteNumber(metrics && metrics.width, 0);
    if (width > 0) return width;
  }
  // 中文字体在小游戏 Canvas 中通常接近方形；没有 measureText 时用保守值，
  // 确保文字宁可略小，也不能冲出原上衣透明边界。
  return Array.from(label).length * size;
}

function createJerseyTextLayout(context, label, face, width, height) {
  const safeFace = face === "back" ? "back" : "front";
  const chars = Array.from(String(label || "")).length;
  const pixelScale = Math.max(1, Math.min(width / DEFAULT_SIZE.width, height / DEFAULT_SIZE.height));
  // Image2 球衣以 2 倍物理像素进入引擎，但 Spine 逻辑尺寸仍为 56×52。
  // 字号随物理像素同比放大，屏幕上的视觉字号不变，边缘会更清晰。
  // 56×52 是原引擎真实显示纹理，不是 112×104 的逻辑缩略图。两字地区名必须
  // 占据胸口主要视觉区域，否则缩到比赛镜头后只剩一条不可辨认的亮线。
  const baseSize = (safeFace === "front" ? 16 : 15) * pixelScale;
  const minSize = 9 * pixelScale;
  const maxWidth = width * (safeFace === "front" ? 0.82 : 0.84);
  let size = Math.max(minSize, baseSize - Math.max(0, chars - 2) * 0.85);
  let measuredWidth = textWidth(context, label, size);
  if (measuredWidth > maxWidth) {
    size = Math.max(minSize, size * maxWidth / measuredWidth);
    measuredWidth = textWidth(context, label, size);
  }
  const scaleX = measuredWidth > maxWidth
    ? Math.max(0.68, maxWidth / measuredWidth)
    : 1;
  return {
    face: safeFace,
    label: String(label || ""),
    x: width / 2,
    // 背面文字固定在上部，避开原引擎逐球员绘制的号码图层。
    // 正面名称压在 Image2 预留的浅色胸条内；背面仍避开原引擎逐人绘制的号码。
    y: safeFace === "front" ? Math.round(height * 0.38) : Math.round(height * BACK_LABEL_Y_RATIO),
    size,
    maxWidth,
    measuredWidth,
    scaleX,
  };
}

function sampleJerseyLuminance(context, layout, width, height) {
  if (!context || typeof context.getImageData !== "function") return 128;
  const sampleWidth = Math.max(2, Math.min(width, Math.ceil(layout.maxWidth + 6)));
  const sampleHeight = Math.max(2, Math.min(height, Math.ceil(layout.size + 6)));
  const x = Math.max(0, Math.min(width - sampleWidth, Math.floor(layout.x - sampleWidth / 2)));
  const y = Math.max(0, Math.min(height - sampleHeight, Math.floor(layout.y - sampleHeight / 2)));
  try {
    const pixels = context.getImageData(x, y, sampleWidth, sampleHeight);
    const data = pixels && pixels.data;
    if (!data || !data.length) return 128;
    let total = 0;
    let count = 0;
    for (let offset = 0; offset + 3 < data.length; offset += 4) {
      const alpha = data[offset + 3];
      if (alpha < 24) continue;
      total += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
      count += 1;
    }
    return count ? total / count : 128;
  } catch {
    return 128;
  }
}

function jerseyTextPalette(luminance) {
  if (finiteNumber(luminance, 128) >= 154) {
    return {
      fill: "#17352b",
      innerStroke: "rgba(17, 53, 43, 0.98)",
      outerStroke: "rgba(255, 248, 219, 0.96)",
      shadow: "rgba(255, 255, 255, 0.24)",
      mode: "dark-on-light",
    };
  }
  return {
    fill: "#fff8db",
    innerStroke: "rgba(255, 224, 122, 0.98)",
    outerStroke: "rgba(17, 35, 30, 0.96)",
    shadow: "rgba(0, 0, 0, 0.42)",
    mode: "light-on-dark",
  };
}

function drawLabel(context, label, face, width, height) {
  if (!context || !label) return null;
  const layout = createJerseyTextLayout(context, label, face, width, height);
  const palette = jerseyTextPalette(sampleJerseyLuminance(context, layout, width, height));
  if (typeof context.save === "function") context.save();
  context.font = `900 ${layout.size}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.fillStyle = palette.fill;
  context.shadowColor = palette.shadow;
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;

  // 小尺寸比赛纹理必须先铺一块半透明号码布，隔离复杂球衣花纹。
  // 这块底只覆盖队名安全区，不改变球衣轮廓或动作锚点。
  const badgeWidth = Math.min(layout.maxWidth + 4, layout.measuredWidth * layout.scaleX + 7);
  const badgeHeight = layout.size + 4;
  context.fillStyle = palette.mode === "dark-on-light"
    ? "rgba(255, 248, 219, 0.82)"
    : "rgba(18, 43, 30, 0.78)";
  if (typeof context.fillRect === "function") {
    context.fillRect(
      Math.round(layout.x - badgeWidth / 2),
      Math.round(layout.y - badgeHeight / 2),
      Math.round(badgeWidth),
      Math.round(badgeHeight),
    );
  }
  context.fillStyle = palette.fill;

  const canScale = layout.scaleX < 0.999
    && typeof context.translate === "function"
    && typeof context.scale === "function";
  let drawX = layout.x;
  let drawY = layout.y;
  if (canScale) {
    context.translate(layout.x, layout.y);
    context.scale(layout.scaleX, 1);
    drawX = 0;
    drawY = 0;
  }
  if (typeof context.strokeText === "function") {
    context.lineWidth = Math.max(1.15, layout.size * 0.15);
    context.strokeStyle = palette.outerStroke;
    context.strokeText(label, drawX, drawY);
    context.lineWidth = Math.max(0.55, layout.size * 0.055);
    context.strokeStyle = palette.innerStroke;
    context.strokeText(label, drawX, drawY);
  }
  if (typeof context.fillText === "function") context.fillText(label, drawX, drawY);
  if (typeof context.restore === "function") context.restore();
  return Object.assign({}, layout, { palette: palette.mode });
}

function dynamicRegistryKeys(path, resolvePath) {
  const original = String(path || "");
  const normalized = typeof resolvePath === "function" ? resolvePath(original) : original.replace(/^\/+/, "");
  return Array.from(new Set([
    original,
    original.replace(/^\/+/, ""),
    normalized,
    `/${String(normalized || "").replace(/^\/+/, "")}`,
  ].filter(Boolean)));
}

function createDynamicJerseyComposer(options) {
  const config = options || {};
  const createCanvas = createCanvasFactory(config);
  const loadImage = createImageLoader(config);
  const resolvePath = config.resolvePath;
  const registryTargets = Array.from(new Set([
    config.root,
    config.root && config.root.window,
    config.inputHost,
    config.inputHost && config.inputHost.window,
    config.globalObject,
  ].filter(Boolean)));
  const renderedCache = new Map();
  const registeredKeys = new Set();
  let plannedSlots = [];
  let lastStatus = { supported: !!createCanvas, applied: 0, failed: 0, labels: {} };

  function imageRegistry() {
    let registry = null;
    for (const target of registryTargets) {
      if (target && target.__RURAL_DYNAMIC_IMAGE_DATA_URIS__) {
        registry = target.__RURAL_DYNAMIC_IMAGE_DATA_URIS__;
        break;
      }
    }
    if (!registry) registry = Object.create(null);
    for (const target of registryTargets) {
      if (target) {
        target.__RURAL_DYNAMIC_IMAGE_DATA_URIS__ = registry;
      }
    }
    return registry;
  }

  function clearRegisteredImages(registry) {
    for (const key of registeredKeys) delete registry[key];
    registeredKeys.clear();
  }

  function cacheValue(key, value) {
    if (renderedCache.has(key)) renderedCache.delete(key);
    renderedCache.set(key, value);
    while (renderedCache.size > MAX_CACHE_ENTRIES) renderedCache.delete(renderedCache.keys().next().value);
  }

  async function compose(source, label, face) {
    const cacheKey = `${source}|${face}|${label}`;
    if (renderedCache.has(cacheKey)) return renderedCache.get(cacheKey);
    if (!createCanvas) throw new Error("当前运行环境不支持离屏 Canvas");
    const image = await loadImage(source);
    const width = Number(image && (image.naturalWidth || image.width)) || DEFAULT_SIZE.width;
    const height = Number(image && (image.naturalHeight || image.height)) || DEFAULT_SIZE.height;
    const canvas = createCanvas(width, height);
    const context = canvas && canvas.getContext && canvas.getContext("2d");
    if (!context || typeof context.drawImage !== "function") throw new Error("无法取得队服 Canvas 2D 上下文");
    if (typeof context.clearRect === "function") context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    drawLabel(context, label, face, width, height);
    const uri = await serializeCanvas(canvas);
    cacheValue(cacheKey, uri);
    return uri;
  }

  async function prepare(matchOptions) {
    const match = matchOptions || {};
    const resolvedIdentities = await Promise.all([
      resolveMatchJerseyIdentity(match.redJersey, { wxApi: config.wxApi }).catch(() => normalizeJerseyIdentity(match.redJersey)),
      resolveMatchJerseyIdentity(match.blueJersey, { wxApi: config.wxApi }).catch(() => normalizeJerseyIdentity(match.blueJersey)),
    ]);
    const sides = [
      { side: "red", teamId: match.redTeam, identity: resolvedIdentities[0] },
      { side: "blue", teamId: match.blueTeam, identity: resolvedIdentities[1] },
    ];
    const registry = imageRegistry();
    clearRegisteredImages(registry);
    plannedSlots = [];
    const nextSlots = [];
    const deadlineAt = Date.now() + Math.max(200, Number(config.prepareTimeoutMs) || DEFAULT_PREPARE_TIMEOUT_MS);
    let timedOut = false;
    const labels = {};
    for (const item of sides) labels[item.side] = item.identity.displayName;
    const status = {
      supported: !!createCanvas,
      applied: 0,
      failed: 0,
      labels,
      reason: "",
    };
    if (!createCanvas) {
      status.reason = "离屏 Canvas 不可用，已回退原球衣";
      plannedSlots = [];
      lastStatus = status;
      return status;
    }
    const jobs = [];
    for (const side of sides) {
      if (!side.teamId || !side.identity.enabled) continue;
      for (const kit of KITS) {
        for (const face of FACES) {
          const source = sourceAssetPath(side.teamId, kit, face);
          const label = face === "front" ? side.identity.frontLabel : side.identity.backLabel;
          const signature = `${side.teamId}|${kit}|${face}|${side.identity.displayName}`;
          const target = dynamicAssetPath(source, signature);
          jobs.push((async () => {
            try {
              const uri = await compose(source, label, face);
              if (timedOut || Date.now() > deadlineAt) return;
              for (const key of dynamicRegistryKeys(target, resolvePath)) {
                registry[key] = uri;
                registeredKeys.add(key);
              }
              nextSlots.push({ teamId: side.teamId, kit, face, target, label });
              status.applied += 1;
            } catch (error) {
              status.failed += 1;
              console.warn("[dynamic-jersey] 队服文字绘制失败，保留原球衣", source, error && error.message || error);
            }
          })());
        }
      }
    }
    let timeoutId = null;
    const outcome = await Promise.race([
      Promise.all(jobs).then(() => "complete"),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          resolve("timeout");
        }, Math.max(0, deadlineAt - Date.now()));
      }),
    ]);
    if (timeoutId != null) clearTimeout(timeoutId);
    if (outcome === "timeout") timedOut = true;
    plannedSlots = timedOut ? [] : nextSlots;
    if (timedOut) {
      clearRegisteredImages(registry);
      status.applied = 0;
      status.failed = 0;
      status.reason = "队服文字生成超时，已回退原球衣";
    }
    if (!status.applied && status.failed) status.reason = "队服文字生成失败，已回退原球衣";
    console.info(
      "[dynamic-jersey] prepared",
      `applied=${status.applied}`,
      `failed=${status.failed}`,
      `red=${labels.red || ""}`,
      `blue=${labels.blue || ""}`,
    );
    lastStatus = status;
    return status;
  }

  function applyToTeamCollection(teamManager) {
    if (!teamManager || typeof teamManager.get !== "function") return 0;
    let applied = 0;
    for (const slot of plannedSlots) {
      const team = teamManager.get(slot.teamId);
      const kit = team && team.kits && team.kits[slot.kit];
      const piece = kit && kit[`shirt_${slot.face}`];
      if (!piece || typeof piece !== "object") continue;
      piece.name = slot.target;
      applied += 1;
    }
    lastStatus = Object.assign({}, lastStatus, { injected: applied });
    return applied;
  }

  function installRuntimeHook() {
    const hook = (teamManager) => applyToTeamCollection(teamManager);
    for (const target of registryTargets) {
      if (target) {
        target.__RURAL_DYNAMIC_JERSEY_HOOK__ = hook;
      }
    }
    return hook;
  }

  return {
    prepare,
    installRuntimeHook,
    applyToTeamCollection,
    status() { return Object.assign({}, lastStatus); },
    slots() { return plannedSlots.slice(); },
  };
}

module.exports = {
  KITS,
  FACES,
  cleanText,
  normalizeJerseyIdentity,
  resolveMatchJerseyIdentity,
  sourceAssetPath,
  dynamicAssetPath,
  createJerseyTextLayout,
  sampleJerseyLuminance,
  jerseyTextPalette,
  drawLabel,
  createDynamicJerseyComposer,
  DEFAULT_PREPARE_TIMEOUT_MS,
};
