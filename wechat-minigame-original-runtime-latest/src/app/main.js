const { bootOriginalRuntime, reportFatal } = require("../boot/start");
const { createGameShell } = require("../ui/game-shell");
const { createMatchChrome } = require("../ui/match-chrome");
const { defaults, formation, normalizeConfig } = require("../data/game-options");
const { SoundBank } = require("../audio/sound-bank");
const { createFriendMatchCoordinator } = require("./friend-match-coordinator");
const { initTeamConfig } = require("../net/remote-config");
const { createPlayGate } = require("../monetize/play-gate");

// 仅用于开发者工具无法把鼠标转换成 wx.onTouch 的衔接验收；提交前保持 false。
const DEV_AUTO_START_AI = false;
const DEV_AUTO_SHOW_RESULT = false;
const DEV_AUTO_RETURN_HOME_REMATCH = false;

function startAnimalFootballApp() {
  // 远程队列配置：缓存即时生效（早于 shell 渲染），后台拉新供下次启动；失败回落本地。
  initTeamConfig(typeof wx !== "undefined" ? wx : null, typeof globalThis !== "undefined" ? globalThis : null);
  let shell = null;
  let runtime = null;
  let activeChrome = null;
  let friendCoordinator = null;
  let devMatchStarts = 0;
  let currentConfig = normalizeConfig(defaults());
  const sound = new SoundBank(typeof wx !== "undefined" ? wx : null);
  // 场次解锁：每日免费 N 局，用完后转发/看激励视频解锁（见 src/monetize/）。
  // 只拦「立即开赛/再来一局」的单机对局；观看对战与好友对战不消耗场次。
  // 面板用项目风格的 shell 卡片呈现（shell 未就绪时回落原生 ActionSheet）。
  const playGate = createPlayGate({
    wxApi: typeof wx !== "undefined" ? wx : null,
    present: (payload) => {
      if (shell && typeof shell.showUnlockPanel === "function") return shell.showUnlockPanel(payload);
      return false;
    },
  });
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
    // 场次闸门：仅单机「立即开赛/再来一局」消耗场次；观看/好友对战放行。
    if (normalized.mode !== "watch" && (normalized.syncRole || "off") === "off") {
      const gate = playGate.tryConsume();
      if (!gate.ok) {
        console.info("[animal-football-app] PLAY_GATE_BLOCKED", JSON.stringify(gate.state));
        // 关键：「再来一局」被拦时 shell 舞台还处于比赛期的分离/隐藏状态，直接画面板
        // 会不可见。先复用赛后回主页机制把 shell 挂回可见容器，再在其上弹解锁面板。
        attachShellHome(normalized);
        playGate.requestUnlock({
          onUnlocked: () => beginMatch(normalized),
          onCancel: () => attachShellHome(normalized),
        });
        return;
      }
    }
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
    if (action === "watch" || action === "ai") {
      // 顺序：先选队 → 首次"立即开赛"前插入操作教学 → 学完立刻开赛。
      // 这样"怎么玩"学完马上就用，不再出现"先教学、再回去选队"的脱节。
      if (action === "ai" && shell && typeof shell.hasSeenTutorial === "function"
        && !shell.hasSeenTutorial() && typeof shell.showTutorial === "function") {
        const pendingConfig = config;
        shell.showTutorial(() => beginMatch(pendingConfig));
        return;
      }
      beginMatch(config);
    }
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
            title: context.inputHost.__ANIMAL_FOOTBALL_LAST_SHARE_TITLE__ || "动物足球赛 · 选择你的动物球队",
            imageUrl: context.inputHost.__ANIMAL_FOOTBALL_LAST_SHARE_CARD__
              || context.inputHost.__ANIMAL_FOOTBALL_LAST_SCREENSHOT__ || undefined,
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
        resolution: Math.min(Number(context.inputHost.devicePixelRatio) || 1, 3),
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
          // 直接进选队主页；操作教学改到首次"立即开赛"前触发（见 handleShellAction）。
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
