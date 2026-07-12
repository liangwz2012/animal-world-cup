const { TEAMS } = require("../data/game-options");
const { matchShareTitle, matchShareCaption, generateMatchShareCard } = require("./share-card");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointerPoint(pointer) {
  return {
    x: Number(pointer && (pointer.clientX == null ? (pointer.pageX == null ? pointer.x : pointer.pageX) : pointer.clientX)) || 0,
    y: Number(pointer && (pointer.clientY == null ? (pointer.pageY == null ? pointer.y : pointer.pageY) : pointer.clientY)) || 0,
  };
}

function uniqueRatios(values) {
  const ratios = [];
  for (const value of values) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    if (ratios.some((known) => Math.abs(known - ratio) < 0.02)) continue;
    ratios.push(ratio);
  }
  return ratios;
}

// WeChat can report a pointer in CSS/window pixels, Canvas backing-store pixels,
// or physical device pixels depending on the base library and the current
// preview mode.  Generate all credible renderer-space candidates and let the
// hit-test choose the one that actually intersects a HUD control.
function mapMatchPointerCandidates(options) {
  const raw = options.raw || { x: 0, y: 0 };
  const width = Math.max(1, Number(options.width) || 1);
  const height = Math.max(1, Number(options.height) || 1);
  const canvas = options.canvas;
  let rect = null;
  if (canvas && typeof canvas.getBoundingClientRect === "function") {
    try {
      const value = canvas.getBoundingClientRect();
      if (value && Number(value.width) > 0 && Number(value.height) > 0) rect = value;
    } catch (error) {}
  }

  const ratios = [1];
  if (raw.x > width * 1.08 || raw.y > height * 1.08 || rect) {
    ratios.push(options.devicePixelRatio, options.resolution);
    if (canvas && Number(canvas.width) > 0) ratios.push(Number(canvas.width) / width);
    if (canvas && Number(canvas.height) > 0) ratios.push(Number(canvas.height) / height);
  }

  return uniqueRatios(ratios).map((ratio) => {
    const clientX = raw.x / ratio;
    const clientY = raw.y / ratio;
    if (rect) {
      return {
        ratio,
        point: {
          x: (clientX - Number(rect.left || 0)) * width / Number(rect.width),
          y: (clientY - Number(rect.top || 0)) * height / Number(rect.height),
        },
      };
    }
    return { ratio, point: { x: clientX, y: clientY } };
  });
}

// Keep the match toolbar visually identical to the original website's
// hand-drawn SVG icon set.  These are rendered with Pixi vectors instead of
// bitmap assets, so they stay crisp on high-DPI phones and add no image weight.
function drawToolIcon(graphics, kind, cx, cy, size, color) {
  const unit = size / 24;
  const x = (value) => cx + (value - 12) * unit;
  const y = (value) => cy + (value - 12) * unit;
  const stroke = Math.max(1.6, 2 * unit);
  const line = (alpha) => graphics.lineStyle(stroke, color, alpha == null ? 1 : alpha);
  const path = (points) => {
    graphics.moveTo(x(points[0][0]), y(points[0][1]));
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(x(points[index][0]), y(points[index][1]));
    }
  };

  graphics.clear();
  line();
  if (kind === "zoom-in" || kind === "zoom-out") {
    graphics.drawCircle(x(10.5), y(10.5), 6.5 * unit);
    path([[15.6, 15.6], [20, 20]]);
    path([[7.8, 10.5], [13.2, 10.5]]);
    if (kind === "zoom-in") path([[10.5, 7.8], [10.5, 13.2]]);
  } else if (kind === "replay") {
    // Leave the top-right gap used by the website's IconReplay instead of
    // drawing a closed circle; the arrow head then reads clearly as "复位".
    graphics.arc(x(12), y(12), 8 * unit, -0.05, Math.PI * 1.74, false);
    path([[20, 3.5], [20, 7.7], [15.8, 7.7]]);
  } else if (kind === "home") {
    path([[3, 12], [12, 4], [21, 12]]);
    path([[5, 12], [5, 19], [9, 20], [9, 15], [15, 15], [15, 20], [19, 19], [19, 12]]);
  } else if (kind === "camera") {
    graphics.drawRoundedRect(x(3), y(8), 18 * unit, 11 * unit, 1.5 * unit);
    graphics.drawCircle(x(12), y(13), 3.1 * unit);
    path([[4.5, 8], [6.7, 8], [7.8, 6.3], [8.65, 5.84], [15.36, 5.84], [16.2, 6.3], [17.3, 8], [19.5, 8]]);
  } else if (kind === "sound-on" || kind === "sound-off") {
    path([[11, 5], [6.5, 9], [3.5, 9], [3.5, 15], [6.5, 15], [11, 19], [11, 5]]);
    if (kind === "sound-on") {
      graphics.arc(x(12.3), y(12), 4.2 * unit, -0.72, 0.72, false);
      graphics.arc(x(12.6), y(12), 7.6 * unit, -0.77, 0.77, false);
    } else {
      path([[16, 9.5], [21, 14.5]]);
      path([[21, 9.5], [16, 14.5]]);
    }
  } else if (kind === "share") {
    path([[7, 17.5], [7, 15.7]]);
    if (typeof graphics.bezierCurveTo === "function") {
      graphics.bezierCurveTo(x(7), y(11.6), x(10.3), y(8.3), x(14.4), y(8.3));
    } else path([[7, 15.7], [10, 10], [14.4, 8.3]]);
    path([[14.4, 8.3], [19, 8.3]]);
    path([[15, 4.6], [20.4, 10], [15, 15.4]]);
    line(0.32);
    if (typeof graphics.bezierCurveTo === "function") {
      graphics.moveTo(x(4.2), y(18.5));
      graphics.bezierCurveTo(x(5.4), y(13.8), x(8.9), y(11), x(14), y(11));
      graphics.lineTo(x(19.8), y(11));
    }
  }
  return graphics;
}

