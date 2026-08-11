// 应用外壳：菜单 → 比赛 → 结果。固定 30 Hz 推进比赛核心，渲染按设备刷新率插值。

import { createRenderer, createWorld } from "../render/world.js";
import { createUiLayer } from "../ui/layer.js";
import { createMenu } from "../ui/menu.js";
import { createHud } from "../ui/hud.js";
import { createMatch, stepMatch, possessionPercent } from "../core/match.js";
import { MATCH_PHASE, TICK_DT, FORMATS } from "../core/constants.js";
import { createTeam, createRivalTeam, countiesOf, DEFAULT_HOME } from "../content/teams.js";
import { TIME_OF_DAY } from "../content/regions.js";
import { advanceCup, createCup, cupSummary, currentRound } from "../content/season.js";
import { hashSeed } from "../core/prng.js";

const STORAGE_KEY = "rural3d.config.v1";
const FONT = '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif';

function defaultConfig() {
  return {
    provinceCode: DEFAULT_HOME.provinceCode,
    countyCode: DEFAULT_HOME.countyCode,
    townIndex: DEFAULT_HOME.townIndex,
    formatId: "5v5",
    difficulty: "normal",
    // B 版视觉标杆默认黄昏：暖阳、刚亮起的灯杆和村居更有层次。
    timeOfDay: "dusk",
    quality: "high",
  };
}

