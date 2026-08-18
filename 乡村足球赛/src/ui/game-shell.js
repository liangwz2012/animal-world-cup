const {
  TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  normalizeConfig,
  cycle,
} = require("../data/game-options");
const { ruralPlayersForSide } = require("../data/rural-squad");
const { FRIEND_ENTRY_ENABLED } = require("../net/friend-service-config");

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const REGION_LEVELS = [
  { level: "province", label: "省份" },
  { level: "city", label: "城市" },
  { level: "county", label: "区县" },
  { level: "town", label: "乡镇" },
];
// 首页统一使用12人乡村队半身像，不再把人物身份绑定到旧的动物球队资源键。
const HOME_PORTRAIT_PLAYERS = Object.freeze({
  red: Object.freeze(ruralPlayersForSide("red")),
  blue: Object.freeze(ruralPlayersForSide("blue")),
});
const HOME_PORTRAIT_ROSTER = Object.freeze([
  ...HOME_PORTRAIT_PLAYERS.red,
  ...HOME_PORTRAIT_PLAYERS.blue,
]);
const FRIEND_ROOM_STATUSES = [
  "creating",
  "waiting_host",
  "waiting_guest",
  "friend_unready",
  "host_warmup",
  "queued_after_warmup",
  "guest_can_spectate",
  "guest_spectating",
  "friend_ready",
  "loading",
  "countdown",
  "reconnecting",
  "error",
];

function normalizeFriendState(input, previous) {
  const merged = Object.assign({
    status: "creating",
    role: "host",
    roomId: "",
    invite: "",
    message: "",
    countdown: 3,
  }, previous || {}, input || {});
  if (merged.status === "queue_after_warmup") merged.status = "queued_after_warmup";
  if (merged.status === "ready") merged.status = "friend_ready";
  if (merged.status === "joined") merged.status = merged.role === "guest" ? "waiting_guest" : "friend_unready";
  if (merged.status === "waiting") merged.status = merged.role === "guest" ? "waiting_guest" : "waiting_host";
  if (merged.status === "warmup") {
    merged.status = merged.role === "guest"
      ? (merged.guestSpectating ? "guest_spectating" : "guest_can_spectate")
      : "host_warmup";
  }
  if (!FRIEND_ROOM_STATUSES.includes(merged.status)) merged.status = "error";
  merged.role = merged.role === "guest" ? "guest" : "host";
  merged.roomId = typeof merged.roomId === "string" ? merged.roomId.slice(0, 96) : "";
  merged.invite = typeof merged.invite === "string" ? merged.invite.slice(0, 160) : "";
  merged.message = typeof merged.message === "string" ? merged.message.slice(0, 120) : "";
  merged.countdown = Math.max(0, Math.min(9, Math.floor(Number(merged.countdown) || 0)));
  return merged;
}

function normalizeCampaignState(input) {
  const source = input && typeof input === "object" ? input : {};
  const season = source.season && typeof source.season === "object" ? source.season : {};
  const daily = source.daily && typeof source.daily === "object" ? source.daily : {};
  return {
    season: {
      seasonNumber: Math.max(1, Math.floor(Number(season.seasonNumber) || 1)),
      completedRounds: Math.max(0, Math.min(5, Math.floor(Number(season.completedRounds) || 0))),
      totalRounds: Math.max(1, Math.min(5, Math.floor(Number(season.totalRounds) || 5))),
      complete: !!season.complete,
      opponentName: typeof season.opponentName === "string" ? season.opponentName.slice(0, 12) : "",
    },
    daily: {
      theme: typeof daily.theme === "string" ? daily.theme.slice(0, 12) : "今日挑战",
      opponentName: typeof daily.opponentName === "string" ? daily.opponentName.slice(0, 12) : "",
      attempts: Math.max(0, Math.floor(Number(daily.attempts) || 0)),
      completed: !!daily.completed,
    },
  };
}

function normalizeOnlineFeatures(input) {
  const source = input && typeof input === "object" ? input : {};
  const leaderboard = source.leaderboard && typeof source.leaderboard === "object" ? source.leaderboard : {};
  const friend = source.friend && typeof source.friend === "object" ? source.friend : {};
  const monetization = source.monetization && typeof source.monetization === "object" ? source.monetization : {};
  return {
    leaderboard: { enabled: !!leaderboard.enabled },
    friend: { enabled: !!friend.enabled },
    monetization: { enabled: !!monetization.enabled },
  };
}

function point(touch) {
  return {
    x: Number(touch && (touch.clientX == null ? (touch.pageX == null ? touch.x : touch.pageX) : touch.clientX)) || 0,
    y: Number(touch && (touch.clientY == null ? (touch.pageY == null ? touch.y : touch.pageY) : touch.clientY)) || 0,
  };
}

function cleanRegionText(value, max) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>`{}\\]/g, "")
    .trim())
    .slice(0, max || 18)
    .join("");
}

function normalizeHomeRegion(input) {
  const source = input && typeof input === "object" ? input : {};
  const path = (Array.isArray(source.path) ? source.path : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, REGION_LEVELS.length)
    .map((item) => ({
      code: cleanRegionText(item.code, 18),
      parentCode: cleanRegionText(item.parentCode, 18),
      level: REGION_LEVELS.some((candidate) => candidate.level === item.level) ? item.level : "",
      name: cleanRegionText(item.name, 18),
      shortName: cleanRegionText(item.shortName || item.name, 12),
    }))
    .filter((item) => item.code && item.level && item.shortName);
  const customName = cleanRegionText(source.customName, 18);
  const leaf = path[path.length - 1] || null;
  const displayName = customName
    || cleanRegionText(source.displayName, 18)
    || (leaf && leaf.shortName)
    || "";
  return {
    path,
    customName,
    displayName,
    mode: source.mode === "manual" ? "manual" : "auto",
  };
}

function regionLeaf(region) {
  return region && region.path && region.path[region.path.length - 1] || null;
}

function nextRegionLevel(region) {
  const leaf = regionLeaf(region);
  if (!leaf) return REGION_LEVELS[0];
  const index = REGION_LEVELS.findIndex((item) => item.level === leaf.level);
  return index >= 0 ? REGION_LEVELS[index + 1] || null : REGION_LEVELS[0];
}

function regionTeamName(region, fallback) {
  const value = cleanRegionText(region && region.displayName, 18);
  return value ? `${value}队` : fallback;
}

function jerseyShortName(region) {
  const value = cleanRegionText(region && region.displayName, 18);
  return Array.from(value || "待定").slice(0, 4).join("");
}

function regionSeed(region, salt) {
  const leaf = regionLeaf(region);
  const source = `${leaf && leaf.code || ""}|${region && region.displayName || ""}|${salt || ""}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const BUILD_TAG = "SRCFIX-13";

