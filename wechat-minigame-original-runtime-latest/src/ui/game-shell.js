const {
  TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  normalizeConfig,
  cycle,
} = require("../data/game-options");
const { FRIEND_ENTRY_ENABLED } = require("../net/friend-service-config");

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
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

function point(touch) {
  return {
    x: Number(touch && (touch.clientX == null ? (touch.pageX == null ? touch.x : touch.pageX) : touch.clientX)) || 0,
    y: Number(touch && (touch.clientY == null ? (touch.pageY == null ? touch.y : touch.pageY) : touch.clientY)) || 0,
  };
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
  const friendEntryEnabled = options.friendEntryEnabled != null
    ? !!options.friendEntryEnabled
    : FRIEND_ENTRY_ENABLED !== false;
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
  let campaignState = normalizeCampaignState(options.campaign);
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

  const portraitReady = Promise.all(TEAMS.map((team) => {
    const localPath = `shell-assets/portraits/${team.id}.png`;
    const fallbackPath = `runtime-assets/match-runtime-min/data/player/races/${team.id}/head.png`;
    portraitPaths[team.id] = localPath;
    return waitForTexture(localPath, fallbackPath).then((resolved) => {
      portraitPaths[team.id] = resolved;
      return resolved;
    });
  }));
  cachedTexture("shell-assets/brand-logo.png");
  cachedTexture("shell-assets/football.png");

  function clearDesign() {
    if (typeof design.removeChildren === "function") design.removeChildren();
    hitAreas = [];
    progressParts = null;
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
    root.name = "animal-football-runtime-loading";
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
    const cardW = 105;
    const cardH = 101;
    const gapX = 12;
    const gapY = 10;
    const x = panelX + 20 + column * (cardW + gapX);
    const y = panelY + 62 + row * (cardH + gapY);
    rounded(design, x + 2, y + 4, cardW, cardH, 15, 0x253314, disabled ? 0.04 : 0.11, 0x253314, 0, 0);
    rounded(design, x, y, cardW, cardH, 15, selected ? 0xf1f8e8 : 0xfffef8, disabled ? 0.34 : 1, selected ? 0x5d9038 : 0xcfc6ac, 0.9, selected ? 5 : 2.5);
    const fallback = new PIXI.Graphics();
    fallback.beginFill(team.color, disabled ? 0.08 : 0.13);
    fallback.drawCircle(x + cardW / 2, y + 36, 31);
    fallback.endFill();
    design.addChild(fallback);
    const portrait = sprite(portraitPaths[team.id] || `shell-assets/portraits/${team.id}.png`, x + cardW / 2, y + 36, 66, 66);
    portrait.alpha = disabled ? 0.26 : 1;
    const label = center(text(team.name, 16, disabled ? 0x7d856f : 0x31481f, "900"), x + cardW / 2, y + 78);
    design.addChild(label);
    if (team.country) {
      const subtitle = center(text(team.country, 10, disabled ? 0x9aa189 : 0x7c8a63, "700"), x + cardW / 2, y + 93);
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

  function settingButton(x, y, w, label, action, active) {
    rounded(design, x + 1.5, y + 3, w, 44, 22, 0x253314, 0.1, 0x253314, 0, 0);
    rounded(design, x, y, w, 44, 22, active ? 0x5d9038 : 0xfffef8, 1, active ? 0x426d2a : 0xcfc6ac, 0.82, 2.5);
    const t = center(text(label, 17, active ? 0xfff7e2 : 0x294019, "800"), x + w / 2, y + 22);
    design.addChild(t);
    addHit(x, y, w, 44, action, true);
  }

  function formationPreview(panelX, panelY, formationName, tone, side) {
    const formation = FORMATIONS.find((item) => item.name === formationName) || FORMATIONS[0];
    const pitchX = panelX + 31;
    const pitchY = panelY + 291;
    const pitchW = 94;
    const pitchH = 132;
    const pitch = new PIXI.Graphics();
    pitch.lineStyle(2.5, 0xffffff, 0.86);
    pitch.beginFill(0x6aa843, 1);
    pitch.drawRoundedRect(pitchX, pitchY, pitchW, pitchH, 12);
    pitch.endFill();
    pitch.lineStyle(1.7, 0xffffff, 0.82);
    pitch.drawRoundedRect(pitchX + 5, pitchY + 5, pitchW - 10, pitchH - 10, 7);
    pitch.moveTo(pitchX + 5, pitchY + pitchH / 2);
    pitch.lineTo(pitchX + pitchW - 5, pitchY + pitchH / 2);
    pitch.drawCircle(pitchX + pitchW / 2, pitchY + pitchH / 2, 12);
    pitch.drawRect(pitchX + pitchW / 2 - 19, pitchY + 5, 38, 14);
    pitch.drawRect(pitchX + pitchW / 2 - 19, pitchY + pitchH - 19, 38, 14);
    const dotColor = tone === "blue" ? 0x3f7fb1 : 0xd8443a;
    pitch.lineStyle(2, 0xffffff, 0.96);
    for (const spot of formation.spots) {
      const col = spot[0];
      const lane = spot[1];
      const px = pitchX + 12 + ((lane - 1) / 6) * (pitchW - 24);
      const py = pitchY + 17 + (1 - (col - 3) / 4) * (pitchH - 42);
      pitch.beginFill(dotColor, 1);
      pitch.drawCircle(px, py, 5.5);
      pitch.endFill();
    }
    pitch.beginFill(0xefc23a, 1);
    pitch.drawCircle(pitchX + pitchW / 2, pitchY + pitchH - 14, 5.5);
    pitch.endFill();
    design.addChild(pitch);

    const label = center(text(`阵型  ${formation.name}`, 18, tone === "blue" ? 0x315a9b : 0xa44734, "900"), panelX + 319, panelY + 302);
    design.addChild(label);
    FORMATIONS.forEach((item, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panelX + 145 + col * 111;
      const y = panelY + 329 + row * 45;
      const active = item.name === formation.name;
      settingButton(x, y, 101, item.name, () => {
        if (side === "red") config.redFormation = item.name;
        else config.blueFormation = item.name;
        showHome(config);
      }, active);
    });
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
    const labelText = center(text(label, primary ? 23 : 19, enabled ? (primary ? 0x314518 : 0x31481f) : 0x777970, "900"), x + w / 2, y + h / 2);
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
    screen = "home";
    suspended = false;
    transitionLocked = false;
    clearDesign();
    addBackground();
    const title = center(text("选择对战球队", 36, 0xfff8d7, "900"), 640, 34);
    design.addChild(title);

    const panelY = 64;
    const panelW = 512;
    const panelH = 438;
    const leftX = 52;
    const rightX = 716;
    rounded(design, leftX + 4, panelY + 7, panelW, panelH, 27, 0x263515, 0.18, 0x263515, 0, 0);
    rounded(design, rightX + 4, panelY + 7, panelW, panelH, 27, 0x263515, 0.18, 0x263515, 0, 0);
    rounded(design, leftX, panelY, panelW, panelH, 25, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    rounded(design, rightX, panelY, panelW, panelH, 25, 0xfffef8, 1, 0xe6dcc3, 1, 4);
    const leftHome = config.side === "home";
    const leftTitle = center(text(`我的球队（${leftHome ? "主队" : "客队"}）`, 23, 0xa44734, "900"), leftX + panelW / 2, panelY + 25);
    const rightTitle = center(text(`对手球队（${leftHome ? "客队" : "主队"}）`, 23, 0x315a9b, "900"), rightX + panelW / 2, panelY + 25);
    const leftSwap = center(text("点击切换主客场", 12, 0x81906f, "700"), leftX + panelW / 2, panelY + 47);
    const rightSwap = center(text("点击切换主客场", 12, 0x81906f, "700"), rightX + panelW / 2, panelY + 47);
    design.addChild(leftTitle, rightTitle, leftSwap, rightSwap);
    const swapSide = () => {
      config.side = config.side === "home" ? "away" : "home";
      showHome(config);
    };
    addHit(leftX + 90, panelY + 4, panelW - 180, 50, swapSide, true);
    addHit(rightX + 90, panelY + 4, panelW - 180, 50, swapSide, true);
    const vs = center(text("VS", 36, 0xfff8d7, "900"), 640, 255);
    design.addChild(vs);

    TEAMS.forEach((team, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      teamCard(leftX, panelY, team, column, row, config.redTeam === team.id, config.blueTeam === team.id, "red");
      teamCard(rightX, panelY, team, column, row, config.blueTeam === team.id, config.redTeam === team.id, "blue");
    });
    formationPreview(leftX, panelY, config.redFormation, "red", "red");
    formationPreview(rightX, panelY, config.blueFormation, "blue", "blue");

    const season = campaignState.season;
    const daily = campaignState.daily;
    const seasonLabel = season.complete
      ? `赛季征程 · 开启第 ${season.seasonNumber + 1} 赛季`
      : season.opponentName
        ? `赛季第 ${season.completedRounds + 1}/${season.totalRounds} 场 · 对阵${season.opponentName}`
        : "赛季征程 · 5 场联赛";
    const dailyLabel = daily.completed
      ? "每日挑战 · 今日已完成"
      : daily.opponentName
      ? `每日挑战 · ${daily.theme} vs ${daily.opponentName}`
      : "每日挑战 · 今日固定赛";
    actionButton(330, 506, 290, seasonLabel, () => onAction("season", normalizeConfig(config)), { height: 36 });
    actionButton(660, 506, 290, dailyLabel, () => onAction("daily", normalizeConfig(config)), { height: 36 });

    const diff = DIFFICULTIES.find((item) => item.value === config.ai);
    const matchTime = TIMES.find((item) => item.value === config.time);
    const settingsY = 552;
    settingButton(405, settingsY, 215, `难度  ${diff.label}`, () => {
      config.ai = cycle(DIFFICULTIES, config.ai, "value", 1);
      showHome(config);
    });
    settingButton(660, settingsY, 215, `时长  ${matchTime.label}`, () => {
      config.time = cycle(TIMES, config.time, "value", 1);
      showHome(config);
    });

    const actionY = 610;
    const sideW = 240;
    const startW = 340;
    const actionGap = friendEntryEnabled ? 28 : 36;
    // 提审版为“观看对战 / 立即开赛 / 排行榜”三键对称布局；排行榜紧贴在立即开赛右侧。
    // 好友入口恢复后继续排在排行榜右侧，不会破坏主入口的相邻关系。
    const groupW = friendEntryEnabled
      ? sideW * 3 + startW + actionGap * 3
      : sideW * 2 + startW + actionGap * 2;
    const actionX = (DESIGN_WIDTH - groupW) / 2;
    actionButton(actionX, actionY, sideW, "观看对战", () => onAction("watch", normalizeConfig(Object.assign({}, config, { mode: "watch" }))));
    actionButton(actionX + sideW + actionGap, actionY - 5, startW, "立即开赛", () => onAction("ai", normalizeConfig(Object.assign({}, config, { mode: "ai" }))), { primary: true, height: 60 });
    const leaderboardX = actionX + sideW + actionGap + startW + actionGap;
    actionButton(leaderboardX, actionY, sideW, "排行榜", () => onAction("leaderboard", normalizeConfig(config)));
    if (friendEntryEnabled) {
      actionButton(leaderboardX + sideW + actionGap, actionY, sideW, "好友对战", () => {
        const frozenConfig = normalizeConfig(Object.assign({}, config, { mode: "friend" }));
        config = frozenConfig;
        showFriendRoom({ status: "creating", role: "host", message: "正在创建专属房间…" });
        onAction("invite", frozenConfig, Object.assign({}, friendState));
      });
    }
    const hint = center(text("选择球队与阵型后开始比赛", 15, 0xe7f0b3, "700"), 640, 688);
    design.addChild(hint);
  }

  function normalizedLeaderboardModel(input) {
    const model = input && typeof input === "object" ? input : {};
    const stats = model.stats && typeof model.stats === "object" ? model.stats : {};
    const profile = model.profile && typeof model.profile === "object" ? model.profile : {};
    const values = model.values && typeof model.values === "object" ? model.values : {};
    const metrics = Array.isArray(model.metrics) ? model.metrics : [];
    return {
      profile: {
        nickname: typeof profile.nickname === "string" ? profile.nickname.slice(0, 16) : "",
        avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : "",
      },
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
      online: !!model.online,
      remoteMetric: typeof model.remoteMetric === "string" ? model.remoteMetric : "",
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
    const title = center(text("动物足球赛 · 排行榜", 30, 0x31481f, "900"), 640, cardY + 42);
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
    const nickname = model.profile.nickname || "未加入排行榜";
    const nicknameText = center(text(nickname, 21, 0x31481f, "900"), profileX + profileW / 2, profileY + 130);
    design.addChild(nicknameText);
    const total = center(text(`已完成 ${model.stats.matches} 场`, 15, 0x71805e, "700"), profileX + profileW / 2, profileY + 157);
    design.addChild(total);
    const overview = [
      ["积分", model.stats.points],
      ["胜 / 平 / 负", `${model.stats.wins} / ${model.stats.draws} / ${model.stats.losses}`],
      ["进球 / 失球", `${model.stats.goalsFor} / ${model.stats.goalsAgainst}`],
      ["最佳连胜", model.stats.bestWinStreak],
      ["零封", model.stats.cleanSheets],
    ];
    overview.forEach(([label, value], index) => {
      const y = profileY + 206 + index * 42;
      const left = text(label, 15, 0x71805e, "700");
      left.position.set(profileX + 24, y);
      const right = text(String(value), 16, 0x31481f, "900");
      if (right.anchor && right.anchor.set) right.anchor.set(1, 0);
      right.position.set(profileX + profileW - 24, y);
      design.addChild(left, right);
    });
    if (!model.profile.nickname) {
      actionButton(profileX + 23, profileY + 354, profileW - 46, "加入排行榜", () => onAction("leaderboard-profile", normalizeConfig(config)), { primary: true, height: 48, releaseLockAfterAction: true });
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
    const heading = center(text(`${activeMetric.label}榜`, 25, 0x31481f, "900"), contentX + contentW / 2, profileY + 99);
    const value = center(text(`${currentValue}${activeMetric.suffix || ""}`, 54, 0x5d9038, "900"), contentX + contentW / 2, profileY + 157);
    design.addChild(heading, value);
    const sub = center(text(
      model.qualified
        ? "本机赛季数据已达标；排位赛上线后可提交全服榜"
        : `再完成 ${model.matchesUntilQualified} 场可满足后续全服榜准入条件`,
      17,
      0x71805e,
      "700",
    ), contentX + contentW / 2, profileY + 205);
    design.addChild(sub);
    rounded(design, contentX, profileY + 238, contentW, 190, 18, 0xf2f7e5, 1, 0xc8d5ad, 1, 2);
    const rankTitle = center(text("全服榜单", 21, 0x31481f, "900"), contentX + contentW / 2, profileY + 274);
    design.addChild(rankTitle);
    const onlineRows = model.online && model.remoteMetric === activeMetric.id ? model.remoteRows : [];
    if (onlineRows.length) {
      onlineRows.slice(0, 3).forEach((row, index) => {
        const y = profileY + 306 + index * 36;
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
        const selfText = center(text(`我的全服排名：第 ${model.remoteSelf.rank} 名`, 14, 0x71805e, "700"), contentX + contentW / 2, profileY + 408);
        design.addChild(selfText);
      }
    } else {
      const status = center(text(
        model.online
          ? "暂无有效排位赛数据；好友局和普通局不会进入全服榜。"
          : "榜单服务将在上线域名配置完成后自动同步；当前战绩已安全保存在本机。",
        16,
        0x71805e,
        "700",
      ), contentX + contentW / 2, profileY + 326);
      const honest = center(text("不会用虚构玩家或假排名填充榜单", 14, 0x9aa383, "700"), contentX + contentW / 2, profileY + 357);
      design.addChild(status, honest);
    }
    actionButton(contentX + 130, profileY + 465, contentW - 260, "返回选队", () => showHome(config), {
      height: 48,
      bypassTransitionLock: true,
      releaseLockAfterAction: true,
    });
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
            globalThis.__ANIMAL_FOOTBALL_SHELL_LAST_TOUCH__ = {
              raw,
              x: p.x,
              y: p.y,
              ratio: candidate.ratio,
              screen,
              hit: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
            };
          }
          console.info("[animal-football-shell] TOUCH_HIT", screen, candidate.ratio.toFixed(2), Math.round(p.x), Math.round(p.y));
          hit.action();
          return;
        }
      }
    }
    if (typeof globalThis !== "undefined") globalThis.__ANIMAL_FOOTBALL_SHELL_LAST_TOUCH__ = { raw, candidates, screen, missed: true };
    console.warn("[animal-football-shell] TOUCH_MISS", screen, JSON.stringify({ raw, candidates }));
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

  const TUTORIAL_STORAGE_KEY = "animal-football:tutorial-seen-v1";

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
    showUnlockPanel,
    renderer,
    stage,
    get screen() { return screen; },
    get config() { return normalizeConfig(config); },
    get friendState() { return friendState ? Object.assign({}, friendState) : null; },
    get campaign() { return normalizeCampaignState(campaignState); },
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
    showLeaderboard,
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