function createMatchChrome(options) {
  const PIXI = options.PIXI;
  const game = options.game;
  const inputHost = options.inputHost;
  const runtimeEvents = options.runtimeEvents;
  const wxApi = options.wxApi;
  const config = options.config || {};
  const sound = options.sound || null;
  if (!PIXI || !PIXI.Container || !PIXI.Graphics || !PIXI.Text) throw new Error("比赛 HUD 缺少 Pixi 能力");
  if (!game || !game.stage || !game.renderer) throw new Error("比赛 HUD 缺少原版 game/stage/renderer");

  const width = Number(game.renderer.screen && game.renderer.screen.width) || Number(game.renderer.width) || 1280;
  const height = Number(game.renderer.screen && game.renderer.screen.height) || Number(game.renderer.height) || 720;
  const scale = clamp(height / 720, 0.58, 1);
  const root = new PIXI.Container();
  root.name = "animal-football-match-chrome";
  const toolLayer = new PIXI.Container();
  const scoreLayer = new PIXI.Container();
  const eventLayer = new PIXI.Container();
  const confettiLayer = new PIXI.Container();
  const resultLayer = new PIXI.Container();
  root.addChild(scoreLayer, toolLayer, confettiLayer, eventLayer, resultLayer);
  game.stage.addChild(root);

  let destroyed = false;
  let rafId = null;
  let statsOpen = false;
  let resultVisible = false;
  let eventHideAt = 0;
  let shownHalf = false;
  let touchAttached = false;
  let touchUsesStart = false;
  let lastScore = [0, 0];
  let hitAreas = [];
  let confetti = [];
  let lastBallSpeed = 0;
  let lastKickAt = 0;
  let lastScreenshot = "";
  let lastShareCard = "";
  let lastStatsDrawAt = 0;
  let mouseAttached = false;
  let canvasMouseAttached = false;
  let lastPointer = null;
  let guestScoreInitialized = false;

  function text(value, size, color, weight) {
    return new PIXI.Text(String(value), {
      fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: Math.max(12, Math.round(size * scale)),
      fontWeight: weight || "800",
      fill: color == null ? 0x233617 : color,
      align: "center",
    });
  }

  function center(display, x, y) {
    if (display.anchor && display.anchor.set) display.anchor.set(0.5, 0.5);
    display.position.set(x, y);
    return display;
  }

  function fitTextWidth(display, maxWidth, minimumSize) {
    if (!display || !display.style) return display;
    let fontSize = Number(display.style.fontSize) || 14;
    const min = Math.max(8, Number(minimumSize) || 9);
    while (display.width > maxWidth && fontSize > min) {
      fontSize -= 1;
      display.style.fontSize = fontSize;
    }
    return display;
  }

  function teamName(teamId) {
    const team = TEAMS.find((item) => item.id === teamId);
    return team ? team.name : String(teamId || "球队");
  }

  function teamCountry(teamId) {
    const team = TEAMS.find((item) => item.id === teamId);
    return team ? team.country || "" : "";
  }

  function rounded(parent, x, y, w, h, radius, fill, alpha, stroke, strokeWidth) {
    const g = new PIXI.Graphics();
    if (strokeWidth) g.lineStyle(strokeWidth, stroke == null ? 0xffffff : stroke, 0.72);
    g.beginFill(fill, alpha == null ? 1 : alpha);
    g.drawRoundedRect(x, y, w, h, radius);
    g.endFill();
    parent.addChild(g);
    return g;
  }

  function sprite(path, parent, x, y, w, h) {
    const image = PIXI.Sprite.fromImage ? PIXI.Sprite.fromImage(path) : new PIXI.Sprite(PIXI.Texture.fromImage(path));
    center(image, x, y);
    image.width = w;
    image.height = h;
    parent.addChild(image);
    return image;
  }

  function portraitPath(teamId) {
    return `shell-assets/portraits/${teamId}.png`;
  }

  function addHit(x, y, w, h, action, kind) {
    hitAreas.push({ x, y, w, h, action, kind: kind || "tool" });
  }

  const barW = Math.min(width * 0.5, 490 * scale);
  const barH = 86 * scale;
  const barX = (width - barW) / 2;
  const barY = 10 * scale;
  rounded(scoreLayer, barX, barY, barW, barH, 22 * scale, 0xfffdf1, 0.94, 0xffffff, 2 * scale);
  const headSize = 42 * scale;
  sprite(portraitPath(config.redTeam), scoreLayer, barX + 31 * scale, barY + 31 * scale, headSize, headSize);
  sprite(portraitPath(config.blueTeam), scoreLayer, barX + barW - 31 * scale, barY + 31 * scale, headSize, headSize);
  const redName = center(text(teamName(config.redTeam), 15, 0xa44734, "900"), barX + 89 * scale, barY + 31 * scale);
  const blueName = center(text(teamName(config.blueTeam), 15, 0x315a9b, "900"), barX + barW - 89 * scale, barY + 31 * scale);
  fitTextWidth(redName, 72 * scale, 9 * scale);
  fitTextWidth(blueName, 72 * scale, 9 * scale);
  const redScoreText = center(text("0", 34, 0xa44734, "900"), barX + barW * 0.41, barY + 31 * scale);
  const blueScoreText = center(text("0", 34, 0x315a9b, "900"), barX + barW * 0.59, barY + 31 * scale);
  const timeText = center(text("0'", 19, 0xfff7dc, "900"), barX + barW / 2, barY + 31 * scale);
  rounded(scoreLayer, barX + barW / 2 - 29 * scale, barY + 14 * scale, 58 * scale, 34 * scale, 17 * scale, 0x5d9038, 1);
  scoreLayer.addChild(redName, blueName, redScoreText, blueScoreText, timeText);
  const possessionText = center(text("控球 50%  ·  50%   ▾", 14, 0x365421, "800"), barX + barW / 2, barY + 69 * scale);
  scoreLayer.addChild(possessionText);
  addHit(barX, barY, barW, barH, () => {
    statsOpen = !statsOpen;
    possessionText.text = `控球 ${readStats().possession.red}%  ·  ${readStats().possession.blue}%   ${statsOpen ? "▴" : "▾"}`;
    drawStats();
  }, "score");

  const statsLayer = new PIXI.Container();
  scoreLayer.addChild(statsLayer);

  function readStats() {
    const runtimeWindow = inputHost.window || inputHost;
    const stats = runtimeWindow.__matchStats || inputHost.__matchStats || {};
    const red = stats.red || {};
    const blue = stats.blue || {};
    const total = (red.ownTicks || 0) + (blue.ownTicks || 0);
    const redPoss = total ? Math.round((red.ownTicks || 0) * 100 / total) : 50;
    return {
      red,
      blue,
      possession: { red: redPoss, blue: 100 - redPoss },
    };
  }

  function authoritativeGuestFrame() {
    const runtimeWindow = inputHost.window || inputHost;
    const sync = inputHost.__ORIGINAL_RUNTIME_MATCH_SYNC__
      || runtimeWindow.__ORIGINAL_RUNTIME_MATCH_SYNC__;
    return sync && sync.role === "guest" ? sync.currentGuestFrame : null;
  }

  function drawStats() {
    statsLayer.removeChildren();
    if (!statsOpen || resultVisible) return;
    const rows = [
      ["控球率", "possession"],
      ["射门", "shots"],
      ["传球", "passes"],
      ["抢断", "slides"],
      ["角球", "corners"],
      ["界外球", "throwIns"],
      ["球门球", "goalKicks"],
    ];
    const panelH = (rows.length * 29 + 50) * scale;
    rounded(statsLayer, barX + 24 * scale, barY + barH - 2 * scale, barW - 48 * scale, panelH, 15 * scale, 0xfffdf1, 0.96, 0xffffff, 2 * scale);
    const stats = readStats();
    const title = center(text("比赛数据", 15, 0x5d9038, "900"), barX + barW / 2, barY + barH + 16 * scale);
    const leftTeam = center(text(teamName(config.redTeam), 12, 0xa44734, "900"), barX + 72 * scale, barY + barH + 34 * scale);
    const rightTeam = center(text(teamName(config.blueTeam), 12, 0x315a9b, "900"), barX + barW - 72 * scale, barY + barH + 34 * scale);
    fitTextWidth(leftTeam, 82 * scale, 8 * scale);
    fitTextWidth(rightTeam, 82 * scale, 8 * scale);
    statsLayer.addChild(title, leftTeam, rightTeam);
    rows.forEach((row, index) => {
      const y = barY + barH + (53 + index * 29) * scale;
      const values = row[1] === "possession"
        ? stats.possession
        : { red: stats.red[row[1]] || 0, blue: stats.blue[row[1]] || 0 };
      const suffix = row[1] === "possession" ? "%" : "";
      const red = center(text(`${values.red}${suffix}`, 13, 0xa44734, "900"), barX + 55 * scale, y);
      const label = center(text(row[0], 13, 0x30441f, "700"), barX + barW / 2, y);
      const blue = center(text(`${values.blue}${suffix}`, 13, 0x315a9b, "900"), barX + barW - 55 * scale, y);
      const total = values.red + values.blue;
      const redRatio = total ? values.red / total : 0;
      const blueRatio = total ? values.blue / total : 0;
      const trackW = 72 * scale;
      const trackH = 7 * scale;
      rounded(statsLayer, barX + 76 * scale, y - trackH / 2, trackW, trackH, trackH / 2, 0xd8d2bf, 0.62);
      rounded(statsLayer, barX + barW - 148 * scale, y - trackH / 2, trackW, trackH, trackH / 2, 0xd8d2bf, 0.62);
      if (redRatio > 0) rounded(statsLayer, barX + 76 * scale + trackW * (1 - redRatio), y - trackH / 2, trackW * redRatio, trackH, trackH / 2, 0xd8443a, 1);
      if (blueRatio > 0) rounded(statsLayer, barX + barW - 148 * scale, y - trackH / 2, trackW * blueRatio, trackH, trackH / 2, 0x3f7fb1, 1);
      statsLayer.addChild(red, label, blue);
    });
    lastStatsDrawAt = Date.now();
  }

  function zoomObject() {
    return inputHost.__matchZoom || inputHost.window && inputHost.window.__matchZoom;
  }

  function notify(title, icon) {
    if (wxApi && wxApi.showToast) wxApi.showToast({ title, icon: icon || "none", duration: 1600 });
  }

  function captureScreenshot() {
    const canvas = game.renderer && game.renderer.view;
    if (!canvas) return notify("截图失败");
    const done = (result) => {
      lastScreenshot = result && (result.tempFilePath || result.filePath) || "";
      inputHost.__ANIMAL_FOOTBALL_LAST_SCREENSHOT__ = lastScreenshot;
      notify(lastScreenshot ? "截图已生成" : "截图失败", lastScreenshot ? "success" : "none");
    };
    const fail = () => notify("截图失败");
    try {
      if (typeof canvas.toTempFilePath === "function") {
        canvas.toTempFilePath({ success: done, fail });
      } else if (wxApi && typeof wxApi.canvasToTempFilePath === "function") {
        wxApi.canvasToTempFilePath({ canvas, success: done, fail });
      } else fail();
    } catch (error) { fail(); }
  }

  function shareMatch() {
    const pitch = game.pitch;
    const score = pitch && pitch.redTeam ? [pitch.redTeam.score | 0, pitch.blueTeam.score | 0] : [0, 0];
    const localIsBlue = config.localRole === "guest" && config.friendPhase === "friend";
    const myScore = localIsBlue ? score[1] : score[0];
    const foeScore = localIsBlue ? score[0] : score[1];
    const myTeamId = localIsBlue ? config.blueTeam : config.redTeam;
    const foeTeamId = localIsBlue ? config.redTeam : config.blueTeam;
    const payload = {
      title: matchShareTitle({ myName: teamName(myTeamId), foeName: teamName(foeTeamId), myScore, foeScore }),
      imageUrl: lastShareCard || lastScreenshot || undefined,
      query: `red=${config.redTeam}&blue=${config.blueTeam}`,
    };
    if (wxApi && typeof wxApi.shareAppMessage === "function") {
      try { wxApi.shareAppMessage(payload); } catch (error) { notify("请从右上角分享"); }
    } else notify("请从右上角分享");
  }

  function toolButton(x, iconName, action) {
    const w = 44 * scale;
    const h = 44 * scale;
    rounded(toolLayer, x, 16 * scale, w, h, 14 * scale, 0xfffef8, 0.95, 0x8a7046, 1.2 * scale);
    const icon = new PIXI.Graphics();
    drawToolIcon(icon, iconName, x + w / 2, 38 * scale, 23 * scale, 0x4f8a2f);
    toolLayer.addChild(icon);
    addHit(x, 17 * scale, w, h, action);
    return {
      nextX: x + w + 7 * scale,
      setIcon(nextIconName) {
        drawToolIcon(icon, nextIconName, x + w / 2, 38 * scale, 23 * scale, 0x4f8a2f);
      },
    };
  }

  let toolX = 12 * scale;
  let tool = toolButton(toolX, "zoom-out", () => { const z = zoomObject(); if (z) z.step(1 / 1.18); });
  toolX = tool.nextX;
  tool = toolButton(toolX, "replay", () => { const z = zoomObject(); if (z) z.reset(); });
  toolX = tool.nextX;
  tool = toolButton(toolX, "zoom-in", () => { const z = zoomObject(); if (z) z.step(1.18); });
  toolX = tool.nextX;
  tool = toolButton(toolX, "home", () => options.onHome && options.onHome(config));
  toolX = tool.nextX;
  let soundTool = null;
  soundTool = toolButton(toolX, sound && sound.muted ? "sound-off" : "sound-on", () => {
    if (!sound) return;
    sound.toggle();
    soundTool.setIcon(sound.muted ? "sound-off" : "sound-on");
  });
  toolX = soundTool.nextX;
  tool = toolButton(toolX, "camera", captureScreenshot);
  toolX = tool.nextX;
  toolButton(toolX, "share", shareMatch);

  function showEvent(title, line, teamId, kind) {
    eventLayer.removeChildren();
    const cardW = Math.min(width * 0.58, 470 * scale);
    const cardH = 150 * scale;
    const x = (width - cardW) / 2;
    const y = height * 0.28;
    rounded(eventLayer, x, y, cardW, cardH, 28 * scale, 0xfff7d5, 0.97, kind === "goal" ? 0xf1b82d : 0xffffff, 4 * scale);
    if (teamId) sprite(portraitPath(teamId), eventLayer, x + 74 * scale, y + cardH / 2, 92 * scale, 92 * scale);
    const titleText = center(text(title, 34, 0x385823, "900"), x + cardW * (teamId ? 0.62 : 0.5), y + 54 * scale);
    const lineText = center(text(line, 25, 0xa44734, "900"), x + cardW * (teamId ? 0.62 : 0.5), y + 103 * scale);
    eventLayer.addChild(titleText, lineText);
    eventHideAt = Date.now() + (kind === "goal" ? 2600 : 2200);
  }

  function startConfetti(teamId) {
    confettiLayer.removeChildren();
    const teamColors = {
      england: [0xc54539, 0xf7f0df, 0xddb24d], france: [0x2858ad, 0xf2efe4, 0xd84c45],
      germany: [0x29231d, 0xf0d14f, 0xc63f35], spain: [0xc83f35, 0xefc95a, 0x4d3323],
      portugal: [0x176d49, 0xc83b35, 0x8b7968], brazil: [0xedcf49, 0x148e57, 0x245bab],
      argentina: [0x8ed3f3, 0xffffff, 0xc99b6b], usa: [0x263f7b, 0xf7f1e7, 0xc83d43],
    };
    const colors = teamColors[teamId] || [0xf1b82d, 0xffffff, 0x5d9038];
    confetti = Array.from({ length: 54 }, (_, index) => {
      const g = new PIXI.Graphics();
      g.beginFill(colors[index % colors.length], 1);
      g.drawRect(-4 * scale, -7 * scale, 8 * scale, 14 * scale);
      g.endFill();
      g.position.set(width * (0.08 + Math.random() * 0.84), -20 - Math.random() * height * 0.25);
      confettiLayer.addChild(g);
      return { view: g, vx: (Math.random() * 2 - 1) * 2.8 * scale, vy: (2.5 + Math.random() * 4) * scale, spin: (Math.random() * 2 - 1) * 0.16 };
    });
  }

  function stopControlsForResult() {
    const overlay = inputHost.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__;
    if (overlay && overlay.root) overlay.root.visible = false;
    const input = inputHost.__touchInput;
    if (input) {
      input.vx = 0; input.vy = 0; input.shoot = false; input.sprint = false;
      input.pass = false; input.lob = false; input.tackle = false;
    }
  }

  function showResult(detail) {
    resultVisible = true;
    statsOpen = false;
    drawStats();
    stopControlsForResult();
    resultLayer.removeChildren();
    const score = detail && detail.score || lastScore;
    const cardW = Math.min(width * 0.76, 690 * scale);
    const cardH = Math.min(height * 0.78, 510 * scale);
    const x = (width - cardW) / 2;
    const y = (height - cardH) / 2;
    rounded(resultLayer, 0, 0, width, height, 0, 0x10200c, 0.68);
    rounded(resultLayer, x, y, cardW, cardH, 30 * scale, 0xfff8dc, 0.98, 0xf1b82d, 4 * scale);
    const full = center(text("全场结束", 24, 0x5d9038, "900"), width / 2, y + 38 * scale);
    resultLayer.addChild(full);
    sprite(portraitPath(config.redTeam), resultLayer, x + 120 * scale, y + 125 * scale, 112 * scale, 112 * scale);
    sprite(portraitPath(config.blueTeam), resultLayer, x + cardW - 120 * scale, y + 125 * scale, 112 * scale, 112 * scale);
    const finalScore = center(text(`${score[0]}  :  ${score[1]}`, 54, 0x31481f, "900"), width / 2, y + 125 * scale);
    resultLayer.addChild(finalScore);
    const localIsBlue = config.localRole === "guest" && config.friendPhase === "friend";
    const localWon = localIsBlue ? score[1] > score[0] : score[0] > score[1];
    const verdict = score[0] === score[1] ? "双方战平" : localWon ? "我的球队获胜" : "对手获胜";
    const verdictText = center(text(verdict, 23, 0xa44734, "900"), width / 2, y + 198 * scale);
    resultLayer.addChild(verdictText);

    // 生成战报分享卡（离屏绘制，异步；失败时分享回落截图/裸标题）
    const myScore = localIsBlue ? score[1] : score[0];
    const foeScore = localIsBlue ? score[0] : score[1];
    const myTeamId = localIsBlue ? config.blueTeam : config.redTeam;
    const foeTeamId = localIsBlue ? config.redTeam : config.blueTeam;
    generateMatchShareCard(wxApi, {
      score,
      redName: teamName(config.redTeam),
      blueName: teamName(config.blueTeam),
      redCountry: teamCountry(config.redTeam),
      blueCountry: teamCountry(config.blueTeam),
      caption: matchShareCaption(myScore, foeScore),
    }).then((path) => {
      if (!path) return;
      lastShareCard = path;
      if (inputHost) {
        inputHost.__ANIMAL_FOOTBALL_LAST_SHARE_CARD__ = path;
        inputHost.__ANIMAL_FOOTBALL_LAST_SHARE_TITLE__ = matchShareTitle({
          myName: teamName(myTeamId), foeName: teamName(foeTeamId), myScore, foeScore,
        });
      }
    });

    const stats = readStats();
    const summary = [
      `控球 ${stats.possession.red}%  ·  ${stats.possession.blue}%`,
      `射门 ${stats.red.shots || 0}  ·  ${stats.blue.shots || 0}`,
      `传球 ${stats.red.passes || 0}  ·  ${stats.blue.passes || 0}`,
      `铲抢 ${stats.red.slides || 0}  ·  ${stats.blue.slides || 0}`,
    ];
    summary.forEach((line, index) => {
      const t = center(text(line, 17, 0x415a2d, "700"), width / 2, y + (245 + index * 30) * scale);
      resultLayer.addChild(t);
    });

    const buttonY = y + cardH - 65 * scale;
    const buttonW = 185 * scale;
    const gap = 24 * scale;
    const firstX = width / 2 - buttonW - gap / 2;
    rounded(resultLayer, firstX, buttonY, buttonW, 48 * scale, 22 * scale, 0xf1b82d, 1, 0xffffff, 2 * scale);
    rounded(resultLayer, width / 2 + gap / 2, buttonY, buttonW, 48 * scale, 22 * scale, 0x5d9038, 1, 0xffffff, 2 * scale);
    const rematch = center(text("再来一局", 18, 0x3a2d0a, "900"), firstX + buttonW / 2, buttonY + 24 * scale);
    const home = center(text("返回主页", 18, 0xfff8dc, "900"), width / 2 + gap / 2 + buttonW / 2, buttonY + 24 * scale);
    resultLayer.addChild(rematch, home);
    addHit(firstX, buttonY, buttonW, 48 * scale, () => options.onRematch && options.onRematch(config), "result");
    addHit(width / 2 + gap / 2, buttonY, buttonW, 48 * scale, () => options.onHome && options.onHome(config), "result");
  }

  function onGoal(event) {
    const detail = event && event.detail || {};
    const score = detail.score || lastScore;
    const scorer = score[0] > lastScore[0] ? (detail.red || config.redTeam) : (detail.blue || config.blueTeam);
    lastScore = [score[0] || 0, score[1] || 0];
    showEvent("进球！", `${lastScore[0]}  :  ${lastScore[1]}`, scorer, "goal");
    startConfetti(scorer);
    if (sound) {
      const cheer = {
        england: "cheer_lion", france: "cheer_rooster", germany: "cheer_eagle", spain: "cheer_bull",
        portugal: "cheer_wolf", brazil: "cheer_jaguar", argentina: "cheer_puma", usa: "cheer_eagle",
      }[scorer] || "goal_cheer";
      sound.play(cheer, { volume: 0.95 });
    }
    if (wxApi && wxApi.vibrateShort) {
      try { wxApi.vibrateShort({ type: "medium" }); } catch (error) {}
    }
  }

  function onEnded(event) {
    const detail = event && event.detail || {};
    if (sound) {
      sound.play("whistle_fulltime", { volume: 0.85 });
      sound.stopMatchAmbience();
    }
    showResult(detail);
    if (typeof options.onMatchEnded === "function") options.onMatchEnded(detail);
  }

  function rootLocalPoint(screenPoint) {
    const transform = root && root.worldTransform;
    if (transform && typeof transform.applyInverse === "function") {
      try {
        const local = transform.applyInverse(screenPoint, {});
        if (local && Number.isFinite(local.x) && Number.isFinite(local.y)) return local;
      } catch (error) {}
    }
    return screenPoint;
  }

  function storePointerDiagnostic(value) {
    inputHost.__ANIMAL_FOOTBALL_MATCH_LAST_TOUCH__ = value;
    if (inputHost.window) inputHost.window.__ANIMAL_FOOTBALL_MATCH_LAST_TOUCH__ = value;
    if (typeof globalThis !== "undefined") globalThis.__ANIMAL_FOOTBALL_MATCH_LAST_TOUCH__ = value;
  }

  function handlePointer(event) {
    const touches = event && (event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches) || [];
    const touch = touches.length ? touches[0] : event;
    if (!touch) return;
    const raw = pointerPoint(touch);
    const pointerNow = Date.now();
    const canvas = game.renderer && game.renderer.view;
    if (lastPointer && pointerNow - lastPointer.at < 240 && Math.hypot(raw.x - lastPointer.x, raw.y - lastPointer.y) < 12) return;
    lastPointer = { x: raw.x, y: raw.y, at: pointerNow };
    let systemRatio = 1;
    if (wxApi && typeof wxApi.getSystemInfoSync === "function") {
      try { systemRatio = Number(wxApi.getSystemInfoSync().pixelRatio) || 1; } catch (error) {}
    }
    const candidates = mapMatchPointerCandidates({
      raw,
      width,
      height,
      canvas,
      devicePixelRatio: Math.max(
        systemRatio,
        Number(inputHost.devicePixelRatio || inputHost.window && inputHost.window.devicePixelRatio) || 1
      ),
      resolution: Number(game.renderer && game.renderer.resolution) || 1,
    });
    for (const candidate of candidates) {
      const local = rootLocalPoint(candidate.point);
      const x = local.x;
      const y = local.y;
      for (let index = hitAreas.length - 1; index >= 0; index -= 1) {
        const hit = hitAreas[index];
        if (resultVisible && hit.kind !== "result") continue;
        if (!resultVisible && hit.kind === "result") continue;
        if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
          storePointerDiagnostic({
            raw,
            x,
            y,
            ratio: candidate.ratio,
            resultVisible,
            hit: { x: hit.x, y: hit.y, w: hit.w, h: hit.h, kind: hit.kind },
          });
          console.info("[animal-football-match] TOUCH_HIT", hit.kind, candidate.ratio.toFixed(2), Math.round(x), Math.round(y));
          hit.action();
          return;
        }
      }
    }
    storePointerDiagnostic({ raw, candidates, resultVisible, missed: true });
    console.warn("[animal-football-match] TOUCH_MISS", JSON.stringify({ raw, candidates, resultVisible }));
  }

  function update() {
    if (destroyed) return;
    const pitch = game.pitch;
    const authority = authoritativeGuestFrame();
    const redTeamState = authority && authority.redTeam || pitch && pitch.redTeam;
    const blueTeamState = authority && authority.blueTeam || pitch && pitch.blueTeam;
    if (pitch && redTeamState && blueTeamState) {
      const currentScore = [redTeamState.score | 0, blueTeamState.score | 0];
      if (authority) {
        if (!guestScoreInitialized) {
          guestScoreInitialized = true;
          lastScore = currentScore.slice();
        } else if (currentScore[0] > lastScore[0] || currentScore[1] > lastScore[1]) {
          onGoal({ detail: { score: currentScore, red: config.redTeam, blue: config.blueTeam } });
        }
      }
      redScoreText.text = String(currentScore[0]);
      blueScoreText.text = String(currentScore[1]);
      const matchTime = authority ? authority.matchTime : pitch.matchTime;
      timeText.text = `${Math.min(90, Math.floor((matchTime || 0) / 60))}'`;
      const stats = readStats();
      possessionText.text = `控球 ${stats.possession.red}%  ·  ${stats.possession.blue}%   ${statsOpen ? "▴" : "▾"}`;
      if (statsOpen && Date.now() - lastStatsDrawAt >= 450) drawStats();
      if (!shownHalf && (authority ? authority.secondHalf : pitch.secondHalf)) {
        shownHalf = true;
        showEvent("半场休息", "准备进入下半场", null, "half");
      }
      const ball = authority && authority.ball || pitch.ball;
      const velocity = ball && ball.velocity;
      const speed = velocity ? Math.hypot(Number(velocity.x) || 0, Number(velocity.y) || 0, Number(velocity.z) || 0) : 0;
      const now = Date.now();
      if (sound && now - lastKickAt > 180 && speed - lastBallSpeed > 1.7 && speed > 3.2) {
        sound.play(speed > 6.3 ? "shot" : "pass", { volume: speed > 6.3 ? 0.72 : 0.48 });
        lastKickAt = now;
      }
      lastBallSpeed = speed;
    }
    if (eventHideAt && Date.now() >= eventHideAt) {
      eventHideAt = 0;
      eventLayer.removeChildren();
    }
    for (const piece of confetti) {
      piece.view.x += piece.vx;
      piece.view.y += piece.vy;
      piece.view.rotation += piece.spin;
      if (piece.view.y > height + 30) piece.view.visible = false;
    }
    const children = game.stage.children || [];
    if (children[children.length - 1] !== root) game.stage.addChild(root);
    rafId = inputHost.requestAnimationFrame(update);
  }

  if (runtimeEvents && runtimeEvents.addEventListener) {
    runtimeEvents.addEventListener("ab-goal", onGoal);
    runtimeEvents.addEventListener("ab-match-ended", onEnded);
  }
  if (sound) {
    sound.startMatchAmbience();
    sound.play("whistle_kickoff", { volume: 0.72 });
  }
  if (wxApi && typeof wxApi.onTouchStart === "function") {
    wxApi.onTouchStart(handlePointer);
    touchUsesStart = true;
    touchAttached = true;
  } else if (wxApi && typeof wxApi.onTouchEnd === "function") {
    wxApi.onTouchEnd(handlePointer);
    touchUsesStart = false;
    touchAttached = true;
  }
  if (wxApi && wxApi.onMouseDown) {
    wxApi.onMouseDown(handlePointer);
    mouseAttached = true;
  }
  const matchCanvas = game.renderer && game.renderer.view;
  if (matchCanvas && typeof matchCanvas.addEventListener === "function") {
    matchCanvas.addEventListener("mousedown", handlePointer);
    canvasMouseAttached = true;
  }
  update();

  return {
    root,
    showResult,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId != null && inputHost.cancelAnimationFrame) inputHost.cancelAnimationFrame(rafId);
      if (runtimeEvents && runtimeEvents.removeEventListener) {
        runtimeEvents.removeEventListener("ab-goal", onGoal);
        runtimeEvents.removeEventListener("ab-match-ended", onEnded);
      }
      if (touchAttached && touchUsesStart && wxApi && wxApi.offTouchStart) wxApi.offTouchStart(handlePointer);
      if (touchAttached && !touchUsesStart && wxApi && wxApi.offTouchEnd) wxApi.offTouchEnd(handlePointer);
      if (mouseAttached && wxApi && wxApi.offMouseDown) wxApi.offMouseDown(handlePointer);
      if (canvasMouseAttached && matchCanvas && typeof matchCanvas.removeEventListener === "function") matchCanvas.removeEventListener("mousedown", handlePointer);
      if (sound) sound.stopMatchAmbience();
      if (root.parent && root.parent.removeChild) root.parent.removeChild(root);
      if (root.destroy) root.destroy({ children: true });
    },
  };
}

module.exports = { createMatchChrome, drawToolIcon, mapMatchPointerCandidates };