function createGameShell(options) {
  const PIXI = options.PIXI;
  const canvas = options.canvas;
  const wxApi = options.wxApi;
  let width = Math.max(1, Number(options.width) || 1280);
  let height = Math.max(1, Number(options.height) || 720);
  const resolution = Math.max(1, Math.min(3, Number(options.resolution) || 1));
  let pixelRatio = Math.max(1, Number(options.pixelRatio) || resolution);
  if (!PIXI || !PIXI.Container || !PIXI.Graphics || !PIXI.Text) {
    throw new Error("启动界面缺少 Pixi Container/Graphics/Text");
  }

  const renderer = PIXI.autoDetectRenderer(width, height, {
    view: canvas,
    antialias: true,
    transparent: false,
    backgroundColor: 0x8cad25,
    resolution,
    autoResize: true,
  });
  const stage = new PIXI.Container();
  const viewportBackground = new PIXI.Graphics();
  const design = new PIXI.Container();
  let scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  design.scale.set(scale, scale);
  design.position.set((width - DESIGN_WIDTH * scale) / 2, (height - DESIGN_HEIGHT * scale) / 2);
  stage.addChild(viewportBackground, design);

  function drawViewportBackground() {
    viewportBackground.clear();
    viewportBackground.beginFill(0x8cad25, 1);
    viewportBackground.drawRect(0, 0, width, height);
    viewportBackground.endFill();
  }
  drawViewportBackground();

  let screen = "loading";
  let targetProgress = 0;
  let shownProgress = 0;
  let progressParts = null;
  let rafId = null;
  let suspended = false;
  let config = normalizeConfig(options.config);
  // 好友对战入口开关：缺省读 friend-service-config，测试可显式覆盖。
  let onlineFeatures = normalizeOnlineFeatures(options.onlineFeatures);
  let friendEntryEnabled = options.friendEntryEnabled != null
    ? !!options.friendEntryEnabled
    : onlineFeatures.friend.enabled || FRIEND_ENTRY_ENABLED !== false;
  let hitAreas = [];
  let touchAttached = false;
  let touchUsesStart = false;
  let mouseAttached = false;
  let canvasMouseAttached = false;
  let lastPointer = null;
  let attachedGame = null;
  let runtimeLoadingOverlay = null;
  let transitionLocked = false;
  let friendState = null;
  let leaderboardState = { metric: "points", model: null };
  let regionPickerState = { path: [], entries: [], page: 0 };
  let dropdownRequest = null;
  let dropdownState = null;
  let dropdownLayer = null;
  let dropdownHandlersAttached = false;
  let campaignState = normalizeCampaignState(options.campaign);
  let preMatchState = null;
  let modeHubState = null;
  const textureCache = Object.create(null);
  const portraitPaths = Object.create(null);
  let onAction = typeof options.onAction === "function" ? options.onAction : () => {};

  function text(value, size, color, weight) {
    return new PIXI.Text(String(value), {
      fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: size,
      fontWeight: weight || "700",
      fill: color == null ? 0x243413 : color,
      align: "center",
    });
  }

  function center(display, x, y) {
    if (display.anchor && display.anchor.set) display.anchor.set(0.5, 0.5);
    display.position.set(x, y);
    return display;
  }

  function rounded(parent, x, y, w, h, radius, fill, alpha, stroke, strokeAlpha, strokeWidth) {
    const g = new PIXI.Graphics();
    if (strokeWidth) g.lineStyle(strokeWidth, stroke, strokeAlpha == null ? 1 : strokeAlpha);
    g.beginFill(fill, alpha == null ? 1 : alpha);
    g.drawRoundedRect(x, y, w, h, radius);
    g.endFill();
    parent.addChild(g);
    return g;
  }

  function addHit(x, y, w, h, action, enabled) {
    hitAreas.push({ x, y, w, h, action, enabled: enabled !== false });
  }

  function addBackground() {
    const bg = new PIXI.Graphics();
    bg.beginFill(0x8cad25, 1);
    bg.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    bg.endFill();
    bg.lineStyle(2, 0xc5d96b, 0.12);
    for (let radius = 170; radius <= 650; radius += 120) bg.drawCircle(640, 360, radius);
    bg.beginFill(0xd2e682, 0.13);
    for (let x = 32; x < DESIGN_WIDTH; x += 64) {
      for (let y = 36; y < DESIGN_HEIGHT; y += 64) bg.drawCircle(x, y, 2.2);
    }
    bg.endFill();
    design.addChild(bg);
  }

  function cachedTexture(path, forceFresh) {
    if (forceFresh) {
      delete textureCache[path];
      if (PIXI.Texture && typeof PIXI.Texture.removeFromCache === "function") PIXI.Texture.removeFromCache(path);
      if (PIXI.BaseTexture && typeof PIXI.BaseTexture.removeFromCache === "function") PIXI.BaseTexture.removeFromCache(path);
      if (PIXI.utils && PIXI.utils.TextureCache) delete PIXI.utils.TextureCache[path];
      if (PIXI.utils && PIXI.utils.BaseTextureCache) delete PIXI.utils.BaseTextureCache[path];
    }
    if (!textureCache[path]) {
      textureCache[path] = PIXI.Texture && PIXI.Texture.fromImage
        ? PIXI.Texture.fromImage(path)
        : null;
    }
    return textureCache[path];
  }

  function sprite(path, x, y, widthValue, heightValue, forceFresh) {
    const texture = cachedTexture(path, forceFresh);
    const image = texture
      ? new PIXI.Sprite(texture)
      : PIXI.Sprite.fromImage(path);
    center(image, x, y);
    image.width = widthValue;
    image.height = heightValue;
    design.addChild(image);
    return image;
  }

  function waitForTexture(path, fallbackPath) {
    const texture = cachedTexture(path);
    const base = texture && texture.baseTexture;
    if (!base || base.hasLoaded || base.valid) return Promise.resolve(path);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      if (typeof base.once === "function") {
        base.once("loaded", () => finish(path));
        base.once("error", () => {
          if (!fallbackPath) return finish(path);
          const fallback = cachedTexture(fallbackPath);
          const fallbackBase = fallback && fallback.baseTexture;
          if (!fallbackBase || fallbackBase.hasLoaded || fallbackBase.valid) return finish(fallbackPath);
          if (typeof fallbackBase.once === "function") {
            fallbackBase.once("loaded", () => finish(fallbackPath));
            fallbackBase.once("error", () => finish(path));
          }
        });
      }
      setTimeout(() => finish(path), 3500);
    });
  }

  const portraitReady = Promise.all(HOME_PORTRAIT_ROSTER.map((player) => {
    const localPath = `shell-assets/squad/${player.id}.png`;
    const fallbackPath = `runtime-assets/match-runtime-min/data/player/races/${player.race}/head.png`;
    portraitPaths[player.id] = localPath;
    return waitForTexture(localPath, fallbackPath).then((resolved) => {
      portraitPaths[player.id] = resolved;
      return resolved;
    });
  }));
  cachedTexture("shell-assets/brand-logo.png");
  cachedTexture("shell-assets/football.png");

  function clearDesign() {
    if (typeof design.removeChildren === "function") design.removeChildren();
    hitAreas = [];
    progressParts = null;
    dropdownState = null;
    dropdownLayer = null;
  }

  function showLoading(nextOptions) {
    const loadingOptions = nextOptions || {};
    screen = "loading";
    suspended = false;
    transitionLocked = true;
    if (loadingOptions.reset) {
      shownProgress = Math.max(0, Number(loadingOptions.progress) || 6);
      targetProgress = shownProgress;
    }
    clearDesign();
    addBackground();
    sprite("shell-assets/brand-logo.png", 640, 277, 318, 318, loadingOptions.freshAssets);

    const trackX = 314;
    const trackY = 557;
    const trackW = 652;
    const track = new PIXI.Graphics();
    track.lineStyle(8, 0x2e4412, 0.88);
    track.moveTo(trackX, trackY);
    track.lineTo(trackX + trackW, trackY);
    track.lineStyle(3, 0xf3f7d5, 1);
    track.moveTo(trackX, trackY - 3);
    track.lineTo(trackX + trackW, trackY - 3);
    design.addChild(track);

    const fill = new PIXI.Graphics();
    design.addChild(fill);
    const ball = sprite("shell-assets/football.png", trackX, trackY - 4, 94, 94, loadingOptions.freshAssets);
    const status = center(text(loadingOptions.label || "正在加载游戏资源", 22, 0xf8f3d9, "800"), 640, 494);
    const pct = center(text(`${Math.round(shownProgress)}%`, 25, 0xf8f3d9, "800"), 640, 625);
    // 构建水印：一眼确认手机上跑的是不是最新代码。看到这个 tag = 新代码已生效。
    const buildStamp = center(text(`build ${BUILD_TAG}`, 15, 0xbcd08a, "700"), 640, 664);
    design.addChild(status, pct, buildStamp);
    progressParts = { trackX, trackY, trackW, fill, ball, pct, status };
    renderProgress();
    if (!loadingOptions.skipShellRender) renderer.render(stage);
  }

  function destroyRuntimeLoadingOverlay() {
    if (!runtimeLoadingOverlay) return;
    if (runtimeLoadingOverlay.timer) clearInterval(runtimeLoadingOverlay.timer);
    const root = runtimeLoadingOverlay.root;
    if (root && root.parent && root.parent.removeChild) root.parent.removeChild(root);
    if (root && root.destroy) root.destroy({ children: true });
    runtimeLoadingOverlay = null;
  }

  function updateRuntimeLoadingProgress(value) {
    if (!runtimeLoadingOverlay) return;
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    const ratio = progress / 100;
    const parts = runtimeLoadingOverlay;
    parts.fill.clear();
    parts.fill.lineStyle(5, 0xf1b82d, 1);
    parts.fill.moveTo(parts.trackX, parts.trackY - 3);
    parts.fill.lineTo(parts.trackX + parts.trackW * ratio, parts.trackY - 3);
    parts.ball.position.x = parts.trackX + parts.trackW * ratio;
    parts.ball.position.y = parts.trackY - 4 - Math.sin(ratio * Math.PI * 14) * 4;
    parts.ball.rotation = ratio * Math.PI * 10;
    parts.pct.text = `${Math.round(progress)}%`;
  }

  function createRuntimeLoadingOverlay(game, label, progress) {
    destroyRuntimeLoadingOverlay();
    if (!game || !game.stage || !game.renderer) return false;
    const gameScreen = game.renderer.screen;
    const gameResolution = Number(game.renderer.resolution) || 1;
    const targetWidth = Number(gameScreen && gameScreen.width) || Number(game.renderer.width) / gameResolution || width;
    const targetHeight = Number(gameScreen && gameScreen.height) || Number(game.renderer.height) / gameResolution || height;
    const root = new PIXI.Container();
    root.name = "rural-football-runtime-loading";
    const backdrop = new PIXI.Graphics();
    backdrop.beginFill(0x8cad25, 1);
    backdrop.drawRect(0, 0, targetWidth, targetHeight);
    backdrop.endFill();
    root.addChild(backdrop);
    const ui = new PIXI.Container();
    const runtimeScale = Math.min(targetWidth / DESIGN_WIDTH, targetHeight / DESIGN_HEIGHT);
    ui.scale.set(runtimeScale, runtimeScale);
    ui.position.set((targetWidth - DESIGN_WIDTH * runtimeScale) / 2, (targetHeight - DESIGN_HEIGHT * runtimeScale) / 2);
    root.addChild(ui);

    const bg = new PIXI.Graphics();
    bg.beginFill(0x8cad25, 1);
    bg.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    bg.endFill();
    bg.lineStyle(2, 0xc5d96b, 0.12);
    for (let radius = 170; radius <= 650; radius += 120) bg.drawCircle(640, 360, radius);
    ui.addChild(bg);

    const runtimeSprite = (path, x, y, w, h) => {
      const texture = cachedTexture(path, true);
      const image = texture ? new PIXI.Sprite(texture) : PIXI.Sprite.fromImage(path);
      center(image, x, y);
      image.width = w;
      image.height = h;
      ui.addChild(image);
      return image;
    };
    runtimeSprite("shell-assets/brand-logo.png", 640, 277, 318, 318);
    const status = center(text(label || "正在加载比赛场景", 22, 0xf8f3d9, "800"), 640, 494);
    ui.addChild(status);
    const trackX = 314;
    const trackY = 557;
    const trackW = 652;
    const track = new PIXI.Graphics();
    track.lineStyle(8, 0x2e4412, 0.88);
    track.moveTo(trackX, trackY);
    track.lineTo(trackX + trackW, trackY);
    track.lineStyle(3, 0xf3f7d5, 1);
    track.moveTo(trackX, trackY - 3);
    track.lineTo(trackX + trackW, trackY - 3);
    ui.addChild(track);
    const fill = new PIXI.Graphics();
    ui.addChild(fill);
    const ball = runtimeSprite("shell-assets/football.png", trackX, trackY - 4, 94, 94);
    const pct = center(text("0%", 25, 0xf8f3d9, "800"), 640, 625);
    ui.addChild(pct);
    runtimeLoadingOverlay = { root, fill, ball, pct, trackX, trackY, trackW, timer: null };
    updateRuntimeLoadingProgress(progress == null ? 82 : progress);
    runtimeLoadingOverlay.timer = setInterval(() => {
      if (runtimeLoadingOverlay && runtimeLoadingOverlay.ball) runtimeLoadingOverlay.ball.rotation += 0.08;
    }, 50);
    game.stage.addChild(root);
    return true;
  }

  function teamCard(panelX, panelY, team, column, row, selected, disabled, side) {
    const cardW = 116;
    const cardH = 118;
    const gapX = 12;
    const gapY = 12;
    const x = panelX + 20 + column * (cardW + gapX);
    const y = panelY + 76 + row * (cardH + gapY);
    rounded(design, x + 2, y + 4, cardW, cardH, 15, 0x253314, disabled ? 0.04 : 0.11, 0x253314, 0, 0);
    rounded(design, x, y, cardW, cardH, 15, selected ? 0xf1f8e8 : 0xfffef8, disabled ? 0.34 : 1, selected ? 0x5d9038 : 0xcfc6ac, 0.9, selected ? 5 : 2.5);
    const fallback = new PIXI.Graphics();
    fallback.beginFill(team.color, disabled ? 0.08 : 0.13);
    fallback.drawCircle(x + cardW / 2, y + 42, 37);
    fallback.endFill();
    design.addChild(fallback);
    const portrait = sprite(portraitPaths[team.id] || `shell-assets/portraits/${team.id}.png`, x + cardW / 2, y + 42, 78, 78);
    portrait.alpha = disabled ? 0.26 : 1;
    const label = center(text(team.name, 20, disabled ? 0x7d856f : 0x31481f, "900"), x + cardW / 2, y + 92);
    design.addChild(label);
    if (team.country) {
      const subtitle = center(text(team.country, 13, disabled ? 0x9aa189 : 0x7c8a63, "700"), x + cardW / 2, y + 109);
      design.addChild(subtitle);
    }
    addHit(x, y, cardW, cardH, () => {
      if (disabled) return;
      if (side === "red") config.redTeam = team.id;
      else config.blueTeam = team.id;
      config = normalizeConfig(config);
      showHome(config);
    }, !disabled);
  }

  function compactButton(x, y, w, label, action, options) {
    const opts = options || {};
    const h = Math.max(30, Number(opts.height) || 36);
    const enabled = opts.enabled !== false;
    const active = !!opts.active;
    const fill = active ? 0x5d9038 : (enabled ? 0xfffef8 : 0xe7e7dc);
    const labelColor = active ? 0xfff7e2 : (enabled ? 0x31481f : 0x8d9285);
    rounded(design, x + 1, y + 2, w, h, h / 2, 0x253314, enabled ? 0.1 : 0.04, 0, 0, 0);
    rounded(design, x, y, w, h, h / 2, fill, 1, active ? 0x426d2a : 0xcbd4b8, 0.9, 2);
    const labelText = center(text(label, Number(opts.fontSize) || 15, labelColor, "800"), x + w / 2, y + h / 2);
    if (Number(labelText.width) > w - 18 && labelText.scale && labelText.scale.set) {
      const ratio = (w - 18) / Number(labelText.width);
      labelText.scale.set(ratio, ratio);
    }
    design.addChild(labelText);
    if (typeof action === "function") addHit(x, y, w, h, action, enabled);
  }

  function regionChip(x, y, w, label, action, selected) {
    const fill = selected ? 0xf1f8e8 : 0xfff9e7;
    const stroke = selected ? 0x8dac69 : 0xd7bd74;
    rounded(design, x, y, w, 44, 14, fill, 1, stroke, 0.9, 2);
    const chipText = center(text(label, Array.from(label).length > 7 ? 13 : 15, selected ? 0x405632 : 0x8b5a18, "800"), x + w / 2, y + 22);
    if (Number(chipText.width) > w - 14 && chipText.scale && chipText.scale.set) {
      const ratio = (w - 14) / Number(chipText.width);
      chipText.scale.set(ratio, ratio);
    }
    design.addChild(chipText);
    if (typeof action === "function") addHit(x, y, w, 44, action, true);
  }

  function homeLineup(region, side) {
    // `region` 保留在签名中，明确阵容不再因地区哈希发生重叠轮换；地区只影响球衣文字。
    void region;
    return HOME_PORTRAIT_PLAYERS[side === "blue" ? "blue" : "red"].slice();
  }

  function homeRegionPanel(panelX, panelY, panelW, side, region, tone) {
    const isRed = side === "red";
    const path = region.path;
    const leaf = regionLeaf(region);
    const titleColor = isRed ? 0xa44734 : 0x315a9b;
    const title = isRed ? "我的地区队" : "对手地区队";
    const fallback = isRed ? "请逐级选择地区" : "等待匹配对手";
    design.addChild(center(text(title, 25, titleColor, "900"), panelX + panelW / 2, panelY + 24));
    const name = center(text(regionTeamName(region, fallback), 23, 0x31481f, "900"), panelX + panelW / 2, panelY + 55);
    if (Number(name.width) > panelW - 70 && name.scale && name.scale.set) {
      const ratio = (panelW - 70) / Number(name.width);
      name.scale.set(ratio, ratio);
    }
    design.addChild(name);

    const controls = path.map((item, index) => ({
      label: item.shortName,
      selected: true,
      action: () => onAction("home-region-open", normalizeConfig(config), {
        side,
        level: item.level,
        parentCode: index > 0 ? path[index - 1].code : "",
      }),
    }));
    const next = nextRegionLevel(region);
    const allowNext = isRed || region.mode === "manual";
    if (next && allowNext) {
      controls.push({
        label: `＋ 选择${next.label}`,
        selected: false,
        action: () => onAction("home-region-open", normalizeConfig(config), {
          side,
          level: next.level,
          parentCode: leaf ? leaf.code : "",
        }),
      });
    }
    if (!controls.length) {
      controls.push({
        label: isRed ? "＋ 选择省份" : "主队选好后自动匹配",
        selected: false,
        action: isRed
          ? () => onAction("home-region-open", normalizeConfig(config), { side, level: "province", parentCode: "" })
          : null,
      });
    }
    // 四级入口始终同排可见；未选择的层级显示 XX，占位入口在上一级选好前锁定。
    const cascadeCount = REGION_LEVELS.length;
    const selGap = 8;
    const levelWidths = [78, 78, 82, 82];
    const customWidth = 158;
    const rerollWidth = 80;
    const showInlineCustom = isRed && path.length >= REGION_LEVELS.length;
    const showInlineReroll = !isRed;
    const cascadeWidths = levelWidths.slice(0, cascadeCount);
    const cascadeWidth = cascadeWidths.reduce((sum, value) => sum + value, 0)
      + Math.max(0, cascadeCount - 1) * selGap;
    const rowWidth = cascadeWidth
      + (showInlineCustom ? selGap + customWidth : 0)
      + (showInlineReroll ? selGap + rerollWidth : 0);
    const selX = panelX + (panelW - rowWidth) / 2;
    let cursorX = selX;
    for (let index = 0; index < cascadeCount; index += 1) {
      const filled = path[index];
      const selW = cascadeWidths[index];
      const chipX = cursorX;
      const unlocked = index === 0 || !!path[index - 1];
      const placeholders = ["XX省", "XX市", "XX县", "XX镇"];
      regionChip(chipX, panelY + 78, selW, filled ? filled.shortName : placeholders[index], unlocked ? () => {
        dropdownRequest = {
          side,
          levelIndex: index,
          title: `选择${REGION_LEVELS[index].label}`,
          anchorX: chipX + selW / 2,
          anchorY: panelY + 78 + 50,
        };
        // 点下的瞬间先同步弹出"加载中"浮层，消灭"等数据回来才出现"的竞态缝隙；
        // 数据到达后由 main 的 showRegionDropdown 填充条目
        showRegionDropdown({ loading: true, entries: [] });
        onAction("home-region-dropdown", normalizeConfig(config), {
          side,
          levelIndex: index,
          parentCode: index > 0 ? path[index - 1].code : "",
        });
      } : null, !!filled);
      cursorX += selW + selGap;
    }
    if (showInlineCustom) {
      regionChip(cursorX, panelY + 78, customWidth, region.customName || "自定义村名/队名", () => {
        onAction("home-region-custom", normalizeConfig(config), { side });
      }, !!region.customName);
      cursorX += customWidth + selGap;
    }
    if (showInlineReroll) {
      compactButton(cursorX, panelY + 82, rerollWidth, "换一个", () => {
        onAction("home-opponent-reroll", normalizeConfig(config), { side });
      }, { enabled: !!leaf, fontSize: 14, height: 36 });
    }
    if (isRed) {
      if (!showInlineCustom) {
        design.addChild(center(text("逐级下拉选择家乡地区，选完自动匹配对手", 14, 0x81906f, "700"), panelX + panelW / 2, panelY + 159));
      }
    }

    const lineup = homeLineup(region, side);
    const cardW = 76;
    const gap = 10;
    const lineupW = lineup.length * cardW + (lineup.length - 1) * gap;
    const lineupX = panelX + (panelW - lineupW) / 2;
    const lineupY = panelY + 190;
    const jerseyLabel = jerseyShortName(region);
    lineup.forEach((player, index) => {
      const x = lineupX + index * (cardW + gap);
      rounded(design, x + 1, lineupY + 3, cardW, 136, 17, 0x253314, 0.09, 0, 0, 0);
      rounded(design, x, lineupY, cardW, 136, 17, 0xf4f8e9, 1, tone, 0.42, 2);
      const portrait = sprite(portraitPaths[player.id] || `shell-assets/squad/${player.id}.png`, x + cardW / 2, lineupY + 54, 72, 84);
      // 人物头像原图统一面朝左：左侧红方水平翻转为面朝右，右侧蓝方保持面朝左，双方面对面
      if (isRed) portrait.scale.x = -portrait.scale.x;
      portrait.alpha = 1;
      if (isRed && index === 0) {
        rounded(design, x + cardW - 48, lineupY + 5, 46, 19, 9, 0xf2b632, 1, 0xb66b18, 0.9, 1.5);
        design.addChild(center(text("自定义", 10, 0x4b3413, "900"), x + cardW - 25, lineupY + 14.5));
        addHit(x + cardW - 52, lineupY + 1, 54, 27, () => {
          onAction("home-captain-custom", normalizeConfig(config), {
            side: "red",
            playerId: player.id,
            profile: config.redCaptainProfile,
          });
        }, true);
      }
      rounded(design, x + 8, lineupY + 76, cardW - 16, 22, 9, tone, 0.94, 0xffffff, 0.38, 1);
      const jersey = center(text(jerseyLabel, Array.from(jerseyLabel).length > 3 ? 11 : 13, 0xfff8db, "900"), x + cardW / 2, lineupY + 87);
      if (Number(jersey.width) > cardW - 22 && jersey.scale && jersey.scale.set) {
        const ratio = (cardW - 22) / Number(jersey.width);
        jersey.scale.set(ratio, ratio);
      }
      design.addChild(jersey);
      const number = center(text(String(player.number), 15, 0x31481f, "900"), x + cardW / 2, lineupY + 116);
      design.addChild(number);
    });
    design.addChild(center(text("6名首发球员 · 地区变化时队服名称同步更新", 13, 0x81906f, "700"), panelX + panelW / 2, panelY + 350));
  }

  function settingButton(x, y, w, label, action, active) {
    rounded(design, x + 1.5, y + 3, w, 48, 24, 0x253314, 0.1, 0x253314, 0, 0);
    rounded(design, x, y, w, 48, 24, active ? 0x5d9038 : 0xfffef8, 1, active ? 0x426d2a : 0xcfc6ac, 0.82, 2.5);
    const t = center(text(label, 19, active ? 0xfff7e2 : 0x294019, "800"), x + w / 2, y + 24);
    design.addChild(t);
    addHit(x, y, w, 48, action, true);
  }

  function formationPitch(x, y, w, h, formationName, tone) {
    const formation = FORMATIONS.find((item) => item.name === formationName) || FORMATIONS[0];
    const pitch = new PIXI.Graphics();
    pitch.lineStyle(2.5, 0xffffff, 0.86);
    pitch.beginFill(0x6aa843, 1);
    pitch.drawRoundedRect(x, y, w, h, 16);
    pitch.endFill();
    pitch.lineStyle(1.7, 0xffffff, 0.82);
    pitch.drawRoundedRect(x + 7, y + 7, w - 14, h - 14, 10);
    pitch.moveTo(x + 7, y + h / 2);
    pitch.lineTo(x + w - 7, y + h / 2);
    pitch.drawCircle(x + w / 2, y + h / 2, Math.min(18, w * 0.14));
    pitch.drawRect(x + w / 2 - w * 0.2, y + 7, w * 0.4, Math.min(20, h * 0.1));
    pitch.drawRect(x + w / 2 - w * 0.2, y + h - Math.min(27, h * 0.13), w * 0.4, Math.min(20, h * 0.1));
    const dotColor = tone === "blue" ? 0x3f7fb1 : 0xd8443a;
    pitch.lineStyle(2, 0xffffff, 0.96);
    for (const spot of formation.spots) {
      const col = spot[0];
      const lane = spot[1];
      const px = x + 16 + ((lane - 1) / 6) * (w - 32);
      const py = y + 24 + (1 - (col - 3) / 4) * (h - 56);
      pitch.beginFill(dotColor, 1);
      pitch.drawCircle(px, py, Math.max(5.5, Math.min(8, w * 0.06)));
      pitch.endFill();
    }
    pitch.beginFill(0xefc23a, 1);
    pitch.drawCircle(x + w / 2, y + h - 16, Math.max(5.5, Math.min(8, w * 0.06)));
    pitch.endFill();
    design.addChild(pitch);
  }

  function actionButton(x, y, w, label, action, options) {
    const opts = options || {};
    const primary = !!opts.primary;
    const enabled = opts.enabled !== false;
    // 返回/取消类操作不能被异步授权、网络失败等遗留的按钮锁永久吞掉。
    const bypassTransitionLock = !!opts.bypassTransitionLock;
    const releaseLockAfterAction = !!opts.releaseLockAfterAction;
    const h = opts.height || 50;
    const radius = h / 2;
    const shadow = rounded(
      design,
      x + (primary ? 3 : 2),
      y + (primary ? 7 : 5),
      w,
      h,
      radius,
      enabled ? (primary ? 0x6f430a : 0x253314) : 0x45483f,
      enabled ? (primary ? 0.3 : 0.18) : 0.08,
      0x253314,
      0,
      0,
    );
    const bg = rounded(
      design,
      x,
      y,
      w,
      h,
      radius,
      enabled ? (primary ? 0xffc13d : 0xfffef8) : 0xd5d4ca,
      1,
      enabled ? (primary ? 0xd97924 : 0xcfc6ac) : 0xa5a69e,
      primary ? 1 : 0.88,
      primary ? 3.5 : 2.5,
    );
    const labelText = center(text(label, primary ? 26 : 21, enabled ? (primary ? 0x314518 : 0x31481f) : 0x777970, "900"), x + w / 2, y + h / 2);
    design.addChild(labelText);
    addHit(x, y, w, h, () => {
      if (transitionLocked && !bypassTransitionLock) return;
      if (!bypassTransitionLock) transitionLocked = true;
      bg.clear();
      bg.lineStyle(primary ? 4 : 3, primary ? 0xb85f19 : 0x426d2a, 1);
      bg.beginFill(primary ? 0xf2a62a : 0x5d9038, 1);
      bg.drawRoundedRect(x, y, w, h, radius);
      bg.endFill();
      labelText.style.fill = primary ? 0x314518 : 0xfff7e2;
      shadow.alpha = primary ? 0.16 : 0.08;
      renderer.render(stage);
      setTimeout(() => {
        action();
        if (releaseLockAfterAction) transitionLocked = false;
      }, 110);
    }, enabled);
  }

  function showHome(nextConfig) {
    config = normalizeConfig(nextConfig || config);
    config.redRegion = normalizeHomeRegion(config.redRegion);
    config.blueRegion = normalizeHomeRegion(config.blueRegion);
    screen = "home";
    suspended = false;
    transitionLocked = false;
    preMatchState = null;
    modeHubState = null;
    clearDesign();
    addBackground();
    const panelY = 50;
    const panelW = 594;
    const panelH = 398;
    const leftX = 18;
    const rightX = 668;
    rounded(design, leftX + 4, panelY + 7, panelW, panelH, 27, 0x263515, 0.18, 0x263515, 0, 0);
    rounded(design, rightX + 4, panelY + 7, panelW, panelH, 27, 0x263515, 0.18, 0x263515, 0, 0);
    rounded(design, leftX, panelY, panelW, panelH, 25, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    rounded(design, rightX, panelY, panelW, panelH, 25, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    homeRegionPanel(leftX, panelY, panelW, "red", config.redRegion, 0xa44734);
    homeRegionPanel(rightX, panelY, panelW, "blue", config.blueRegion, 0x315a9b);
    design.addChild(center(text("VS", 42, 0xfff8d7, "900"), 640, panelY + 235));
    const diff = DIFFICULTIES.find((item) => item.value === config.ai);
    const matchTime = TIMES.find((item) => item.value === config.time);
    const settingY = 470;
    settingButton(430, settingY, 190, `难度  ${diff.label}`, () => {
      config.ai = cycle(DIFFICULTIES, config.ai, "value", 1);
      showHome(config);
    });
    settingButton(660, settingY, 190, `时长  ${matchTime.label}`, () => {
      config.time = cycle(TIMES, config.time, "value", 1);
      showHome(config);
    });

    const actionY = 552;
    actionButton(105, actionY, 295, "挑战玩法", () => showModeHub("challenge", config), { height: 60 });
    actionButton(430, actionY - 7, 420, "立即开赛", () => onAction("ai", normalizeConfig(Object.assign({}, config, { mode: "ai" }))), { primary: true, height: 70 });
    actionButton(880, actionY, 295, "战绩与好友", () => showModeHub("social", config), { height: 60 });
    const hint = center(text("阵型和操作说明会在开赛前显示", 18, 0xe7f0b3, "700"), 640, 655);
    design.addChild(hint);
  }

  function showModeHub(kind, nextConfig) {
    config = normalizeConfig(nextConfig || config);
    const challenge = kind === "challenge";
    const season = campaignState.season;
    const daily = campaignState.daily;
    showHome(config);
    screen = "mode-hub";
    transitionLocked = false;
    modeHubState = challenge ? "challenge" : "social";
    hitAreas = [];

    const shade = new PIXI.Graphics();
    shade.beginFill(0x0a1206, 0.62);
    shade.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    shade.endFill();
    design.addChild(shade);
    const cardX = 244;
    const cardY = 106;
    const cardW = 792;
    const cardH = 498;
    rounded(design, cardX + 6, cardY + 9, cardW, cardH, 32, 0x111b0b, 0.34, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 30, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    design.addChild(center(text(challenge ? "挑战玩法" : "战绩与好友", 34, 0x31481f, "900"), 640, cardY + 52));
    design.addChild(center(text(challenge ? "选一个目标，开始一场特别比赛" : "看看战绩，或和好友一起踢", 17, 0x71805e, "700"), 640, cardY + 82));

    if (challenge) {
      const seasonStatus = season.complete
        ? `第 ${season.seasonNumber + 1} 赛季已解锁`
        : `第 ${season.completedRounds + 1}/${season.totalRounds} 场${season.opponentName ? ` · 对阵${season.opponentName}` : ""}`;
      const dailyStatus = daily.completed
        ? "今天已经完成，可继续刷新成绩"
        : `${daily.theme}${daily.opponentName ? ` · 对阵${daily.opponentName}` : ""}`;
      actionButton(cardX + 86, cardY + 136, cardW - 172, "赛季征程", () => onAction("season", normalizeConfig(config)), { height: 64 });
      design.addChild(center(text(seasonStatus, 15, 0x71805e, "700"), 640, cardY + 220));
      actionButton(cardX + 86, cardY + 254, cardW - 172, "每日挑战", () => onAction("daily", normalizeConfig(config)), { height: 64 });
      design.addChild(center(text(dailyStatus, 15, 0x71805e, "700"), 640, cardY + 338));
    } else {
      actionButton(cardX + 84, cardY + 145, 292, "排行榜", () => onAction("leaderboard", normalizeConfig(config)), { height: 60 });
      actionButton(cardX + 416, cardY + 145, 292, "观看对战", () => onAction("watch", normalizeConfig(Object.assign({}, config, { mode: "watch" }))), { height: 60 });
      if (friendEntryEnabled) {
        actionButton(cardX + 84, cardY + 246, cardW - 168, "邀请好友对战", () => onAction("friend-prepare", normalizeConfig(Object.assign({}, config, { mode: "friend" }))), { height: 60 });
      } else {
        design.addChild(center(text("好友对战将在服务部署完成后开放", 16, 0x9aa383, "700"), 640, cardY + 282));
      }
    }
    actionButton(cardX + 242, cardY + 414, 308, "返回选队", () => showHome(config), {
      height: 50,
      bypassTransitionLock: true,
      releaseLockAfterAction: true,
    });
  }

  function showPreMatch(nextConfig, nextState) {
    config = normalizeConfig(nextConfig || config);
    const input = nextState && typeof nextState === "object" ? nextState : {};
    const state = {
      kind: typeof input.kind === "string" ? input.kind : "ai",
      title: typeof input.title === "string" ? input.title.slice(0, 18) : "开赛前设置",
      subtitle: typeof input.subtitle === "string" ? input.subtitle.slice(0, 36) : "确认双方阵型后开始比赛",
      lockedRules: !!input.lockedRules,
      showTutorial: !hasSeenTutorial(),
    };
    showHome(config);
    screen = "prematch";
    transitionLocked = false;
    preMatchState = state;
    hitAreas = [];

    const shade = new PIXI.Graphics();
    shade.beginFill(0x0a1206, 0.62);
    shade.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    shade.endFill();
    design.addChild(shade);
    const cardX = 90;
    const cardY = 20;
    const cardW = 1100;
    const cardH = 680;
    rounded(design, cardX + 7, cardY + 10, cardW, cardH, 34, 0x111b0b, 0.34, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 32, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    design.addChild(center(text(state.title, 36, 0x31481f, "900"), 640, cardY + 47));
    design.addChild(center(text(state.subtitle, 18, 0x71805e, "700"), 640, cardY + 77));
    design.addChild(center(text("乡村友谊赛规则：无越位、无犯规", 15, 0x8a976f, "700"), 640, cardY + 101));

    const formationPanelX = 120;
    const controlsPanelX = 660;
    const contentY = cardY + 118;
    const contentW = 500;
    const contentH = 438;
    rounded(design, formationPanelX, contentY, contentW, contentH, 24, 0xf2f7e5, 1, 0xc8d5ad, 1, 2.5);
    rounded(design, controlsPanelX, contentY, contentW, contentH, 24, 0xf2f7e5, 1, 0xc8d5ad, 1, 2.5);
    design.addChild(center(text("选择阵型", 28, 0xa44734, "900"), formationPanelX + contentW / 2, contentY + 35));
    design.addChild(center(text("操作教学", 28, 0x315a9b, "900"), controlsPanelX + contentW / 2, contentY + 35));

    formationPitch(formationPanelX + 28, contentY + 78, 170, 304, config.redFormation, "red");
    design.addChild(center(text(config.redFormation, 23, 0xa44734, "900"), formationPanelX + 113, contentY + 402));
    const formationButtonX = formationPanelX + 218;
    const formationButtonY = contentY + 94;
    FORMATIONS.forEach((item, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const buttonX = formationButtonX + column * 92;
      const buttonY = formationButtonY + row * 76;
      const active = item.name === config.redFormation;
      if (active) {
        rounded(design, buttonX + 2, buttonY + 4, 86, 56, 28, 0x253314, 0.16, 0, 0, 0);
        rounded(design, buttonX, buttonY, 86, 56, 28, 0x5d9038, 1, 0x426d2a, 1, 2.5);
        design.addChild(center(text(item.name, 18, 0xfff7e2, "900"), buttonX + 43, buttonY + 28));
      } else {
        actionButton(buttonX, buttonY, 84, item.name, () => {
          config.redFormation = item.name;
          showPreMatch(config, state);
        }, { height: 56 });
      }
    });
    design.addChild(center(text(`对手阵型  ${config.blueFormation}`, 18, 0x71805e, "800"), formationPanelX + 355, contentY + 318));

    const joystickX = controlsPanelX + 145;
    const joystickY = contentY + 230;
    const joystick = new PIXI.Graphics();
    joystick.lineStyle(5, 0x5d9038, 0.8);
    joystick.beginFill(0xffffff, 0.78);
    joystick.drawCircle(joystickX, joystickY, 100);
    joystick.endFill();
    joystick.lineStyle(3, 0xb5c995, 0.85);
    joystick.drawCircle(joystickX, joystickY, 66);
    joystick.beginFill(0x5d9038, 1);
    joystick.drawCircle(joystickX - 20, joystickY + 19, 35);
    joystick.endFill();
    design.addChild(joystick);
    design.addChild(center(text("左手", 20, 0x7c8a63, "800"), joystickX, contentY + 371));

    function controlKey(cx, cy, radius, label, fill, labelSize) {
      const key = new PIXI.Graphics();
      key.lineStyle(3, 0x426d2a, 0.82);
      key.beginFill(fill, 1);
      key.drawCircle(cx, cy, radius);
      key.endFill();
      design.addChild(key);
      design.addChild(center(text(label, labelSize || 14, 0x31481f, "900"), cx, cy));
    }
    const keyX = controlsPanelX + 372;
    const keyY = contentY + 220;
    controlKey(keyX, keyY - 78, 36, "挑传", 0xf1f8e8, 15);
    controlKey(keyX - 78, keyY, 36, "传球", 0xf1f8e8, 15);
    controlKey(keyX + 78, keyY, 36, "射门", 0xffe6b6, 15);
    controlKey(keyX, keyY + 78, 36, "铲球", 0xf1f8e8, 15);
    controlKey(keyX, keyY, 44, "冲刺", 0xf9c44d, 17);
    design.addChild(center(text("右手", 20, 0x7c8a63, "800"), keyX, contentY + 371));

    actionButton(340, cardY + 584, 270, "返回选队", () => {
      showHome(config);
      onAction("prematch-cancel", normalizeConfig(config), state);
    }, { height: 58, bypassTransitionLock: true, releaseLockAfterAction: true });
    actionButton(670, cardY + 584, 270, state.showTutorial ? "开始踢球" : "开始比赛", () => {
      if (state.showTutorial) markTutorialSeen();
      onAction("prematch-start", normalizeConfig(config), state);
    }, { primary: true, height: 58 });
  }

  function normalizedLeaderboardModel(input) {
    const model = input && typeof input === "object" ? input : {};
    const stats = model.stats && typeof model.stats === "object" ? model.stats : {};
    const profile = model.profile && typeof model.profile === "object" ? model.profile : {};
    const values = model.values && typeof model.values === "object" ? model.values : {};
    const metrics = Array.isArray(model.metrics) ? model.metrics : [];
    const region = model.region && typeof model.region === "object" ? model.region : {};
    const regionScope = region.scope && typeof region.scope === "object" ? region.scope : {};
    const remoteScope = model.remoteScope && typeof model.remoteScope === "object" ? model.remoteScope : {};
    return {
      profile: {
        nickname: typeof profile.nickname === "string" ? profile.nickname.slice(0, 16) : "",
        avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : "",
      },
      region: region.name && region.code ? {
        code: typeof region.code === "string" ? region.code.slice(0, 18) : "",
        name: typeof region.name === "string" ? region.name.slice(0, 18) : "",
        level: typeof region.level === "string" ? region.level : "",
        scope: {
          key: typeof regionScope.key === "string" ? regionScope.key.slice(0, 32) : "",
          title: typeof regionScope.title === "string" ? regionScope.title.slice(0, 24) : "",
        },
      } : null,
      stats: {
        matches: Math.max(0, Number(stats.matches) || 0),
        wins: Math.max(0, Number(stats.wins) || 0),
        draws: Math.max(0, Number(stats.draws) || 0),
        losses: Math.max(0, Number(stats.losses) || 0),
        goalsFor: Math.max(0, Number(stats.goalsFor) || 0),
        goalsAgainst: Math.max(0, Number(stats.goalsAgainst) || 0),
        cleanSheets: Math.max(0, Number(stats.cleanSheets) || 0),
        points: Math.max(0, Number(stats.points) || 0),
        bestWinStreak: Math.max(0, Number(stats.bestWinStreak) || 0),
      },
      values,
      metrics: metrics.filter((metric) => metric && typeof metric.id === "string").slice(0, 6),
      qualified: !!model.qualified,
      matchesUntilQualified: Math.max(0, Number(model.matchesUntilQualified) || 0),
      onlineEnabled: !!model.onlineEnabled,
      online: !!model.online,
      remoteMetric: typeof model.remoteMetric === "string" ? model.remoteMetric : "",
      remoteScope: {
        key: typeof remoteScope.key === "string" ? remoteScope.key.slice(0, 32) : "",
        title: typeof remoteScope.title === "string" ? remoteScope.title.slice(0, 24) : "",
      },
      remoteSelf: model.remoteSelf && typeof model.remoteSelf === "object" ? model.remoteSelf : null,
      remoteRows: Array.isArray(model.remoteRows)
        ? model.remoteRows.filter((row) => row && typeof row.nickname === "string").slice(0, 5)
        : [],
    };
  }

  function showLeaderboard(nextModel) {
    leaderboardState.model = normalizedLeaderboardModel(nextModel || leaderboardState.model);
    const model = leaderboardState.model;
    if (!model.metrics.some((metric) => metric.id === leaderboardState.metric)) {
      leaderboardState.metric = model.metrics[0] && model.metrics[0].id || "points";
    }
    showHome(config);
    screen = "leaderboard";
    transitionLocked = false;
    hitAreas = [];

    const shade = new PIXI.Graphics();
    shade.beginFill(0x15220e, 0.78);
    shade.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    shade.endFill();
    design.addChild(shade);
    const cardX = 136;
    const cardY = 56;
    const cardW = 1008;
    const cardH = 608;
    rounded(design, cardX + 8, cardY + 11, cardW, cardH, 30, 0x111b0b, 0.32, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 28, 0xfffef8, 1, 0xe2d7b9, 1, 4);
    const title = center(text("乡村足球赛 · 排行榜", 30, 0x31481f, "900"), 640, cardY + 42);
    design.addChild(title);

    const profileX = cardX + 42;
    const profileY = cardY + 88;
    const profileW = 248;
    rounded(design, profileX, profileY, profileW, 428, 20, 0xf2f7e5, 1, 0xc8d5ad, 1, 2.5);
    const avatar = new PIXI.Graphics();
    avatar.beginFill(0x6aa843, 0.18);
    avatar.drawCircle(profileX + profileW / 2, profileY + 67, 43);
    avatar.endFill();
    design.addChild(avatar);
    if (model.profile.avatarUrl) {
      const profileAvatar = sprite(model.profile.avatarUrl, profileX + profileW / 2, profileY + 67, 78, 78);
      profileAvatar.alpha = 0.98;
    }
    const nickname = model.profile.nickname || (model.onlineEnabled ? "未加入排行榜" : "本机战绩");
    const nicknameText = center(text(nickname, 21, 0x31481f, "900"), profileX + profileW / 2, profileY + 130);
    design.addChild(nicknameText);
    const total = center(text(`已完成 ${model.stats.matches} 场`, 15, 0x71805e, "700"), profileX + profileW / 2, profileY + 157);
    design.addChild(total);
    const regionText = center(text(model.region ? `地区队：${model.region.name}` : "尚未选择地区队", 15, model.region ? 0x5d9038 : 0x9aa383, "800"), profileX + profileW / 2, profileY + 182);
    design.addChild(regionText);
    const overview = [
      ["积分", model.stats.points],
      ["胜 / 平 / 负", `${model.stats.wins} / ${model.stats.draws} / ${model.stats.losses}`],
      ["进球 / 失球", `${model.stats.goalsFor} / ${model.stats.goalsAgainst}`],
      ["最佳连胜", model.stats.bestWinStreak],
      ["零封", model.stats.cleanSheets],
    ];
    overview.forEach(([label, value], index) => {
      const y = profileY + 222 + index * 38;
      const left = text(label, 15, 0x71805e, "700");
      left.position.set(profileX + 24, y);
      const right = text(String(value), 16, 0x31481f, "900");
      if (right.anchor && right.anchor.set) right.anchor.set(1, 0);
      right.position.set(profileX + profileW - 24, y);
      design.addChild(left, right);
    });
    if (model.onlineEnabled && !model.profile.nickname) {
      actionButton(profileX + 23, profileY + 354, profileW - 46, "加入排行榜", () => onAction("leaderboard-profile", normalizeConfig(config)), { primary: true, height: 48, releaseLockAfterAction: true });
    } else if (model.profile.nickname) {
      actionButton(profileX + 23, profileY + 326, profileW - 46, model.region ? "更换地区队" : "选择地区队", () => onAction("leaderboard-region-open", normalizeConfig(config)), { primary: !model.region, height: 42, releaseLockAfterAction: true });
      actionButton(profileX + 23, profileY + 378, profileW - 46, "删除榜单资料", () => onAction("leaderboard-delete-account", normalizeConfig(config)), { height: 34, releaseLockAfterAction: true });
    }

    const contentX = cardX + 324;
    const contentW = cardW - 366;
    const tabs = model.metrics.length ? model.metrics : [{ id: "points", label: "积分", suffix: "" }];
    const tabW = Math.floor((contentW - 10 * (tabs.length - 1)) / tabs.length);
    tabs.forEach((metric, index) => {
      const x = contentX + index * (tabW + 10);
      const active = leaderboardState.metric === metric.id;
      rounded(design, x, profileY, tabW, 43, 19, active ? 0x5d9038 : 0xf8faef, 1, active ? 0x426d2a : 0xcbd7b2, 1, 2);
      const label = center(text(metric.label, 16, active ? 0xfff7e2 : 0x405632, "800"), x + tabW / 2, profileY + 21);
      design.addChild(label);
      addHit(x, profileY, tabW, 43, () => {
        leaderboardState.metric = metric.id;
        showLeaderboard(model);
        onAction("leaderboard-metric", normalizeConfig(config), { metric: metric.id });
      }, true);
    });
    const activeMetric = tabs.find((metric) => metric.id === leaderboardState.metric) || tabs[0];
    const currentValue = model.values[activeMetric.id] == null ? 0 : model.values[activeMetric.id];
    const scopeTitle = model.remoteScope.title || (model.region && model.region.scope.title) || "全国省队榜";
    const heading = center(text(`${scopeTitle} · ${activeMetric.label}`, 25, 0x31481f, "900"), contentX + contentW / 2, profileY + 99);
    const value = center(text(`${currentValue}${activeMetric.suffix || ""}`, 54, 0x5d9038, "900"), contentX + contentW / 2, profileY + 157);
    design.addChild(heading, value);
    const sub = center(text(
      !model.onlineEnabled
        ? "地区赛季榜已载入；联网后真实战绩将持续更新"
        : model.qualified
          ? model.region ? "已加入地区队；每场正式单机比赛都会汇总到地区战队" : "选择地区队后，战绩会汇总到你的家乡队"
          : `再完成 ${model.matchesUntilQualified} 场即可进入地区榜`,
      17,
      0x71805e,
      "700",
    ), contentX + contentW / 2, profileY + 205);
    design.addChild(sub);
    rounded(design, contentX, profileY + 238, contentW, 190, 18, 0xf2f7e5, 1, 0xc8d5ad, 1, 2);
    const rankTitle = center(text(model.remoteRows.length ? scopeTitle : (model.onlineEnabled ? scopeTitle : "本机统计"), 21, 0x31481f, "900"), contentX + contentW / 2, profileY + 274);
    design.addChild(rankTitle);
    const onlineRows = model.remoteMetric === activeMetric.id ? model.remoteRows : [];
    if (onlineRows.length) {
      onlineRows.slice(0, 5).forEach((row, index) => {
        const y = profileY + 304 + index * 27;
        const rank = text(String(row.rank || index + 1), 16, index === 0 ? 0xc4821b : 0x71805e, "900");
        rank.position.set(contentX + 26, y);
        const name = text(row.nickname, 16, row.self ? 0x5d9038 : 0x31481f, "800");
        name.position.set(contentX + 68, y);
        const valueText = text(`${row.value}${activeMetric.suffix || ""}`, 17, 0x31481f, "900");
        if (valueText.anchor && valueText.anchor.set) valueText.anchor.set(1, 0);
        valueText.position.set(contentX + contentW - 28, y);
        design.addChild(rank, name, valueText);
      });
      if (model.remoteSelf && !onlineRows.some((row) => row.self)) {
        const selfText = center(text(`我的地区队排名：第 ${model.remoteSelf.rank} 名`, 14, 0x71805e, "700"), contentX + contentW / 2, profileY + 408);
        design.addChild(selfText);
      }
    } else {
      const status = center(text(
        !model.onlineEnabled
          ? "联网地区榜首发关闭；当前所有战绩已安全保存在本机。"
          : model.online
            ? "暂无已达标的全服榜数据；继续完成正式单机比赛吧。"
            : "联网榜暂时不可访问；当前战绩已安全保存在本机。",
        16,
        0x71805e,
        "700",
      ), contentX + contentW / 2, profileY + 326);
      const honest = center(text("完成正式比赛后，地区队排名会自动更新", 14, 0x9aa383, "700"), contentX + contentW / 2, profileY + 357);
      design.addChild(status, honest);
    }
    actionButton(contentX + 130, profileY + 465, contentW - 260, "返回选队", () => showHome(config), {
      height: 48,
      bypassTransitionLock: true,
      releaseLockAfterAction: true,
    });
  }

  function normalizeRegionPicker(input) {
    const source = input && typeof input === "object" ? input : {};
    const normalizeRows = (rows, max) => (Array.isArray(rows) ? rows : [])
      .filter((item) => item && typeof item.code === "string" && typeof item.name === "string")
      .slice(0, max)
      .map((item) => ({
        code: item.code.slice(0, 18),
        name: item.name.slice(0, 18),
        shortName: typeof item.shortName === "string" ? item.shortName.slice(0, 12) : item.name.slice(0, 12),
        level: typeof item.level === "string" ? item.level : "",
      }));
    return {
      path: normalizeRows(source.path, 4),
      entries: normalizeRows(source.entries, 120),
      page: Math.max(0, Math.floor(Number(source.page) || 0)),
    };
  }

  function showRegionPicker(nextState) {
    regionPickerState = normalizeRegionPicker(nextState || regionPickerState);
    const state = regionPickerState;
    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(state.entries.length / pageSize));
    state.page = Math.min(state.page, totalPages - 1);
    showHome(config);
    screen = "region-picker";
    transitionLocked = false;
    hitAreas = [];
    const shade = new PIXI.Graphics();
    shade.beginFill(0x15220e, 0.78);
    shade.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    shade.endFill();
    design.addChild(shade);
    const cardX = 72;
    const cardY = 42;
    const cardW = 1136;
    const cardH = 636;
    rounded(design, cardX, cardY, cardW, cardH, 28, 0xfffef8, 1, 0xe2d7b9, 1, 4);
    const current = state.path[state.path.length - 1] || null;
    design.addChild(center(text(current ? `选择 ${current.shortName} 的下一级地区` : "选择你的地区队", 30, 0x31481f, "900"), 640, cardY + 42));
    const hint = current
      ? `可直接确认“${current.shortName}”参赛，或继续选择更细一级`
      : "自愿选择公开的家乡战队；不读取 GPS，不展示详细住址";
    design.addChild(center(text(hint, 16, 0x71805e, "700"), 640, cardY + 76));
    const trail = state.path.length ? state.path.map((item) => item.shortName).join("  ›  ") : "全国";
    rounded(design, cardX + 42, cardY + 102, cardW - 84, 44, 17, 0xf2f7e5, 1, 0xc8d5ad, 1, 2);
    design.addChild(center(text(trail, 18, 0x405632, "800"), 640, cardY + 124));
    const choices = state.entries.slice(state.page * pageSize, state.page * pageSize + pageSize);
    if (choices.length) {
      const cols = 6;
      const cellW = 158;
      const cellH = 52;
      const gapX = 14;
      const gapY = 10;
      choices.forEach((item, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = cardX + 55 + col * (cellW + gapX);
        const y = cardY + 170 + row * (cellH + gapY);
        rounded(design, x, y, cellW, cellH, 16, 0xf8faef, 1, 0xcbd7b2, 1, 2);
        design.addChild(center(text(item.shortName, item.shortName.length > 5 ? 15 : 18, 0x31481f, "800"), x + cellW / 2, y + cellH / 2));
        addHit(x, y, cellW, cellH, () => onAction("leaderboard-region-step", normalizeConfig(config), { code: item.code }), true);
      });
    } else {
      design.addChild(center(text("该地区暂未收录下一级官方行政区", 19, 0x71805e, "700"), 640, cardY + 330));
    }
    if (totalPages > 1) {
      actionButton(cardX + 230, cardY + 515, 150, "上一页", () => onAction("leaderboard-region-page", normalizeConfig(config), { page: state.page - 1 }), { enabled: state.page > 0, height: 46, bypassTransitionLock: true });
      design.addChild(center(text(`${state.page + 1} / ${totalPages}`, 16, 0x71805e, "800"), 640, cardY + 538));
      actionButton(cardX + cardW - 380, cardY + 515, 150, "下一页", () => onAction("leaderboard-region-page", normalizeConfig(config), { page: state.page + 1 }), { enabled: state.page + 1 < totalPages, height: 46, bypassTransitionLock: true });
    }
    actionButton(cardX + 90, cardY + 570, 250, state.path.length ? "上一级" : "返回排行榜", () => onAction(state.path.length ? "leaderboard-region-back" : "leaderboard-region-cancel", normalizeConfig(config)), { height: 48, bypassTransitionLock: true, releaseLockAfterAction: true });
    if (current) actionButton(cardX + cardW - 405, cardY + 570, 315, `代表 ${current.shortName} 参赛`, () => onAction("leaderboard-region-confirm", normalizeConfig(config), { code: current.code }), { primary: true, height: 48, releaseLockAfterAction: true });
  }

  const DROPDOWN_ROW_H = 44;
  const DROPDOWN_HEADER_H = 46;

  function dropdownCardGeometry(state) {
    const visible = Math.max(1, Math.min(6, state.entries.length || 1));
    const listH = visible * DROPDOWN_ROW_H;
    const cardW = 300;
    const cardH = DROPDOWN_HEADER_H + listH + 12;
    const anchorX = Number(state.anchorX) || 640;
    const anchorY = Number(state.anchorY) || 200;
    const cardX = Math.max(16, Math.min(anchorX - cardW / 2, DESIGN_WIDTH - cardW - 16));
    const cardY = Math.max(16, Math.min(anchorY, DESIGN_HEIGHT - cardH - 16));
    return { cardX, cardY, cardW, cardH, listH };
  }

  function renderRegionDropdown() {
    const state = dropdownState;
    if (!state) return;
    if (dropdownLayer && dropdownLayer.parent) dropdownLayer.parent.removeChild(dropdownLayer);
    if (dropdownLayer && dropdownLayer.destroy) dropdownLayer.destroy({ children: true });
    const layer = new PIXI.Container();
    dropdownLayer = layer;
    design.addChild(layer);
    const geo = dropdownCardGeometry(state);
    rounded(layer, geo.cardX + 3, geo.cardY + 4, geo.cardW, geo.cardH, 18, 0x111b0b, 0.28, 0, 0, 0);
    rounded(layer, geo.cardX, geo.cardY, geo.cardW, geo.cardH, 16, 0xfffef8, 1, 0xd9cdae, 1, 3);
    layer.addChild(center(text(state.title || "选择地区", 18, 0x31481f, "900"), geo.cardX + geo.cardW / 2, geo.cardY + 24));
    layer.addChild(center(text("×", 22, 0x8b5a18, "900"), geo.cardX + geo.cardW - 26, geo.cardY + 23));
    const listY = geo.cardY + DROPDOWN_HEADER_H;
    const listContainer = new PIXI.Container();
    listContainer.position.set(geo.cardX + 10, listY);
    layer.addChild(listContainer);
    const maskG = new PIXI.Graphics();
    maskG.beginFill(0xffffff, 1);
    maskG.drawRect(geo.cardX + 10, listY, geo.cardW - 20, geo.listH);
    maskG.endFill();
    layer.addChild(maskG);
    listContainer.mask = maskG;
    if (!state.entries.length) {
      const emptyText = state.loading ? "加载中…" : "暂无下级地区";
      listContainer.addChild(center(text(emptyText, 16, 0x81906f, "700"), (geo.cardW - 20) / 2, geo.listH / 2));
      return;
    }
    const maxOffset = Math.max(0, state.entries.length * DROPDOWN_ROW_H - geo.listH);
    const offset = Math.max(0, Math.min(Number(state.offset) || 0, maxOffset));
    state.offset = offset;
    state.entries.forEach((item, index) => {
      const rowTop = index * DROPDOWN_ROW_H - offset;
      if (rowTop > geo.listH || rowTop + DROPDOWN_ROW_H < 0) return;
      const g = new PIXI.Graphics();
      g.lineStyle(1, 0xe3dcc4, 0.9);
      g.beginFill(index % 2 ? 0xf8f6ea : 0xfffef8, 1);
      g.drawRect(0, rowTop, geo.cardW - 20, DROPDOWN_ROW_H);
      g.endFill();
      listContainer.addChild(g);
      listContainer.addChild(center(text(item.shortName, 17, 0x31481f, "800"), (geo.cardW - 20) / 2, rowTop + DROPDOWN_ROW_H / 2));
    });
    if (maxOffset > 0) {
      const barH = Math.max(26, geo.listH * (geo.listH / (state.entries.length * DROPDOWN_ROW_H)));
      const barY = listY + (geo.listH - barH) * (offset / maxOffset);
      rounded(layer, geo.cardX + geo.cardW - 8, barY, 4, barH, 2, 0xc9bd97, 0.9, 0, 0, 0);
    }
  }

  function closeRegionDropdown() {
    dropdownState = null;
    if (dropdownLayer && dropdownLayer.parent) dropdownLayer.parent.removeChild(dropdownLayer);
    if (dropdownLayer && dropdownLayer.destroy) dropdownLayer.destroy({ children: true });
    dropdownLayer = null;
  }

  function dropdownPoint(event) {
    const touches = event && (event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches) || [];
    const pointer = touches.length ? touches[0] : event;
    if (!pointer) return null;
    const candidates = touchCandidates(point(pointer));
    return candidates.length ? candidates[0].point : null;
  }

  function handleDropdownTap(state, p) {
    const geo = dropdownCardGeometry(state);
    if (p.x >= geo.cardX + geo.cardW - 48 && p.x <= geo.cardX + geo.cardW && p.y >= geo.cardY && p.y <= geo.cardY + DROPDOWN_HEADER_H) {
      closeRegionDropdown();
      return;
    }
    if (p.x < geo.cardX || p.x > geo.cardX + geo.cardW || p.y < geo.cardY || p.y > geo.cardY + geo.cardH) {
      // 点在卡片外：关闭浮层并吞掉这次触摸，避免误触底层按钮
      closeRegionDropdown();
      return;
    }
    if (p.y < geo.cardY + DROPDOWN_HEADER_H) return;
    const index = Math.floor((p.y - (geo.cardY + DROPDOWN_HEADER_H) + (state.offset || 0)) / DROPDOWN_ROW_H);
    const item = state.entries[index];
    if (!item) return;
    const side = state.side;
    const levelIndex = state.levelIndex;
    closeRegionDropdown();
    onAction("home-region-select", normalizeConfig(config), { side, levelIndex, code: item.code });
  }

  function attachDropdownHandlers() {
    if (dropdownHandlersAttached) return;
    dropdownHandlersAttached = true;
    if (wxApi && typeof wxApi.onTouchMove === "function") {
      wxApi.onTouchMove((event) => {
        const state = dropdownState;
        if (!state || !state.dragging) return;
        const p = dropdownPoint(event);
        if (!p) return;
        const geo = dropdownCardGeometry(state);
        const maxOffset = Math.max(0, state.entries.length * DROPDOWN_ROW_H - geo.listH);
        const delta = state.dragStartY - p.y;
        if (Math.abs(delta) > 6) state.moved = true;
        state.offset = Math.max(0, Math.min(maxOffset, state.dragStartOffset + delta));
        renderRegionDropdown();
      });
    }
    if (wxApi && typeof wxApi.onTouchEnd === "function") {
      wxApi.onTouchEnd((event) => {
        const state = dropdownState;
        if (!state) return;
        const p = dropdownPoint(event);
        // 只处理"浮层打开后新开始的触摸"（touchstart 落在卡片内才会置 dragging）。
        // 打开下拉那次点击的松手没有对应 start，必须忽略，否则会被误判成"点空白关闭"
        if (state.dragging && p && !state.moved) handleDropdownTap(state, p);
        state.dragging = false;
        state.moved = false;
      });
    }
  }

  function showRegionDropdown(nextState) {
    const request = dropdownRequest || {};
    const openedAt = dropdownState && Number(dropdownState.openedAt) || Date.now();
    dropdownState = Object.assign({ offset: 0, entries: [], side: "red", loading: false, openedAt }, request, nextState || {});
    attachDropdownHandlers();
    renderRegionDropdown();
  }

  function roomAction(type, configOverride) {
    transitionLocked = false;
    const nextConfig = normalizeConfig(configOverride || config);
    onAction(type, nextConfig, Object.assign({}, friendState));
  }

  function showFriendRoom(nextState) {
    if (nextState && nextState.config && typeof nextState.config === "object") {
      config = normalizeConfig(Object.assign({}, config, nextState.config, { mode: "friend" }));
    }
    friendState = normalizeFriendState(nextState, friendState);
    config = normalizeConfig(Object.assign({}, config, { mode: "friend", roomId: friendState.roomId || config.roomId }));
    showHome(config);
    screen = "friend-room";
    transitionLocked = false;
    hitAreas = [];

    const shade = new PIXI.Graphics();
    shade.beginFill(0x15220e, 0.76);
    shade.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    shade.endFill();
    design.addChild(shade);

    const cardX = 310;
    const cardY = 126;
    const cardW = 660;
    const cardH = 468;
    rounded(design, cardX + 7, cardY + 10, cardW, cardH, 32, 0x111b0b, 0.32, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 30, 0xfffef8, 1, 0xe2d7b9, 1, 4);

    const copy = {
      creating: ["正在创建好友房", friendState.message || "正在连接房间服务，请稍候"],
      waiting_host: ["等待好友加入", friendState.message || "房间已保留，可以再次转发邀请"],
      waiting_guest: ["好友邀请你对战", friendState.message || "双方球队和阵型由房主已经选定"],
      friend_unready: ["好友已加入", friendState.message || "正在确认好友连接状态"],
      host_warmup: ["好友已上线", friendState.message || "现在开始好友局，或先踢完这场 AI 热身赛"],
      queued_after_warmup: [friendState.role === "guest" ? "踢完本局后开始" : "好友局已排队", friendState.message || "AI 热身全场结束后，会自动切换到正式好友局"],
      guest_can_spectate: ["房主正在热身", friendState.message || "你可以观看这场 AI 热身赛，或继续等待"],
      guest_spectating: ["正在观看热身赛", friendState.message || "热身不计入好友局，正式对战仍从 0:0 开始"],
      friend_ready: [friendState.role === "guest" ? "等待房主开始" : "好友已上线", friendState.message || (friendState.role === "guest" ? "你可以等待房主开始好友对战" : "现在可以开始好友对战，也可以先跟 AI 踢")],
      loading: ["正在加载比赛", friendState.message || "双方加载完成后将同步开球"],
      countdown: [String(friendState.countdown || 0), friendState.message || "准备开球"],
      reconnecting: ["正在重连", friendState.message || "房间已为你保留，请稍候"],
      error: ["好友房暂不可用", friendState.message || "连接失败，可重试或返回单人对战"],
    };
    const currentCopy = copy[friendState.status] || copy.error;
    const titleSize = friendState.status === "countdown" ? 76 : 34;
    const roomTitle = center(text(currentCopy[0], titleSize, 0x31481f, "900"), 640, cardY + 76);
    const roomDetail = center(text(currentCopy[1], 18, 0x68765c, "700"), 640, cardY + 133);
    design.addChild(roomTitle, roomDetail);

    const summary = center(text(`红方 ${TEAMS.find((team) => team.id === config.redTeam).name}  ${config.redFormation}     VS     蓝方 ${TEAMS.find((team) => team.id === config.blueTeam).name}  ${config.blueFormation}`, 19, 0x3e5630, "900"), 640, cardY + 198);
    design.addChild(summary);
    rounded(design, cardX + 72, cardY + 226, cardW - 144, 2, 1, 0xd9d2bb, 1, 0, 0, 0);
    const roomLabel = friendState.roomId
      ? `房间已安全创建  ·  时长 ${TIMES.find((item) => item.value === config.time).label}`
      : `时长 ${TIMES.find((item) => item.value === config.time).label}  ·  配置将在邀请时冻结`;
    const roomInfo = center(text(roomLabel, 16, 0x81906f, "700"), 640, cardY + 261);
    design.addChild(roomInfo);

    const buttonsY = cardY + 324;
    const addRoomButton = (x, w, label, type, opts, configOverride) => actionButton(x, buttonsY, w, label, () => roomAction(type, configOverride), opts);
    if (friendState.status === "creating") {
      addRoomButton(500, 280, "取消等待", "friend-cancel");
    } else if (friendState.status === "waiting_host") {
      addRoomButton(354, 180, "再次邀请", "friend-share");
      addRoomButton(550, 180, "先跟AI对战", "warmup-ai", { primary: true });
      addRoomButton(746, 180, "取消等待", "friend-cancel");
    } else if (friendState.status === "waiting_guest") {
      addRoomButton(500, 280, "加入对战", "friend-join", { primary: true });
    } else if (friendState.status === "friend_unready") {
      addRoomButton(404, 220, "先跟AI对战", "warmup-ai", { primary: true });
      addRoomButton(656, 220, "取消等待", "friend-cancel");
    } else if (friendState.status === "friend_ready" && friendState.role === "host") {
      addRoomButton(500, 280, "立即开赛", "friend-start", { primary: true, height: 60 });
    } else if (friendState.status === "friend_ready") {
      addRoomButton(500, 280, "退出房间", "friend-cancel");
    } else if (friendState.status === "guest_can_spectate") {
      addRoomButton(404, 220, "继续等待", "wait-warmup");
      addRoomButton(656, 220, "观看热身赛", "watch-warmup", { primary: true });
    } else if (friendState.status === "guest_spectating") {
      addRoomButton(500, 280, "继续等待", "stop-watch-warmup");
    } else if (friendState.status === "host_warmup") {
      addRoomButton(404, 220, "立即好友对战", "friend-start-now", { primary: true });
      addRoomButton(656, 220, "踢完这局", "queue-friend-after-warmup");
    } else if (friendState.status === "queued_after_warmup" && friendState.role === "host") {
      addRoomButton(500, 280, "取消排队", "cancel-friend-after-warmup");
    } else if (friendState.status === "queued_after_warmup" && !friendState.guestSpectating) {
      addRoomButton(404, 220, "继续等待", "wait-warmup");
      addRoomButton(656, 220, "观看热身赛", "watch-warmup", { primary: true });
    } else if (friendState.status === "queued_after_warmup") {
      addRoomButton(500, 280, "继续等待", "stop-watch-warmup");
    } else if (friendState.status === "error") {
      addRoomButton(404, 220, "重试", "friend-retry", { primary: true });
      addRoomButton(656, 220, "返回单人对战", "friend-cancel");
    }
  }

  function setProgress(value, immediate) {
    targetProgress = Math.max(targetProgress, Math.max(0, Math.min(100, Number(value) || 0)));
    if (immediate) {
      shownProgress = targetProgress;
      renderProgress();
      if (!runtimeLoadingOverlay) renderer.render(stage);
    }
    updateRuntimeLoadingProgress(value);
  }

  function renderProgress() {
    if (!progressParts) return;
    const delta = targetProgress - shownProgress;
    if (Math.abs(delta) > 0.01) shownProgress += Math.max(0.08, delta * 0.14);
    if (shownProgress > targetProgress) shownProgress = targetProgress;
    const ratio = Math.max(0, Math.min(1, shownProgress / 100));
    const { trackX, trackY, trackW, fill, ball, pct } = progressParts;
    fill.clear();
    fill.lineStyle(5, 0xf1b82d, 1);
    fill.moveTo(trackX, trackY - 3);
    fill.lineTo(trackX + trackW * ratio, trackY - 3);
    ball.position.x = trackX + trackW * ratio;
    ball.rotation = ratio * Math.PI * 10;
    ball.position.y = trackY - 4 - Math.sin(ratio * Math.PI * 14) * 4;
    pct.text = `${Math.round(ratio * 100)}%`;
  }

  function loop() {
    if (suspended) return;
    renderProgress();
    renderer.render(stage);
    rafId = (options.requestFrame || requestAnimationFrame)(loop);
  }

  function syncViewport() {
    if (!wxApi || typeof wxApi.getSystemInfoSync !== "function") return;
    let info;
    try { info = wxApi.getSystemInfoSync(); } catch (error) { return; }
    const rawWidth = Number(info.windowWidth || info.screenWidth) || width;
    const rawHeight = Number(info.windowHeight || info.screenHeight) || height;
    // 真机触点偶尔使用物理像素，而 getSystemInfoSync 返回的 pixelRatio
    // 可能低于 Canvas 初始化时的实际比例；不能在首次合规页点击后把高比例覆盖掉。
    pixelRatio = Math.max(pixelRatio, Number(info.pixelRatio) || 1);
    const nextWidth = Math.max(rawWidth, rawHeight);
    const nextHeight = Math.min(rawWidth, rawHeight);
    if (Math.abs(nextWidth - width) < 1 && Math.abs(nextHeight - height) < 1) return;
    width = nextWidth;
    height = nextHeight;
    scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    design.scale.set(scale, scale);
    design.position.set((width - DESIGN_WIDTH * scale) / 2, (height - DESIGN_HEIGHT * scale) / 2);
    if (renderer && typeof renderer.resize === "function") renderer.resize(width, height);
    drawViewportBackground();
  }

  function fitStageToGame(game) {
    const gameRenderer = game && game.renderer;
    const gameScreen = gameRenderer && gameRenderer.screen;
    const targetWidth = Number(gameScreen && gameScreen.width)
      || Number(gameRenderer && gameRenderer.width) / (Number(gameRenderer && gameRenderer.resolution) || 1)
      || width;
    const targetHeight = Number(gameScreen && gameScreen.height)
      || Number(gameRenderer && gameRenderer.height) / (Number(gameRenderer && gameRenderer.resolution) || 1)
      || height;
    const parentScaleX = Number(game && game.stage && game.stage.scale && game.stage.scale.x) || 1;
    const parentScaleY = Number(game && game.stage && game.stage.scale && game.stage.scale.y) || 1;
    stage.scale.set(targetWidth / width / parentScaleX, targetHeight / height / parentScaleY);
    stage.position.set(0, 0);
  }

  function fromScreen(raw, divisor) {
    syncViewport();
    const rawX = raw.x / divisor;
    const rawY = raw.y / divisor;
    return {
      x: (rawX - design.position.x) / scale,
      y: (rawY - design.position.y) / scale,
    };
  }

  function touchCandidates(raw) {
    const ratios = [1];
    if (raw.x > width * 1.12 || raw.y > height * 1.12) {
      ratios.push(resolution, pixelRatio);
      if (canvas && Number(canvas.width) > 0) ratios.push(Number(canvas.width) / width);
      if (canvas && Number(canvas.height) > 0) ratios.push(Number(canvas.height) / height);
    }
    const unique = [];
    for (const ratio of ratios) {
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      if (unique.some((value) => Math.abs(value - ratio) < 0.02)) continue;
      unique.push(ratio);
    }
    return unique.map((ratio) => ({ ratio, point: fromScreen(raw, ratio) }));
  }

  function handleTouchEnd(event) {
    if (suspended || screen === "loading") return;
    if (dropdownState) {
      // 下拉浮层打开时由浮层接管触摸：卡片内记录滚动起点，卡片外关闭并吞掉这次触摸
      const p = dropdownPoint(event);
      if (p) {
        const geo = dropdownCardGeometry(dropdownState);
        if (p.x >= geo.cardX && p.x <= geo.cardX + geo.cardW && p.y >= geo.cardY && p.y <= geo.cardY + geo.cardH) {
          dropdownState.dragging = true;
          dropdownState.dragStartY = p.y;
          dropdownState.dragStartOffset = dropdownState.offset || 0;
          dropdownState.moved = false;
          return;
        }
      }
      // 打开后 300ms 内的残余触摸不当作"点外面关闭"（真机触摸回波/二次确认）
      if (Date.now() - (Number(dropdownState.openedAt) || 0) < 300) return;
      closeRegionDropdown();
      return;
    }
    const touches = event && (event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches) || [];
    const pointer = touches.length ? touches[0] : event;
    if (!pointer) return;
    const raw = point(pointer);
    const now = Date.now();
    if (lastPointer && now - lastPointer.at < 250 && Math.hypot(raw.x - lastPointer.x, raw.y - lastPointer.y) < 12) return;
    lastPointer = { x: raw.x, y: raw.y, at: now };
    const candidates = touchCandidates(raw);
    for (const candidate of candidates) {
      const p = candidate.point;
      for (let index = hitAreas.length - 1; index >= 0; index -= 1) {
        const hit = hitAreas[index];
        if (!hit.enabled) continue;
        if (p.x >= hit.x && p.x <= hit.x + hit.w && p.y >= hit.y && p.y <= hit.y + hit.h) {
          if (typeof globalThis !== "undefined") {
            globalThis.__RURAL_FOOTBALL_SHELL_LAST_TOUCH__ = {
              raw,
              x: p.x,
              y: p.y,
              ratio: candidate.ratio,
              screen,
              hit: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
            };
          }
          console.info("[rural-football-shell] TOUCH_HIT", screen, candidate.ratio.toFixed(2), Math.round(p.x), Math.round(p.y));
          hit.action();
          return;
        }
      }
    }
    if (typeof globalThis !== "undefined") globalThis.__RURAL_FOOTBALL_SHELL_LAST_TOUCH__ = { raw, candidates, screen, missed: true };
    console.warn("[rural-football-shell] TOUCH_MISS", screen, JSON.stringify({ raw, candidates }));
  }

  function attachTouch() {
    if (touchAttached) return;
    if (wxApi && typeof wxApi.onTouchStart === "function") {
      wxApi.onTouchStart(handleTouchEnd);
      touchUsesStart = true;
    } else if (wxApi && typeof wxApi.onTouchEnd === "function") {
      wxApi.onTouchEnd(handleTouchEnd);
      touchUsesStart = false;
    }
    if (wxApi && typeof wxApi.onMouseDown === "function") {
      wxApi.onMouseDown(handleTouchEnd);
      mouseAttached = true;
    }
    if (canvas && typeof canvas.addEventListener === "function") {
      canvas.addEventListener("mousedown", handleTouchEnd);
      canvasMouseAttached = true;
    }
    touchAttached = touchUsesStart
      || !!(wxApi && typeof wxApi.onTouchEnd === "function")
      || mouseAttached
      || canvasMouseAttached;
  }

  function detachTouch() {
    if (!touchAttached) return;
    if (touchUsesStart && wxApi && typeof wxApi.offTouchStart === "function") wxApi.offTouchStart(handleTouchEnd);
    if (!touchUsesStart && wxApi && typeof wxApi.offTouchEnd === "function") wxApi.offTouchEnd(handleTouchEnd);
    if (mouseAttached && wxApi && typeof wxApi.offMouseDown === "function") wxApi.offMouseDown(handleTouchEnd);
    if (canvasMouseAttached && canvas && typeof canvas.removeEventListener === "function") canvas.removeEventListener("mousedown", handleTouchEnd);
    touchAttached = false;
    mouseAttached = false;
    canvasMouseAttached = false;
    lastPointer = null;
  }

  const TUTORIAL_STORAGE_KEY = "rural-football:tutorial-seen-v1";

  function hasSeenTutorial() {
    try {
      return !!(wxApi && typeof wxApi.getStorageSync === "function" && wxApi.getStorageSync(TUTORIAL_STORAGE_KEY));
    } catch (error) {
      return false;
    }
  }

  function markTutorialSeen() {
    try {
      if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(TUTORIAL_STORAGE_KEY, 1);
    } catch (error) {}
  }

  // 首次进入的一次性操作引导：矢量画出"左摇杆移动 + 右侧动作键"示意，点"开始踢球"关闭。
  function showTutorial(onDone) {
    screen = "tutorial";
    suspended = false;
    transitionLocked = false;
    clearDesign();
    addBackground();

    const dim = new PIXI.Graphics();
    dim.beginFill(0x0a1206, 0.42);
    dim.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    dim.endFill();
    design.addChild(dim);

    const cardX = 190;
    const cardY = 92;
    const cardW = 900;
    const cardH = 520;
    rounded(design, cardX + 5, cardY + 9, cardW, cardH, 34, 0x111b0b, 0.34, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 34, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    design.addChild(center(text("怎么玩", 42, 0x31481f, "900"), 640, 150));

    function guideCircle(cx, cy, r, fill, label, labelSize) {
      const g = new PIXI.Graphics();
      g.lineStyle(3, 0x5d9038, 0.9);
      g.beginFill(fill, 1);
      g.drawCircle(cx, cy, r);
      g.endFill();
      design.addChild(g);
      design.addChild(center(text(label, labelSize, 0x31481f, "800"), cx, cy));
    }

    // 左手：移动摇杆
    design.addChild(center(text("移动 · 跑位", 20, 0xa44734, "800"), 360, 258));
    guideCircle(360, 344, 66, 0xf1f8e8, "摇杆", 22);
    design.addChild(center(text("拖住左侧摇杆跑动", 17, 0x7c8a63, "700"), 360, 434));

    // 右手：动作键
    design.addChild(center(text("动作 · 踢球", 20, 0x315a9b, "800"), 900, 200));
    guideCircle(900, 272, 33, 0xf1f8e8, "挑传", 15);
    guideCircle(824, 344, 33, 0xf1f8e8, "传球", 15);
    guideCircle(976, 344, 33, 0xf1f8e8, "射门", 15);
    guideCircle(900, 416, 33, 0xf1f8e8, "铲球", 15);
    guideCircle(900, 344, 40, 0xfde7c8, "冲刺", 17);
    design.addChild(center(text("点右侧按钮传球、射门", 17, 0x7c8a63, "700"), 900, 462));

    design.addChild(center(text("把球踢进对面球门就得分！", 23, 0x31481f, "900"), 640, 510));

    const btnW = 260;
    const btnH = 56;
    const btnX = 640 - btnW / 2;
    const btnY = 546;
    rounded(design, btnX + 2, btnY + 4, btnW, btnH, 28, 0x253314, 0.16, 0, 0, 0);
    rounded(design, btnX, btnY, btnW, btnH, 28, 0x5d9038, 1, 0x426d2a, 0.9, 3);
    design.addChild(center(text("开始踢球 →", 22, 0xfff7e2, "900"), 640, btnY + btnH / 2));
    addHit(btnX, btnY, btnW, btnH, () => {
      markTutorialSeen();
      if (typeof onDone === "function") onDone();
    }, true);
  }

  // 免费场次用完的解锁面板：与整个项目同风格（奶油卡片 + 绿/琥珀双色按钮），
  // 替代原生 ActionSheet。payload 见 play-gate.requestUnlock：
  // { title, subtitle, entries: [{ kind: 'share'|'ad', tier: 'single'|'day', label, run }], onCancel }
  function showUnlockPanel(payload) {
    const entries = (payload && payload.entries || []).slice(0, 4);
    if (!entries.length) return false;
    screen = "unlock";
    suspended = false;
    transitionLocked = false;
    clearDesign();
    addBackground();

    const dim = new PIXI.Graphics();
    dim.beginFill(0x0a1206, 0.42);
    dim.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    dim.endFill();
    design.addChild(dim);

    const rowH = 62;
    const rowGap = 16;
    const cardW = 700;
    const cardH = 168 + entries.length * (rowH + rowGap) + 58;
    const cardX = 640 - cardW / 2;
    const cardY = (DESIGN_HEIGHT - cardH) / 2;
    rounded(design, cardX + 5, cardY + 9, cardW, cardH, 34, 0x111b0b, 0.34, 0, 0, 0);
    rounded(design, cardX, cardY, cardW, cardH, 34, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    design.addChild(center(text(payload.title || "免费场次踢完啦", 36, 0x31481f, "900"), 640, cardY + 54));
    const subtitle = center(text(payload.subtitle || "转发给好友 或 看个小视频，任选一种继续踢", 17, 0x7c8a63, "700"), 640, cardY + 102);
    if (subtitle.width > cardW - 70) subtitle.scale.set((cardW - 70) / subtitle.width);
    design.addChild(subtitle);

    const rowW = cardW - 116;
    const rowX = 640 - rowW / 2;
    entries.forEach((entry, index) => {
      const y = cardY + 138 + index * (rowH + rowGap);
      const amber = entry.kind === "ad";
      const solid = entry.tier !== "day";
      const fill = solid ? (amber ? 0xf1b82d : 0x5d9038) : 0xf7fbee;
      const strokeColor = amber ? 0xc98a3b : 0x426d2a;
      const labelColor = solid ? (amber ? 0x3a2d0a : 0xfff7e2) : 0x31481f;
      rounded(design, rowX + 2, y + 4, rowW, rowH, rowH / 2, 0x253314, 0.14, 0, 0, 0);
      rounded(design, rowX, y, rowW, rowH, rowH / 2, fill, 1, strokeColor, solid ? 0.9 : 0.8, 3);
      const label = center(text(entry.label, 21, labelColor, "900"), 640, y + rowH / 2);
      if (label.width > rowW - 56) label.scale.set((rowW - 56) / label.width);
      design.addChild(label);
      addHit(rowX, y, rowW, rowH, () => entry.run(), true);
    });

    const cancelY = cardY + cardH - 44;
    const cancelLabel = center(text("先不踢了", 17, 0x9aa383, "700"), 640, cancelY);
    design.addChild(cancelLabel);
    addHit(640 - 90, cancelY - 20, 180, 40, () => {
      if (typeof payload.onCancel === "function") payload.onCancel();
    }, true);
    return true;
  }

  attachTouch();
  showLoading();
  loop();

  return {
    showTutorial,
    hasSeenTutorial,
    showPreMatch,
    showModeHub,
    showUnlockPanel,
    renderer,
    stage,
    get screen() { return screen; },
    get config() { return normalizeConfig(config); },
    get preMatchState() { return preMatchState ? Object.assign({}, preMatchState) : null; },
    get modeHub() { return modeHubState; },
    get friendState() { return friendState ? Object.assign({}, friendState) : null; },
    get regionPicker() { return normalizeRegionPicker(regionPickerState); },
    get campaign() { return normalizeCampaignState(campaignState); },
    get onlineFeatures() { return normalizeOnlineFeatures(onlineFeatures); },
    setProgress,
    showLoading,
    showTransitionLoading(label) {
      showLoading({ reset: true, progress: 8, label: label || "正在加载比赛场景" });
    },
    whenPortraitsReady() { return portraitReady; },
    showHome,
    setCampaignState(nextState) {
      campaignState = normalizeCampaignState(nextState);
      if (screen === "home") showHome(config);
    },
    setOnlineFeatures(nextFeatures) {
      onlineFeatures = normalizeOnlineFeatures(nextFeatures);
      friendEntryEnabled = onlineFeatures.friend.enabled;
      if (screen === "home") showHome(config);
      else if (screen === "mode-hub") showModeHub(modeHubState || "social", config);
    },
    showLeaderboard,
    showRegionPicker,
    showRegionDropdown,
    closeRegionDropdown,
    showFriendRoom,
    setFriendState(nextState) { showFriendRoom(nextState); },
    setActionHandler(handler) { onAction = typeof handler === "function" ? handler : () => {}; },
    attachHomeToGame(game, nextConfig) {
      attachedGame = game || null;
      if (!attachedGame || !attachedGame.stage) throw new Error("返回主页时原版 game.stage 不可用");
      if (stage.parent && stage.parent.removeChild) stage.parent.removeChild(stage);
      fitStageToGame(attachedGame);
      attachedGame.stage.addChild(stage);
      if (attachedGame.pitch && attachedGame.pitch.pause) attachedGame.pitch.pause();
      if (attachedGame.stadium) {
        if (attachedGame.stadium.pause) attachedGame.stadium.pause();
        attachedGame.stadium.visible = false;
      }
      stage.visible = true;
      suspended = false;
      attachTouch();
      showHome(nextConfig || config);
    },
    attachLoadingToGame(game, label) {
      attachedGame = game || null;
      if (!attachedGame || !attachedGame.stage) {
        showLoading({ reset: true, progress: 8, label: label || "正在加载比赛场景" });
        return;
      }
      if (attachedGame.pitch && attachedGame.pitch.pause) attachedGame.pitch.pause();
      if (attachedGame.stadium && attachedGame.stadium.pause) attachedGame.stadium.pause();
      detachTouch();
      createRuntimeLoadingOverlay(attachedGame, label || "正在加载比赛场景", 8);
      screen = "loading";
      suspended = true;
    },
    attachLoadingOverlayToGame(game) {
      attachedGame = game || attachedGame;
      if (!attachedGame || !attachedGame.stage) return false;
      createRuntimeLoadingOverlay(attachedGame, "正在加载比赛场景", 82);
      suspended = true;
      if (rafId != null && options.cancelFrame) options.cancelFrame(rafId);
      detachTouch();
      return true;
    },
    suspendForMatch() {
      if (progressParts) {
        setProgress(72, true);
      }
      suspended = true;
      if (rafId != null && options.cancelFrame) options.cancelFrame(rafId);
      detachTouch();
      destroyRuntimeLoadingOverlay();
      if (stage.parent && stage.parent.removeChild) stage.parent.removeChild(stage);
      if (attachedGame && attachedGame.stadium) {
        attachedGame.stadium.visible = true;
        if (attachedGame.stadium.resume) attachedGame.stadium.resume();
      }
      if (attachedGame && attachedGame.pitch && attachedGame.pitch.resume) attachedGame.pitch.resume();
      attachedGame = null;
      stage.visible = false;
    },
    destroy() {
      suspended = true;
      destroyRuntimeLoadingOverlay();
      if (rafId != null && options.cancelFrame) options.cancelFrame(rafId);
      detachTouch();
      if (stage.destroy) stage.destroy({ children: true });
    },
  };
}

module.exports = {
  createGameShell,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  FRIEND_ROOM_STATUSES,
  normalizeFriendState,
};
