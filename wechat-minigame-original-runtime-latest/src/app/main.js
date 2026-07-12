const { bootOriginalRuntime, reportFatal } = require("../boot/start");
const { createGameShell } = require("../ui/game-shell");
const { createMatchChrome } = require("../ui/match-chrome");
const { defaults, formation, normalizeConfig } = require("../data/game-options");
const { SoundBank } = require("../audio/sound-bank");
const { createFriendMatchCoordinator } = require("./friend-match-coordinator");

// 仅用于开发者工具无法把鼠标转换成 wx.onTouch 的衔接验收；提交前保持 false。
const DEV_AUTO_START_AI = false;
const DEV_AUTO_SHOW_RESULT = false;
const DEV_AUTO_RETURN_HOME_REMATCH = false;

function startAnimalFootballApp() {
  let shell = null;
  let runtime = null;
  let activeChrome = null;
  let friendCoordinator = null;
  let devMatchStarts = 0;
  let currentConfig = normalizeConfig(defaults());
  const sound = new SoundBank(typeof wx !== "undefined" ? wx : null);
  const diagnostics = {
    get shell() { return shell; },
    get runtime() { return runtime; },
    action(action, config) { return handleShellAction(action, config || (shell && shell.config)); },
    startAi() { return handleShellAction("ai", shell && shell.config); },
    startWatch() { return handleShellAction("watch", shell && shell.config); },
    inviteFriend() { return handleShellAction("invite", shell && shell.config); },
    get friend() { return friendCoordinator && friendCoordinator.diagnostics(); },
  };
  if (typeof globalThis !== "undefined") globalThis.__ANIMAL_FOOTBALL_APP__ = diagnostics;
  if (typeof GameGlobal !== "undefined") GameGlobal.__ANIMAL_FOOTBALL_APP__ = diagnostics;

  function beginMatch(config) {
    const normalized = normalizeConfig(config);
    currentConfig = normalized;
    console.info("[animal-football-app] BEGIN_MATCH", JSON.stringify(normalized));
    if (!shell || !runtime) return;
    const existingGame = gameObject();
    if (existingGame && shell.screen !== "home") {
      shell.attachLoadingToGame(existingGame, "正在加载比赛场景");
    } else {
      shell.showTransitionLoading("正在加载比赛场景");
    }
    shell.setProgress(18, true);
    setTimeout(() => {
      shell.setProgress(46, true);
    }, 90);
    setTimeout(() => {
      shell.setProgress(72, true);
      console.info("[animal-football-app] CALL_RUNTIME_START_MATCH");
      runtime.startMatch({
        redTeam: normalized.redTeam,
        blueTeam: normalized.blueTeam,
        redFormation: formation(normalized.redFormation),
        blueFormation: formation(normalized.blueFormation),
        stadium: "international",
        ball: "classic_1",
        side: normalized.side,
        ai: normalized.ai,
        time: normalized.time,
        mode: normalized.mode,
        roomId: normalized.roomId,
        syncRole: normalized.syncRole,
        sessionKind: normalized.sessionKind,
        matchId: normalized.matchId,
        matchSync: normalized.matchSync,
      });
      let overlayAttempts = 0;
      const attachLoadingOverlay = () => {
        overlayAttempts += 1;
        if (shell.attachLoadingOverlayToGame(gameObject())) return;
        if (overlayAttempts < 30) setTimeout(attachLoadingOverlay, 16);
      };
      attachLoadingOverlay();
    }, 190);
  }

  function handleShellAction(action, config) {
    console.info("[animal-football-app] SHELL_ACTION", action);
    if (friendCoordinator && friendCoordinator.handleAction(action, config)) return;
    if (action === "watch" || action === "ai") beginMatch(config);
  }

  function gameObject() {
    if (!runtime) return null;
    return runtime.root.__matchGame
      || runtime.inputHost.__matchGame
      || runtime.inputHost.window && runtime.inputHost.window.__matchGame;
  }

  function destroyChromeAndControls() {
    if (activeChrome) activeChrome.destroy();
    activeChrome = null;
    if (!runtime) return;
    const overlay = runtime.inputHost.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__;
    if (overlay && typeof overlay.destroy === "function") overlay.destroy();
  }

  function attachShellHome(nextConfig) {
    if (!shell) return;
    const config = normalizeConfig(nextConfig || currentConfig || defaults());
    const game = gameObject();
    destroyChromeAndControls();
    if (game && game.stage) shell.attachHomeToGame(game, config);
    else shell.showHome(config);
  }

  function showFriendRoom(state, nextConfig) {
    attachShellHome(nextConfig || currentConfig);
    if (shell) shell.setFriendState(state);
  }

  function returnHome() {
    if (friendCoordinator && friendCoordinator.handleHomeRequest()) return;
    const game = gameObject();
    destroyChromeAndControls();
    if (game && shell) shell.attachHomeToGame(game, currentConfig);
  }

  function rematch() {
    if (friendCoordinator && friendCoordinator.activePhase) {
      friendCoordinator.handleHomeRequest();
      return;
    }
    destroyChromeAndControls();
    beginMatch(currentConfig);
  }

  return bootOriginalRuntime({
    deferStart: true,
    onPlatformReady(context) {
      if (context.wxApi && context.wxApi.showShareMenu) {
        try { context.wxApi.showShareMenu({ withShareTicket: true }); } catch (error) {}
      }
      if (context.wxApi && context.wxApi.onShareAppMessage) {
        context.wxApi.onShareAppMessage(() => {
          const base = {
            title: "动物足球赛 · 选择你的动物球队",
            imageUrl: context.inputHost.__ANIMAL_FOOTBALL_LAST_SCREENSHOT__ || undefined,
          };
          return friendCoordinator ? friendCoordinator.sharePayload(base) : base;
        });
      }
      shell = createGameShell({
        PIXI: context.PIXI,
        canvas: context.canvas,
        wxApi: context.wxApi,
        width: context.inputHost.innerWidth || 1280,
        height: context.inputHost.innerHeight || 720,
        resolution: Math.min(Number(context.inputHost.devicePixelRatio) || 1, 2),
        pixelRatio: Math.max(1, Number(context.inputHost.devicePixelRatio) || 1),
        config: defaults(),
        onAction: handleShellAction,
        requestFrame: context.inputHost.requestAnimationFrame && context.inputHost.requestAnimationFrame.bind(context.inputHost),
        cancelFrame: context.inputHost.cancelAnimationFrame && context.inputHost.cancelAnimationFrame.bind(context.inputHost),
      });
      friendCoordinator = createFriendMatchCoordinator({
        wxApi: context.wxApi,
        globalObject: context.inputHost,
        getShell: () => shell,
        getRuntime: () => runtime,
        beginMatch,
        prepareMatchTransition() { destroyChromeAndControls(); },
        prepareLobbyTransition(nextConfig) { attachShellHome(nextConfig); },
        showFriendRoom,
        showHome(nextConfig) { attachShellHome(nextConfig); },
        showMatchResult(result) {
          if (activeChrome && result) activeChrome.showResult(result);
        },
      });
      if (context.wxApi && typeof context.wxApi.onShow === "function") {
        context.wxApi.onShow((entry) => {
          if (friendCoordinator) friendCoordinator.handleLaunchOptions(entry || {});
        });
      }
      if (context.wxApi && typeof context.wxApi.getLaunchOptionsSync === "function") {
        try { friendCoordinator.handleLaunchOptions(context.wxApi.getLaunchOptionsSync() || {}); } catch (error) {
          console.warn("[animal-football-app] 读取好友邀请失败", error);
        }
      }
    },
    onProgress(progress) {
      if (shell) shell.setProgress(progress);
    },
    onMatchStarted() {
      const game = gameObject();
      if (!game || !runtime) return;
      shell.suspendForMatch();
      if (activeChrome) activeChrome.destroy();
      const runtimeEvents = runtime.root.__animalCupEvents
        || runtime.inputHost.__animalCupEvents
        || runtime.inputHost.window && runtime.inputHost.window.__animalCupEvents
        || runtime.root;
      activeChrome = createMatchChrome({
        PIXI: runtime.inputHost.PIXI || runtime.PIXI,
        game,
        inputHost: runtime.inputHost,
        runtimeEvents,
        wxApi: typeof wx !== "undefined" ? wx : null,
        config: currentConfig,
        sound,
        onHome: returnHome,
        onRematch: rematch,
        onMatchEnded(detail) {
          if (friendCoordinator) friendCoordinator.handleMatchEnded(detail);
        },
      });
      if (friendCoordinator) friendCoordinator.handleMatchStarted(currentConfig);
      if (DEV_AUTO_SHOW_RESULT) {
        setTimeout(() => activeChrome && activeChrome.showResult({ score: [3, 2] }), 3200);
      }
      if (DEV_AUTO_RETURN_HOME_REMATCH) {
        devMatchStarts += 1;
        if (devMatchStarts === 1) {
          setTimeout(() => {
            returnHome();
            setTimeout(rematch, 2500);
          }, 4500);
        }
      }
    },
  }).then((api) => {
    runtime = api;
    runtime.root.__ANIMAL_FOOTBALL_APP__ = diagnostics;
    runtime.inputHost.__ANIMAL_FOOTBALL_APP__ = diagnostics;
    if (runtime.inputHost.window) runtime.inputHost.window.__ANIMAL_FOOTBALL_APP__ = diagnostics;
    if (typeof wx !== "undefined") wx.__ANIMAL_FOOTBALL_APP__ = diagnostics;
    const loadingEvents = runtime.root.__animalCupEvents
      || runtime.inputHost.__animalCupEvents
      || runtime.inputHost.window && runtime.inputHost.window.__animalCupEvents
      || runtime.root;
    if (loadingEvents && typeof loadingEvents.addEventListener === "function") {
      loadingEvents.addEventListener("ab-load-progress", (event) => {
        const raw = Math.max(0, Math.min(100, Number(event && event.detail) || 0));
        if (shell) shell.setProgress(Math.min(98, 82 + raw * 0.16), true);
      });
    }
    if (shell) {
      shell.setProgress(100);
      const showReadyHome = () => {
        const friendState = friendCoordinator && friendCoordinator.diagnostics();
        if (!friendState || (!friendState.role && !friendState.roomId && !friendState.pendingIntent)) {
          shell.showHome(defaults());
        }
        console.info("[animal-football-app] HOME_READY", `devAutoStart=${DEV_AUTO_START_AI}`);
        if (DEV_AUTO_START_AI) setTimeout(() => diagnostics.startAi(), 1200);
      };
      Promise.race([
        shell.whenPortraitsReady(),
        new Promise((resolve) => setTimeout(resolve, 3600)),
      ]).then(() => setTimeout(showReadyHome, 280));
    }
    return { shell, runtime };
  });
}

module.exports = { startAnimalFootballApp };