export function createGame(platform) {
  const saved = platform.storage.get(STORAGE_KEY, null);
  const config = { ...defaultConfig(), ...(saved && typeof saved === "object" ? saved : {}) };
  if (!countiesOf(config.provinceCode)?.length) Object.assign(config, defaultConfig());

  const renderer = createRenderer(platform, config.quality);
  const layer = createUiLayer(platform);

  const app = {
    screen: "menu",
    world: null,
    hud: null,
    match: null,
    home: null,
    away: null,
    accumulator: 0,
    lastTime: platform.now(),
    cup: null,
    resultSurface: null,
    resultQuad: null,
    resultHits: [],
    paused: false,
  };

  function buildTeams() {
    // 村寨杯进行中时，对手由赛程决定，不再随机取邻村
    if (app.cup && !app.cup.finished) {
      return { home: app.cup.home, away: currentRound(app.cup).opponent };
    }
    const home = createTeam({
      provinceCode: config.provinceCode,
      countyCode: config.countyCode,
      townIndex: config.townIndex,
      perSide: FORMATS[config.formatId].perSide,
    });
    home.townIndex = config.townIndex;
    const away = createRivalTeam(home, { perSide: FORMATS[config.formatId].perSide, offset: 1 });
    return { home, away };
  }

  const teams = buildTeams();
  config.previewSquad = teams.home.players;

  const menu = createMenu({
    platform,
    layer,
    config,
    onStart: () => {
      app.cup = null;
      startMatch(false);
    },
    onWatch: () => {
      app.cup = null;
      startMatch(true);
    },
    onCup: () => {
      app.cup = createCup({
        provinceCode: config.provinceCode,
        countyCode: config.countyCode,
        townIndex: config.townIndex,
        perSide: FORMATS[config.formatId].perSide,
      });
      startMatch(false);
    },
  });

  function startMatch(autoPlay) {
    platform.storage.set(STORAGE_KEY, {
      provinceCode: config.provinceCode,
      countyCode: config.countyCode,
      townIndex: config.townIndex,
      formatId: config.formatId,
      difficulty: config.difficulty,
      timeOfDay: config.timeOfDay,
      quality: config.quality,
    });
    disposeMatch();
    const { home, away } = buildTeams();
    config.previewSquad = home.players;
    app.home = home;
    app.away = away;
    const daylight = TIME_OF_DAY[config.timeOfDay] || TIME_OF_DAY.noon;
    const round = app.cup && !app.cup.finished ? currentRound(app.cup) : null;
    app.match = createMatch({
      seed: hashSeed(`${home.id}:${away.id}:${config.formatId}:${config.timeOfDay}:${round ? round.id : "friendly"}`),
      formatId: config.formatId,
      difficulty: round ? round.difficulty : config.difficulty,
      weatherId: daylight.weatherId,
      home,
      away,
      autoPlay,
    });
    app.world = createWorld({
      platform,
      renderer,
      match: app.match,
      home,
      away,
      culture: home.culture,
      timeOfDay: config.timeOfDay,
      quality: config.quality,
    });
    app.hud = createHud({ platform, layer, match: app.match, home, away });
    app.hud.toast(round ? `${round.label}：${away.place.county}${away.shortName}村队` : `${home.shortName}村队  对  ${away.shortName}村队`, "#E8B11B");
    app.screen = "match";
    menu.setVisible(false);
    hideResult();
    app.accumulator = 0;
    app.lastTime = platform.now();
  }

  function disposeMatch() {
    if (app.world) {
      app.world.dispose();
      app.world = null;
    }
    app.hud = null;
    app.match = null;
  }

  function showResult() {
    if (!app.resultSurface) {
      app.resultSurface = layer.createSurface(720, 520);
      app.resultQuad = layer.addQuad({ texture: app.resultSurface.texture, w: 360, h: 260, anchor: "center", depth: 40 });
    }
    const s = app.resultSurface;
    const { ctx, width: w, height: h } = s;
    s.clear();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = "#141A17";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#E8B11B";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.textAlign = "center";
    ctx.fillStyle = "#F5F0E1";
    ctx.font = `bold 46px ${FONT}`;
    const won = app.match.score.home > app.match.score.away;
    if (app.cup && !app.cup.settled) {
      advanceCup(app.cup, won);
      app.cup.settled = true;
    }
    ctx.fillText(app.cup ? (app.cup.champion ? "捧杯！" : app.cup.finished ? "止步于此" : "晋级下一轮") : "全场结束", w / 2, 82);
    ctx.font = `bold 78px ${FONT}`;
    ctx.fillText(`${app.match.score.home} : ${app.match.score.away}`, w / 2, 178);
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = "#B9C4BC";
    ctx.fillText(`${app.home.shortName}村队    ${app.away.shortName}村队`, w / 2, 220);
    const poss = possessionPercent(app.match);
    const shots = app.match.players.reduce((sum, p) => sum + (p.side === "home" ? p.stats.shots : 0), 0);
    const shotsAway = app.match.players.reduce((sum, p) => sum + (p.side === "away" ? p.stats.shots : 0), 0);
    ctx.font = `22px ${FONT}`;
    ctx.fillText(`控球 ${poss.home}% - ${poss.away}%      射门 ${shots} - ${shotsAway}      犯规 ${app.match.fouls.home} - ${app.match.fouls.away}`, w / 2, 262);
    const best = [...app.match.players].sort((a, b) => b.stats.goals * 10 + b.stats.passes - (a.stats.goals * 10 + a.stats.passes))[0];
    if (best) {
      const spec = (best.side === "home" ? app.home : app.away).players[best.index];
      ctx.fillStyle = "#E8B11B";
      ctx.fillText(`全场最佳：${best.number} 号 ${best.name}（${spec.age} 岁 ${spec.vocation}）`, w / 2, 306);
    }
    app.resultHits = [];
    const btnY = 366;
    const btnW = 280;
    const btnH = 68;
    const draw = (x, label, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, btnY, btnW, btnH);
      ctx.fillStyle = "#F5F0E1";
      ctx.font = `bold 30px ${FONT}`;
      ctx.fillText(label, x + btnW / 2, btnY + btnH / 2 + 10);
    };
    if (app.cup) {
      ctx.fillStyle = "#8FA89A";
      ctx.font = `20px ${FONT}`;
      ctx.fillText(cupSummary(app.cup), w / 2, 338);
    }
    const nextLabel = app.cup ? (app.cup.finished ? "重打村寨杯" : "下一轮") : "再来一场";
    draw(58, nextLabel, "#C3272B");
    draw(w - 58 - btnW, "回村里", "#4A5258");
    app.resultHits.push({ x: 58, y: btnY, w: btnW, h: btnH, action: "again" });
    app.resultHits.push({ x: w - 58 - btnW, y: btnY, w: btnW, h: btnH, action: "menu" });
    s.flush();
    const quadW = Math.min(platform.width * 0.86, 460);
    app.resultQuad.setSize(quadW, quadW * (520 / 720));
    app.resultQuad.setPosition(platform.width / 2, platform.height / 2);
    app.resultQuad.setVisible(true);
    app.screen = "result";
  }

  function hideResult() {
    if (app.resultQuad) app.resultQuad.setVisible(false);
    app.resultHits = [];
  }

  platform.onTouchEnd(({ changed }) => {
    if (app.screen !== "result" || !app.resultQuad) return;
    const touch = changed[0];
    if (!touch) return;
    const quadW = app.resultQuad.w;
    const quadH = app.resultQuad.h;
    const left = platform.width / 2 - quadW / 2;
    const top = platform.height / 2 - quadH / 2;
    const sx = ((touch.x - left) / quadW) * 720;
    const sy = ((touch.y - top) / quadH) * 520;
    for (const hit of app.resultHits) {
      if (sx < hit.x || sx > hit.x + hit.w || sy < hit.y || sy > hit.y + hit.h) continue;
      if (hit.action === "again") {
        if (app.cup && app.cup.finished) {
          app.cup = createCup({
            provinceCode: config.provinceCode,
            countyCode: config.countyCode,
            townIndex: config.townIndex,
            perSide: FORMATS[config.formatId].perSide,
          });
        } else if (app.cup) {
          app.cup.settled = false;
        }
        startMatch(app.match?.autoPlay ?? false);
      } else backToMenu();
      return;
    }
  });

  function backToMenu() {
    app.cup = null;
    disposeMatch();
    hideResult();
    app.screen = "menu";
    menu.setVisible(true);
  }

  function handleEvents() {
    if (!app.match || !app.hud) return;
    for (const event of app.match.events) {
      switch (event.type) {
        case "goal": {
          const side = event.side === "home" ? app.home : app.away;
          const scorer = app.match.players.find((p) => p.id === event.playerId);
          app.hud.toast(`进球！${side.shortName}村队 ${scorer ? `${scorer.number} 号 ${scorer.name}` : ""}`, "#FFD966");
          app.world.shake(0.9);
          platform.vibrate("medium");
          break;
        }
        case "save":
          app.hud.toast("门将没收！", "#9FD8FF");
          break;
        case "foul":
          app.hud.toast(event.penalty ? "点球！" : "犯规，任意球", "#FF9E7A");
          app.world.shake(0.35);
          break;
        case "out":
          if (event.kind === "corner") app.hud.toast("角球", "#D8E8C8");
          break;
        case "whistle":
          if (event.kind === "half-time") app.hud.toast("中场休息", "#F5F0E1");
          if (event.kind === "kickoff") app.hud.toast("开球！", "#F5F0E1");
          break;
        case "skill":
          app.world.shake(0.12);
          break;
        default:
          break;
      }
    }
  }

  function frame() {
    platform.raf(frame);
    if (platform.pollResize?.()) resize();
    const now = platform.now();
    let dt = (now - app.lastTime) / 1000;
    app.lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.25);

    if (app.screen === "match" && app.match && app.world) {
      app.accumulator += dt;
      let steps = 0;
      while (app.accumulator >= TICK_DT && steps < 5) {
        app.world.captureTick();
        const input = app.hud.readInput(TICK_DT);
        const dir = app.world.screenToWorld(input.screenX, input.screenY);
        input.moveX = dir.x;
        input.moveZ = dir.z;
        stepMatch(app.match, input);
        handleEvents();
        app.accumulator -= TICK_DT;
        steps += 1;
      }
      const alpha = Math.min(1, app.accumulator / TICK_DT);
      app.hud.update(dt);
      app.world.update(alpha, dt);
      layer.render(renderer);
      if (app.match.finished) showResult();
    } else if (app.screen === "result" && app.world) {
      app.world.update(1, dt);
      layer.render(renderer);
    } else {
      renderer.clear();
      renderer.setClearColor(0x101613, 1);
      renderer.clear();
      layer.render(renderer);
    }
  }

  function resize() {
    renderer.setSize(platform.width, platform.height, false);
    layer.resize(platform.width, platform.height);
    menu.resize();
    app.hud?.resize();
    app.world?.resize(platform.width, platform.height);
  }

  platform.onShow?.(() => {
    app.lastTime = platform.now();
  });

  return {
    start() {
      menu.setVisible(true);
      platform.raf(frame);
    },
    resize,
    config,
    app,
    // 供自动化验收脚本读取内部状态
    debug: { layer, menu, renderer, startMatch, backToMenu },
  };
}
