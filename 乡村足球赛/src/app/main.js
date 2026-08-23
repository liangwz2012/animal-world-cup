const { bootOriginalRuntime, reportFatal } = require("../boot/start");
const { createGameShell } = require("../ui/game-shell");
const { createMatchChrome } = require("../ui/match-chrome");
const { TEAMS, CAPTAIN_BODY_PROFILES, defaults, formation, normalizeConfig } = require("../data/game-options");
const { BODY_PROFILES } = require("../data/player-body-profiles");
const { SoundBank } = require("../audio/sound-bank");
const { createFriendMatchCoordinator } = require("./friend-match-coordinator");
const { resolveRematchRoute } = require("./rematch-route");
const { setRemoteState } = require("../data/feature-flags");
const { DEFAULT_FEATURES, initTeamConfig, normalizeFeatures } = require("../net/remote-config");
const { createPlayGate } = require("../monetize/play-gate");
const { createLeaderboard } = require("../data/leaderboard");
const { regionalSeedLeaderboard } = require("../data/leaderboard-seeds");
const { readHomeRegionStorage, writeHomeRegionStorage } = require("../data/home-region-storage");
const { children: regionChildren, entry: regionEntry } = require("../data/administrative-regions");
const { createRegionalTeam, ruralScopeOptions, scopeKeyFor } = require("../data/region-league");
const {
  createRegionTeamSelection,
  jerseyIdentity,
  pickStableOpponent,
  rerollOpponent,
  resolveOpponentPool,
  selectManualOpponent,
  selectRegion,
  setCustomTeamName,
} = require("../data/region-team-selection");
const { teamIdForMatchSide } = require("../data/rural-jersey-styles");
const {
  composeRegionalAudience,
  selectRegionalStadium,
} = require("../data/regional-stadiums");
const { createLeaderboardClient } = require("../net/leaderboard-client");
const { createSeasonJourney } = require("../data/season-journey");
const { createDailyChallenge } = require("../data/daily-challenge");
const { regionalShareTitle } = require("../data/regional-share");
const { isDesktopWechat } = require("../input/desktop-keyboard");

// 仅用于开发者工具无法把鼠标转换成 wx.onTouch 的衔接验收；提交前保持 false。
const DEV_AUTO_START_AI = false;
const DEV_AUTO_SHOW_RESULT = false;
const DEV_AUTO_RETURN_HOME_REMATCH = false;

function startRuralFootballApp() {
  const wxApi = typeof wx !== "undefined" ? wx : null;
  const globalObject = typeof globalThis !== "undefined" ? globalThis : {};
  let shell = null;
  let runtime = null;
  let activeChrome = null;
  let friendCoordinator = null;
  let onlineFeatures = normalizeFeatures(DEFAULT_FEATURES);
  let leaderboardClient = null;
  let playGate = null;
  let pendingLaunchOptions = null;
  let devMatchStarts = 0;
  let currentMatchStartedAt = 0;
  // 首页先行：引擎与资源分包在后台继续加载。若用户在就绪前点开赛，
  // 先排队并显示加载页，就绪后自动开赛；启动已失败时保持静默不阻塞首页。
  let bootFailed = false;
  let pendingBeginConfig = null;
  const captainStorageKey = "rural-football:captain-profile:v1";
  const loadCaptainProfile = () => {
    try {
      const value = wxApi && typeof wxApi.getStorageSync === "function" ? wxApi.getStorageSync(captainStorageKey) : "";
      return CAPTAIN_BODY_PROFILES.includes(value) ? value : "large";
    } catch (_) {
      return "large";
    }
  };
  const saveCaptainProfile = (value) => {
    try {
      if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(captainStorageKey, value);
    } catch (_) {}
  };
  let currentConfig = normalizeConfig(Object.assign(defaults(), { redCaptainProfile: loadCaptainProfile() }));
  const storedHomeRegion = readHomeRegionStorage(wxApi);
  let homeRegionRestorePromise = Promise.resolve(currentConfig);
  let regionPickerPath = [];
  let regionPickerContext = null;
  let leaderboardScopeId = "nation";
  // 只记录本次运行中临时浏览的其他地区，不改玩家参赛归属，也不落本机。
  const leaderboardBrowseScopes = new Map();
  const sound = new SoundBank(wxApi);
  // 排行榜的本地账本始终可用；头像/昵称只在用户主动点击加入排行榜后才请求。
  const leaderboard = createLeaderboard({ wxApi });
  // 首发玩法进度只落本机；赛季/每日挑战不需要登录，也不触发头像昵称授权。
  const seasonJourney = createSeasonJourney({ wxApi });
  const dailyChallenge = createDailyChallenge({ wxApi });
  // 首发无限畅玩；云端仅能在真实激励广告位已校验时打开场次闸门。
  // 只拦「立即开赛/再来一局」的单机对局；观看对战与好友对战不消耗场次。
  // 面板用项目风格的 shell 卡片呈现（shell 未就绪时回落原生 ActionSheet）。
  function rebuildCloudClients() {
    leaderboardClient = createLeaderboardClient({
      wxApi,
      globalObject,
      url: onlineFeatures.leaderboard.enabled ? onlineFeatures.leaderboard.apiUrl : "",
    });
    playGate = createPlayGate({
      wxApi,
      enabled: onlineFeatures.monetization.playGateEnabled,
      adUnlockEnabled: onlineFeatures.monetization.adUnlockEnabled,
      adUnitId: onlineFeatures.monetization.rewardedAdUnitId,
      freePerDay: onlineFeatures.monetization.freeMatchesPerDay,
      singleUnlock: onlineFeatures.monetization.singleUnlockMatches,
      dayPassThreshold: onlineFeatures.monetization.dayPassThreshold,
      shareUnlockEnabled: false,
      present: (payload) => {
        if (shell && typeof shell.showUnlockPanel === "function") return shell.showUnlockPanel(payload);
        return false;
      },
    });
  }

  function applyOnlineFeatures(nextFeatures, meta) {
    const raw = nextFeatures && typeof nextFeatures === "object" ? Object.assign({}, nextFeatures) : {};
    const maintenance = meta && meta.maintenance;
    const onlineBlocked = !!(maintenance && maintenance.onlineBlocked);
    // 云端维护开关：服务故障或合规应急时一键关停联网入口（含场次闸门/广告），本地单机不受影响。
    if (onlineBlocked) {
      raw.leaderboard = { enabled: false };
      raw.friend = { enabled: false };
      raw.monetization = { enabled: false };
    }
    onlineFeatures = normalizeFeatures(raw);
    setRemoteState({
      features: onlineFeatures,
      announcement: meta && meta.announcement,
      maintenance,
      events: meta && meta.events,
    });
    rebuildCloudClients();
    if (shell && typeof shell.setOnlineFeatures === "function") shell.setOnlineFeatures(onlineFeatures);
    if (friendCoordinator && onlineFeatures.friend.enabled && pendingLaunchOptions) {
      const launch = pendingLaunchOptions;
      pendingLaunchOptions = null;
      friendCoordinator.handleLaunchOptions(launch);
    }
  }

  function handleFriendLaunchOptions(entry) {
    if (!onlineFeatures.friend.enabled) {
      pendingLaunchOptions = entry || {};
      return false;
    }
    pendingLaunchOptions = null;
    return !!(friendCoordinator && friendCoordinator.handleLaunchOptions(entry || {}));
  }

  applyOnlineFeatures(onlineFeatures);
  // 缓存即时生效，后台拉新不阻塞首页；服务失败时继续保持首发关闭状态。
  initTeamConfig(wxApi, globalObject, { onFeatures: applyOnlineFeatures });
  const diagnostics = {
    get shell() { return shell; },
    get runtime() { return runtime; },
    action(action, config) { return handleShellAction(action, config || (shell && shell.config)); },
    startAi() { return handleShellAction("ai", shell && shell.config); },
    startWatch() { return handleShellAction("watch", shell && shell.config); },
    inviteFriend() { return handleShellAction("invite", shell && shell.config); },
    leaderboard() { return leaderboard.snapshot(); },
    region() { return leaderboard.snapshot().region; },
    features() { return JSON.parse(JSON.stringify(onlineFeatures)); },
    season() { return seasonJourney.snapshot(); },
    dailyChallenge() { return dailyChallenge.snapshot(); },
    jersey() { return runtime && typeof runtime.jerseyStatus === "function" ? runtime.jerseyStatus() : null; },
    bodyProfiles() { return runtime && typeof runtime.bodyProfileStatus === "function" ? runtime.bodyProfileStatus() : null; },
    setBodyProfilePreview(name) {
      return runtime && typeof runtime.setBodyProfilePreview === "function"
        ? runtime.setBodyProfilePreview(name)
        : null;
    },
    get friend() { return friendCoordinator && friendCoordinator.diagnostics(); },
  };
  if (typeof globalThis !== "undefined") globalThis.__RURAL_FOOTBALL_APP__ = diagnostics;
  if (typeof GameGlobal !== "undefined") GameGlobal.__RURAL_FOOTBALL_APP__ = diagnostics;

  function teamName(id) {
    const team = TEAMS.find((item) => item.id === id);
    return team ? team.name : "";
  }

  function campaignView() {
    const season = seasonJourney.snapshot();
    const daily = dailyChallenge.snapshot();
    return {
      season: {
        seasonNumber: season.seasonNumber,
        completedRounds: season.completedRounds,
        totalRounds: season.totalRounds,
        complete: season.complete,
        opponentName: season.nextRound ? teamName(season.nextRound.opponent) : "",
      },
      daily: {
        theme: daily.challenge.theme,
        opponentName: teamName(daily.challenge.blueTeam),
        attempts: daily.attempts,
        completed: !!(daily.best && daily.best.complete),
      },
    };
  }

  function refreshCampaignUi() {
    if (shell && typeof shell.setCampaignState === "function") shell.setCampaignState(campaignView());
  }

  function beginMatch(config) {
    const normalized = normalizeConfig(config);
    const regionalStadium = selectRegionalStadium(normalized.redRegion || normalized.redJersey);
    const regionalAudience = composeRegionalAudience(
      normalized.redRegion || normalized.redJersey,
      normalized.matchId || `${normalized.redJersey.locationLabel}:${normalized.blueJersey.locationLabel}`,
      { count: 24 },
    );
    const prepared = normalizeConfig(Object.assign({}, normalized, {
      regionalStadium,
      regionalAudience,
    }));
    currentConfig = prepared;
    console.info("[rural-football-app] BEGIN_MATCH", JSON.stringify(prepared));
    if (!shell) return;
    if (!runtime) {
      if (bootFailed) {
        if (typeof wx !== "undefined" && wx.showToast) {
          try { wx.showToast({ title: "资源加载失败，请重启小游戏重试", icon: "none" }); } catch (error) {}
        }
        return;
      }
      pendingBeginConfig = prepared;
      shell.showTransitionLoading("比赛资源加载中，请稍候");
      return;
    }
    // 场次闸门：仅单机「立即开赛/再来一局」消耗场次；观看/好友对战放行。
    // 每日挑战允许不限次数重试，不能被普通“立即开赛”的场次闸门卡住。
    if (prepared.journeyMode !== "daily" && prepared.mode !== "watch" && (prepared.syncRole || "off") === "off") {
      const gate = playGate.tryConsume();
      if (!gate.ok) {
        console.info("[rural-football-app] PLAY_GATE_BLOCKED", JSON.stringify(gate.state));
        // 关键：「再来一局」被拦时 shell 舞台还处于比赛期的分离/隐藏状态，直接画面板
        // 会不可见。先复用赛后回主页机制把 shell 挂回可见容器，再在其上弹解锁面板。
        attachShellHome(prepared);
        playGate.requestUnlock({
          onUnlocked: () => beginMatch(prepared),
          onCancel: () => attachShellHome(prepared),
        });
        return;
      }
    }
    currentMatchStartedAt = Date.now();
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
      console.info("[rural-football-app] CALL_RUNTIME_START_MATCH");
      if (typeof runtime.setPlayerBodyProfile === "function") {
        runtime.setPlayerBodyProfile(0, prepared.redCaptainProfile);
      }
      runtime.startMatch({
        redTeam: prepared.redTeam,
        blueTeam: prepared.blueTeam,
        redFormation: formation(prepared.redFormation),
        blueFormation: formation(prepared.blueFormation),
        // 34 省运行时球场共享原版碰撞与球门，只切换轻量省份视觉层。
        stadium: regionalStadium.runtimeThemeId || regionalStadium.fallbackThemeId || "international",
        ball: "classic_1",
        side: prepared.side,
        ai: prepared.ai,
        time: prepared.time,
        mode: prepared.mode,
        roomId: prepared.roomId,
        syncRole: prepared.syncRole,
        sessionKind: prepared.sessionKind,
        matchId: prepared.matchId,
        matchSync: prepared.matchSync,
        redJersey: prepared.redJersey,
        blueJersey: prepared.blueJersey,
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

  function selectedRegionScope(scopeId) {
    const browsed = leaderboardBrowseScopes.get(scopeId || leaderboardScopeId);
    if (browsed && browsed.key) return browsed.key;
    const region = leaderboard.snapshot().region;
    return scopeKeyFor(region, scopeId || leaderboardScopeId);
  }

  function showLeaderboard(metric, scopeOverride) {
    if (!shell || typeof shell.showLeaderboard !== "function") return;
    const ruralFeature = onlineFeatures.ruralLeaderboard || {};
    const metricOrder = Array.isArray(ruralFeature.metrics) && ruralFeature.metrics.length
      ? ruralFeature.metrics
      : ["points", "goals", "winRate"];
    const scopeOrder = Array.isArray(ruralFeature.scopes) && ruralFeature.scopes.length
      ? ruralFeature.scopes
      : ["nation", "province", "city", "county", "town"];
    if (["nation", "province", "city", "county", "town"].includes(scopeOverride)) leaderboardScopeId = scopeOverride;
    if (!scopeOrder.includes(leaderboardScopeId)) {
      leaderboardScopeId = scopeOrder.includes(ruralFeature.defaultScope) ? ruralFeature.defaultScope : "nation";
    }
    const selectedMetric = metricOrder.includes(metric) ? metric : metricOrder[0] || "points";
    const scope = typeof scopeOverride === "string" && scopeOverride.includes(":")
      ? scopeOverride
      : selectedRegionScope(leaderboardScopeId);
    const local = leaderboard.snapshot();
    local.metrics = metricOrder.map((id) => local.metrics.find((item) => item.id === id)).filter(Boolean);
    const scopeOptions = ruralScopeOptions(local.region).map((item) => {
      const browsed = leaderboardBrowseScopes.get(item.id);
      return Object.assign({}, item, browsed || {}, {
        label: item.label,
        enabled: !!((item.enabled || browsed) && scopeOrder.includes(item.id)),
      });
    });
    const baseline = regionalSeedLeaderboard(scope, selectedMetric, 8);
    const activeScopeOption = scopeOptions.find((item) => item.id === leaderboardScopeId && item.key === scope);
    const displayedScope = {
      key: scope,
      title: activeScopeOption && activeScopeOption.title || baseline.scope.title,
    };
    const onlineLeaderboardEnabled = !!(onlineFeatures.leaderboard.enabled && ruralFeature.enabled);
    shell.showLeaderboard(Object.assign({}, local, {
      onlineEnabled: onlineLeaderboardEnabled,
      online: false,
      remoteRows: baseline.rows,
      remoteMetric: baseline.metric,
      remoteScope: displayedScope,
      remoteScopeId: leaderboardScopeId,
      remoteScopeOptions: scopeOptions,
    }));
    if (!onlineLeaderboardEnabled || !leaderboardClient.available()) return;
    leaderboardClient.fetchLeaderboard(selectedMetric, scope).then((result) => {
      if (!shell || typeof shell.showLeaderboard !== "function") return;
      shell.showLeaderboard(Object.assign({}, leaderboard.snapshot(), {
        onlineEnabled: onlineLeaderboardEnabled,
        online: !!result.online,
        remoteRows: result.rows || [],
        remoteSelf: result.self || null,
        remoteMetric: result.metric || selectedMetric,
        remoteScope: activeScopeOption ? displayedScope : (result.scope || displayedScope),
        remoteScopeId: leaderboardScopeId,
        remoteScopeOptions: scopeOptions,
      }));
    }).catch((error) => console.warn("[rural-football-app] 拉取排行榜失败", error && error.message || error));
  }

  function submitRankedResult(recorded, matchConfig) {
    const profile = leaderboard.snapshot().profile;
    const rankedMatchId = matchConfig && matchConfig.rankedMatchId;
    // 普通单机和好友房都只记本机/好友战绩。只有后续“排位赛”流程签发的 rankedMatchId
    // 才允许提交全服榜，不能把客户端可伪造或可对刷的结果混进公开排名。
    if (!recorded || !recorded.accepted || !rankedMatchId || !profile.nickname || !leaderboard.snapshot().region || !leaderboardClient.available()) return;
    leaderboardClient.submitRankedResult(
      rankedMatchId,
      { mine: recorded.match.mine, opponent: recorded.match.opponent },
    ).catch((error) => console.warn("[rural-football-app] 提交排行榜成绩失败", error && error.message || error));
  }

  function isRankedEligible(config) {
    const normalized = normalizeConfig(config);
    const profile = leaderboard.snapshot().profile;
    return onlineFeatures.leaderboard.enabled
      && leaderboardClient && leaderboardClient.available()
      && profile && profile.nickname && profile.avatarUrl
      && leaderboard.snapshot().region
      && normalized.mode !== "watch"
      && (normalized.syncRole || "off") === "off";
  }

  async function startRankedOrLocal(config, options) {
    const normalized = normalizeConfig(config);
    const forceNew = !!(options && options.forceNew);
    if (normalized.rankedMatchId && !forceNew) {
      beginMatch(normalized);
      return;
    }
    const clean = normalizeConfig(Object.assign({}, normalized, {
      matchId: normalized.rankedMatchId ? "" : normalized.matchId,
      rankedMatchId: "",
    }));
    if (!isRankedEligible(clean)) {
      beginMatch(clean);
      return;
    }
    try {
      if (wxApi && wxApi.showLoading) wxApi.showLoading({ title: "正在签发排位赛", mask: true });
      const result = await leaderboardClient.createRankedMatch({
        redTeam: clean.redTeam,
        blueTeam: clean.blueTeam,
        redFormation: clean.redFormation,
        blueFormation: clean.blueFormation,
        ai: clean.ai,
        time: clean.time,
      });
      const signed = result && result.match;
      if (!signed || !/^[A-Za-z0-9_-]{6,128}$/.test(String(signed.id || ""))) throw new Error("服务端没有返回有效排位赛凭证");
      beginMatch(normalizeConfig(Object.assign({}, clean, {
        matchId: signed.id,
        rankedMatchId: signed.id,
      })));
    } catch (error) {
      console.warn("[rural-football-app] 排位签发失败，本局回落本机战绩", error && error.message || error);
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: "联网排位暂不可用，本局记本机战绩", icon: "none" });
      beginMatch(clean);
    } finally {
      if (wxApi && wxApi.hideLoading) wxApi.hideLoading();
    }
  }

  function openPreMatch(config, options) {
    const normalized = normalizeConfig(config);
    if (shell && typeof shell.showPreMatch === "function") {
      shell.showPreMatch(normalized, options || {});
      return;
    }
    // 兼容极早期壳层：运行时不可因赛前界面不可用而阻塞，但正常路径始终先走赛前弹窗。
    beginMatch(normalized);
  }

  function startSoloMatch(config, options) {
    openPreMatch(config, options);
  }

  function startSeason(config) {
    try {
      const season = seasonJourney.snapshot();
      if (season.complete) seasonJourney.startNextSeason();
      const prepared = seasonJourney.prepareMatch({
        teamId: config.redTeam,
        teamIds: TEAMS.map((team) => team.id),
        redFormation: config.redFormation,
        blueFormation: config.blueFormation,
      });
      refreshCampaignUi();
      startSoloMatch(normalizeConfig(Object.assign({}, config, prepared)), {
        kind: "season",
        title: "赛季征程",
        subtitle: "本场对手和规则已确定，选择阵型后开赛",
        lockedRules: true,
      });
    } catch (error) {
      const message = error && error.message || "暂时无法开始赛季征程";
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    }
  }

  function startDailyChallenge(config) {
    try {
      const prepared = dailyChallenge.prepareMatch();
      refreshCampaignUi();
      startSoloMatch(normalizeConfig(Object.assign({}, config, prepared)), {
        kind: "daily",
        title: "每日挑战",
        subtitle: "今日挑战规则已确定，选择阵型后开赛",
        lockedRules: true,
      });
    } catch (error) {
      const message = error && error.message || "暂时无法开始每日挑战";
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    }
  }

  function recordCampaignResult(detail, resultConfig) {
    const config = resultConfig || currentConfig;
    const elapsedMs = currentMatchStartedAt ? Math.max(0, Date.now() - currentMatchStartedAt) : 0;
    let result = null;
    if (config && config.journeyMode === "season") result = seasonJourney.recordMatch(detail, config);
    if (config && config.journeyMode === "daily") result = dailyChallenge.recordMatch(detail, config, { elapsedMs });
    currentMatchStartedAt = 0;
    if (result && result.accepted) {
      refreshCampaignUi();
      console.info("[rural-football-app] CAMPAIGN_MATCH_RECORDED", config.journeyMode, JSON.stringify(result));
      if (typeof wx !== "undefined" && wx.showToast) {
        const title = config.journeyMode === "season"
          ? result.completed ? `赛季完赛：第 ${result.rank} 名` : "赛季进度已保存"
          : result.candidate && result.candidate.complete
            ? result.improved ? "挑战成功，刷新最佳" : "挑战成功"
            : "成绩已记录，再来一次";
        try { wx.showToast({ title, icon: "none", duration: 1800 }); } catch (error) {}
      }
    } else if (result && config && config.journeyMode === "daily" && result.reason === "stale_challenge") {
      if (typeof wx !== "undefined" && wx.showToast) {
        try { wx.showToast({ title: "挑战已跨日，本场成绩未计入", icon: "none", duration: 1800 }); } catch (error) {}
      }
    }
    return result;
  }

  function pickerItem(place) {
    return {
      code: place.code,
      parentCode: place.parentCode || "",
      name: place.name,
      shortName: place.shortName,
      level: place.level,
    };
  }

  function selectionWithMeta(selection, meta) {
    const source = selection && typeof selection === "object" ? selection : {};
    const extra = meta && typeof meta === "object" ? meta : {};
    return {
      path: Array.isArray(source.path) ? source.path.map(pickerItem) : [],
      customName: source.customName || "",
      displayName: source.displayName || source.locationLabel || "",
      opponentNonce: Math.max(0, Math.floor(Number(extra.opponentNonce == null ? source.opponentNonce : extra.opponentNonce) || 0)),
      fallback: !!extra.fallback,
      fallbackReason: extra.fallbackReason || extra.reason || "",
    };
  }

  function applySelection(config, side, selection, meta) {
    const normalized = normalizeConfig(config || currentConfig);
    const regionKey = side === "blue" ? "blueRegion" : "redRegion";
    const jerseyKey = side === "blue" ? "blueJersey" : "redJersey";
    const teamKey = side === "blue" ? "blueTeam" : "redTeam";
    const number = normalized[jerseyKey] && normalized[jerseyKey].number || (side === "blue" ? 9 : 7);
    const nextRegion = selectionWithMeta(selection, meta);
    const nextJersey = Object.assign({}, normalized[jerseyKey], jerseyIdentity(selection, number));
    // 主队视觉是产品识别的一部分：地区只改变队名，不再用地区哈希把红色主场服
    // 换成藏青等其他模板。客队仍按地区稳定选择一套与红队不同的鲜明球衣。
    const teamId = teamIdForMatchSide(side, Object.assign({}, nextRegion, nextJersey));
    return normalizeConfig(Object.assign({}, normalized, {
      [regionKey]: nextRegion,
      [jerseyKey]: nextJersey,
      [teamKey]: teamId,
    }));
  }

  async function opponentSelection(homeSelection, match) {
    if (!match || !match.opponent || !match.anchor) return null;
    const anchorIndex = homeSelection.path.findIndex((item) => item.code === match.anchor.code);
    const parentPath = homeSelection.path.slice(0, Math.max(0, anchorIndex));
    return createRegionTeamSelection({
      path: parentPath.map((item) => item.code).concat(match.opponent.code),
      opponentNonce: match.nonce,
    }, { wxApi });
  }

  async function updateHomeOpponent(config, options) {
    const normalized = normalizeConfig(config || currentConfig);
    const home = await createRegionTeamSelection({
      path: normalized.redRegion.path,
      customName: normalized.redRegion.customName,
      opponentNonce: normalized.redRegion.opponentNonce,
    }, { wxApi });
    if (!home.leaf) {
      currentConfig = normalized;
      if (shell) shell.showHome(currentConfig);
      return currentConfig;
    }
    const input = options && typeof options === "object" ? options : {};
    let match;
    if (input.manualCode) {
      match = await selectManualOpponent(home, input.manualCode, {
        wxApi,
        nonce: home.opponentNonce,
      });
    } else if (input.reroll) {
      match = await rerollOpponent(home, normalized.blueRegion && normalized.blueRegion.leafCode, {
        wxApi,
        nonce: home.opponentNonce,
        seed: "rural-football-home",
      });
    } else {
      match = await pickStableOpponent(home, {
        wxApi,
        nonce: home.opponentNonce,
        seed: "rural-football-home",
      });
    }
    const away = await opponentSelection(home, match);
    let next = applySelection(normalized, "red", home, {
      opponentNonce: match.nonce,
    });
    if (away) {
      next = applySelection(next, "blue", away, {
        opponentNonce: match.nonce,
        fallback: match.fallback,
        fallbackReason: match.reason,
      });
    }
    currentConfig = next;
    writeHomeRegionStorage(wxApi, currentConfig.redRegion);
    const selectedHome = currentConfig.redRegion && currentConfig.redRegion.path && currentConfig.redRegion.path[currentConfig.redRegion.path.length - 1];
    if (selectedHome) {
      try {
        const localRegion = await createRegionalTeam({
          code: selectedHome.code,
          customName: currentConfig.redRegion.customName,
        }, { wxApi });
        leaderboard.setRegion(localRegion);
      } catch (error) {
        console.warn("[rural-football-app] 家乡队同步到本机榜失败", error && error.message || error);
      }
    }
    regionPickerContext = null;
    if (shell) shell.showHome(next);
    return next;
  }

  function showHomeRegionPicker(page = 0) {
    const context = regionPickerContext;
    if (!context || !shell || typeof shell.showRegionPicker !== "function") return;
    if (context.kind === "home-opponent") {
      shell.showRegionPicker({
        mode: "home-opponent",
        title: "手动选择同范围对手",
        path: regionPickerPath.map(pickerItem),
        entries: context.entries.map(pickerItem),
        page,
        allowConfirm: false,
      });
      return;
    }
    const current = regionPickerPath[regionPickerPath.length - 1];
    regionChildren(current && current.code, { wxApi }).then((entries) => {
      if (!shell || !regionPickerContext || regionPickerContext.kind !== "home-region") return;
      shell.showRegionPicker({
        mode: "home-region",
        title: regionPickerContext.side === "blue" ? "选择客队地区" : "选择主队地区",
        path: regionPickerPath.map(pickerItem),
        entries: entries.map(pickerItem),
        page,
        allowConfirm: false,
      });
    }).catch((error) => {
      const message = error && error.message || "地区数据加载失败";
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    });
  }

  function openHomeRegionPicker(config, payload) {
    const normalized = normalizeConfig(config || currentConfig);
    currentConfig = normalized;
    const side = payload && payload.side === "blue" ? "blue" : "red";
    const region = side === "blue" ? normalized.blueRegion : normalized.redRegion;
    const levels = ["province", "city", "county", "town"];
    const requested = payload && levels.includes(payload.level) ? payload.level : levels[Math.min(region.path.length, levels.length - 1)];
    const targetIndex = Math.max(0, levels.indexOf(requested));
    regionPickerPath = region.path.slice(0, targetIndex);
    regionPickerContext = {
      kind: "home-region",
      side,
      targetIndex,
    };
    showHomeRegionPicker(0);
  }

  async function chooseHomeRegionCascade(config, payload) {
    // 级联下拉选择：path 截到 levelIndex 再接新 code，深层选择自动作废重选
    const normalized = normalizeConfig(config || currentConfig);
    const side = payload && payload.side === "blue" ? "blue" : "red";
    const region = side === "blue" ? normalized.blueRegion : normalized.redRegion;
    const levelIndex = Math.max(0, Math.min(3, Number(payload && payload.levelIndex) || 0));
    const code = String(payload && payload.code || "");
    if (!code) return;
    const nextPath = region.path.slice(0, levelIndex).map((item) => item.code).concat(code);
    const selection = await createRegionTeamSelection({ path: nextPath }, { wxApi });
    const next = applySelection(normalized, side, selection);
    if (side === "red") {
      // 主队变化后对手重新自动匹配；客队手选只影响当前这场
      await updateHomeOpponent(next);
      return;
    }
    currentConfig = next;
    if (shell) shell.showHome(next);
  }

  async function chooseHomeRegion(code) {
    const context = regionPickerContext;
    if (!context) return;
    if (context.kind === "home-opponent") {
      await updateHomeOpponent(currentConfig, { manualCode: code });
      return;
    }
    const base = await createRegionTeamSelection({ path: regionPickerPath }, { wxApi });
    const selected = await selectRegion(base, code, { wxApi });
    let next = applySelection(currentConfig, context.side, selected);
    if (context.side === "red") {
      await updateHomeOpponent(next);
    } else {
      currentConfig = next;
      regionPickerContext = null;
      if (shell) shell.showHome(next);
    }
  }

  async function openOpponentPicker(config) {
    currentConfig = normalizeConfig(config || currentConfig);
    const pool = await resolveOpponentPool(currentConfig.redRegion, { wxApi });
    const anchorIndex = pool.anchor
      ? currentConfig.redRegion.path.findIndex((item) => item.code === pool.anchor.code)
      : 0;
    regionPickerPath = currentConfig.redRegion.path.slice(0, Math.max(0, anchorIndex));
    regionPickerContext = {
      kind: "home-opponent",
      entries: pool.candidates || [],
    };
    showHomeRegionPicker(0);
  }

  function promptCustomTeamName(config, payload) {
    const normalized = normalizeConfig(config || currentConfig);
    const side = payload && payload.side === "blue" ? "blue" : "red";
    const region = side === "blue" ? normalized.blueRegion : normalized.redRegion;
    if (!region.path.length || region.leafLevel !== "town") {
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: "选择乡镇后才能填写村名或自定义队名", icon: "none" });
      return;
    }
    if (!wxApi || typeof wxApi.showModal !== "function") return;
    wxApi.showModal({
      title: "村名或自定义队名",
      content: region.customName || "",
      editable: true,
      placeholderText: "例如：东门村、镇隆青年队",
      success(result) {
        if (!result || !result.confirm) return;
        setCustomTeamName(region, result.content || "", { wxApi }).then((selection) => {
          const next = applySelection(normalized, side, selection);
          if (side === "red") return updateHomeOpponent(next);
          currentConfig = next;
          if (shell) shell.showHome(next);
          return next;
        }).catch((error) => {
          const message = error && error.message || "队名设置失败";
          if (wxApi.showToast) wxApi.showToast({ title: message, icon: "none" });
        });
      },
    });
  }

  function showRegionPicker(page = 0) {
    if (!shell || typeof shell.showRegionPicker !== "function") return;
    const current = regionPickerPath[regionPickerPath.length - 1];
    const context = regionPickerContext;
    const browsing = context && context.kind === "leaderboard-browse";
    const reachedTarget = !!(browsing && current && current.level === context.targetScopeId);
    const entriesPromise = reachedTarget
      ? Promise.resolve([])
      : regionChildren(current && current.code, { wxApi });
    entriesPromise.then((entries) => {
      if (!shell || typeof shell.showRegionPicker !== "function") return;
      shell.showRegionPicker({
        mode: browsing ? "leaderboard-browse" : "leaderboard",
        title: browsing ? `选择要查看的${{ province: "省", city: "市", county: "县", town: "乡镇" }[context.targetScopeId]}` : "",
        targetLevel: browsing ? context.targetScopeId : "",
        allowConfirm: browsing ? reachedTarget : true,
        path: regionPickerPath.map(pickerItem),
        entries: entries.map(pickerItem),
        page,
      });
    }).catch((error) => {
      const message = error && error.message || "地区数据加载失败";
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    });
  }

  function openRegionPicker() {
    const profile = leaderboard.snapshot().profile;
    if (!profile.nickname || !profile.avatarUrl) {
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: "请先加入排行榜，再选择地区队", icon: "none" });
      return;
    }
    regionPickerContext = { kind: "leaderboard" };
    regionPickerPath = [];
    showRegionPicker(0);
  }

  function openLeaderboardScopeBrowser(scopeId, metric) {
    if (!["province", "city", "county", "town"].includes(scopeId)) return;
    leaderboardScopeId = scopeId;
    regionPickerContext = {
      kind: "leaderboard-browse",
      targetScopeId: scopeId,
      metric: ["points", "goals", "winRate"].includes(metric) ? metric : "points",
    };
    regionPickerPath = [];
    showRegionPicker(0);
  }

  function stepRegionPicker(code) {
    const current = regionPickerPath[regionPickerPath.length - 1];
    regionEntry(code, { wxApi }).then((place) => {
      if (!place || (current ? place.parentCode !== current.code : place.level !== "province")) throw new Error("请选择当前列表中的地区");
      regionPickerPath = [...regionPickerPath, place];
      showRegionPicker(0);
    }).catch((error) => {
      const message = error && error.message || "地区选择失败";
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
    });
  }

  function confirmRegionalTeam(code) {
    const current = regionPickerPath[regionPickerPath.length - 1];
    if (!current || current.code !== code) return;
    const homeRegion = currentConfig.redRegion;
    const homeLeaf = homeRegion && homeRegion.path && homeRegion.path[homeRegion.path.length - 1];
    const customName = homeLeaf && homeLeaf.code === code ? homeRegion.customName : "";
    createRegionalTeam({ code, customName }, { wxApi }).then((region) => {
      leaderboard.setRegion(region);
      // 本机先保存选择；联网服务未开或短暂失败不影响单机游玩，后续可重新同步。
      const remote = leaderboardClient && leaderboardClient.available()
        ? leaderboardClient.updateRegion(region)
        : Promise.resolve(null);
      return remote.catch((error) => {
        console.warn("[rural-football-app] 同步地区战队失败", error && error.message || error);
        return null;
      }).then(() => {
        regionPickerContext = null;
        showLeaderboard("points", region.scope.key);
      });
    }).catch((error) => {
      const message = error && error.message || "地区队设置失败";
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
    });
  }

  function confirmLeaderboardBrowse(code) {
    const context = regionPickerContext;
    const current = regionPickerPath[regionPickerPath.length - 1];
    if (!context || context.kind !== "leaderboard-browse" || !current || current.code !== code) return;
    if (current.level !== context.targetScopeId) {
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: "请继续选择到对应地区层级", icon: "none" });
      return;
    }
    createRegionalTeam({ code }, { wxApi }).then((region) => {
      const option = ruralScopeOptions(region).find((item) => item.id === context.targetScopeId && item.enabled);
      if (!option) throw new Error("所选地区不能用于当前榜单层级");
      leaderboardBrowseScopes.set(context.targetScopeId, {
        key: option.key,
        title: option.title,
        code: current.code,
      });
      const metric = context.metric;
      regionPickerContext = null;
      leaderboardScopeId = option.id;
      showLeaderboard(metric, option.key);
    }).catch((error) => {
      const message = error && error.message || "地区榜加载失败";
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    });
  }

  function handleShellAction(action, config, payload) {
    console.info("[rural-football-app] SHELL_ACTION", action);
    config = normalizeConfig(config || currentConfig);
    currentConfig = config;
    const reportRegionError = (error) => {
      const message = error && error.message || "地区队设置失败";
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: message, icon: "none" });
      else console.warn("[rural-football-app]", message);
    };
    if (action === "home-region-open") {
      openHomeRegionPicker(config, payload);
      return;
    }
    if (action === "home-region-dropdown") {
      const parentCode = payload && typeof payload.parentCode === "string" ? payload.parentCode : "";
      const side = payload && payload.side === "blue" ? "blue" : "red";
      regionChildren(parentCode, { wxApi }).then((entries) => {
        if (shell && typeof shell.showRegionDropdown === "function") {
          shell.showRegionDropdown({
            side,
            levelIndex: Math.max(0, Math.min(3, Number(payload && payload.levelIndex) || 0)),
            entries: entries.map(pickerItem),
            loading: false,
          });
        }
      }).catch(reportRegionError);
      return;
    }
    if (action === "home-region-select") {
      chooseHomeRegionCascade(config, payload).catch(reportRegionError);
      return;
    }
    if (action === "home-opponent-reroll") {
      updateHomeOpponent(config, { reroll: true }).catch(reportRegionError);
      return;
    }
    if (action === "home-opponent-manual") {
      openOpponentPicker(config).catch(reportRegionError);
      return;
    }
    if (action === "home-region-custom") {
      promptCustomTeamName(config, payload);
      return;
    }
    if (action === "home-captain-custom") {
      if (!wxApi || typeof wxApi.showActionSheet !== "function") {
        if (wxApi && wxApi.showToast) wxApi.showToast({ title: "当前环境暂不支持角色调整", icon: "none" });
        return;
      }
      const itemList = CAPTAIN_BODY_PROFILES.map((name) => {
        const label = BODY_PROFILES[name] && BODY_PROFILES[name].label || name;
        return `${name === config.redCaptainProfile ? "✓ " : ""}${label}`;
      });
      wxApi.showActionSheet({
        alertText: "选择主队队长体型",
        itemList,
        success(result) {
          const index = Math.max(0, Math.min(CAPTAIN_BODY_PROFILES.length - 1, Number(result && result.tapIndex) || 0));
          const profile = CAPTAIN_BODY_PROFILES[index];
          const nextConfig = normalizeConfig(Object.assign({}, config, { redCaptainProfile: profile }));
          currentConfig = nextConfig;
          saveCaptainProfile(profile);
          if (shell) shell.showHome(nextConfig);
          if (wxApi.showToast) wxApi.showToast({ title: `队长体型：${BODY_PROFILES[profile].label}`, icon: "none" });
        },
      });
      return;
    }
    if (action === "leaderboard") {
      regionPickerContext = null;
      showLeaderboard("points");
      return;
    }
    if (action === "leaderboard-metric") {
      showLeaderboard(payload && payload.metric || "points");
      return;
    }
    if (action === "leaderboard-scope") {
      showLeaderboard(payload && payload.metric || "points", payload && payload.scopeId || "nation");
      return;
    }
    if (action === "leaderboard-scope-browse") {
      openLeaderboardScopeBrowser(payload && payload.scopeId, payload && payload.metric);
      return;
    }
    if (action === "leaderboard-region-open") {
      openRegionPicker();
      return;
    }
    if (action === "leaderboard-region-step") {
      if (regionPickerContext && ["home-region", "home-opponent"].includes(regionPickerContext.kind)) {
        chooseHomeRegion(payload && payload.code).catch(reportRegionError);
        return;
      }
      stepRegionPicker(payload && payload.code);
      return;
    }
    if (action === "leaderboard-region-back") {
      if (regionPickerContext && ["home-region", "home-opponent"].includes(regionPickerContext.kind)) {
        regionPickerContext = null;
        shell.showHome(currentConfig);
        return;
      }
      regionPickerPath = regionPickerPath.slice(0, -1);
      showRegionPicker(0);
      return;
    }
    if (action === "leaderboard-region-page") {
      if (regionPickerContext && ["home-region", "home-opponent"].includes(regionPickerContext.kind)) {
        showHomeRegionPicker(payload && payload.page || 0);
        return;
      }
      showRegionPicker(payload && payload.page || 0);
      return;
    }
    if (action === "leaderboard-region-confirm") {
      if (regionPickerContext && ["home-region", "home-opponent"].includes(regionPickerContext.kind)) {
        regionPickerContext = null;
        shell.showHome(currentConfig);
        return;
      }
      if (regionPickerContext && regionPickerContext.kind === "leaderboard-browse") {
        confirmLeaderboardBrowse(payload && payload.code);
      } else {
        confirmRegionalTeam(payload && payload.code);
      }
      return;
    }
    if (action === "leaderboard-region-cancel") {
      if (regionPickerContext && regionPickerContext.kind !== "leaderboard") {
        regionPickerContext = null;
        shell.showHome(currentConfig);
        return;
      }
      const metric = regionPickerContext && regionPickerContext.metric || "points";
      regionPickerContext = null;
      showLeaderboard(metric);
      return;
    }
    if (action === "leaderboard-profile") {
      leaderboard.requestProfile().then(() => {
        const profile = leaderboard.snapshot().profile;
        showLeaderboard("points");
        if (!leaderboardClient.available()) return null;
        return leaderboardClient.updateProfile(profile)
          .then(() => {
            const region = leaderboard.snapshot().region;
            return region ? leaderboardClient.updateRegion(region) : null;
          })
          .then(() => showLeaderboard("points"));
      }).catch((error) => {
        const message = error && error.message || "暂未获取到昵称和头像";
        if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: message, icon: "none" });
      });
      return;
    }
    if (action === "leaderboard-delete-account") {
      const remove = () => {
        const remote = leaderboardClient && leaderboardClient.available()
          ? leaderboardClient.deleteAccount()
          : Promise.resolve({ deleted: false, localOnly: true });
        remote.then(() => {
          leaderboard.clear();
          showLeaderboard("points");
          if (wxApi && wxApi.showToast) wxApi.showToast({ title: "榜单资料已删除", icon: "success" });
        }).catch((error) => {
          const message = error && error.message || "删除榜单资料失败";
          if (wxApi && wxApi.showToast) wxApi.showToast({ title: message, icon: "none" });
        });
      };
      if (wxApi && typeof wxApi.showModal === "function") {
        wxApi.showModal({
          title: "删除榜单账号",
          content: "将删除昵称、头像、地区队和联网战绩；此操作无法恢复。",
          confirmText: "确认删除",
          confirmColor: "#b43b31",
          success(result) { if (result && result.confirm) remove(); },
        });
      } else remove();
      return;
    }
    if (action === "prematch-cancel") {
      attachShellHome(config);
      return;
    }
    if (action === "friend-prepare") {
      if (!onlineFeatures.friend.enabled) {
        if (wxApi && wxApi.showToast) wxApi.showToast({ title: "好友对战暂未开放", icon: "none" });
        return;
      }
      openPreMatch(normalizeConfig(Object.assign({}, config, { mode: "friend" })), {
        kind: "friend",
        title: "邀请好友对战",
        subtitle: "确认双方阵型后创建好友房间",
      });
      return;
    }
    if (action === "prematch-start") {
      const kind = payload && payload.kind || "ai";
      if (kind === "friend") {
        if (!onlineFeatures.friend.enabled) {
          if (wxApi && wxApi.showToast) wxApi.showToast({ title: "好友对战暂未开放", icon: "none" });
          return;
        }
        if (friendCoordinator && friendCoordinator.handleAction("invite", config)) return;
        return;
      }
      startRankedOrLocal(config);
      return;
    }
    if (action === "invite" && !onlineFeatures.friend.enabled) {
      if (wxApi && wxApi.showToast) wxApi.showToast({ title: "好友对战暂未开放", icon: "none" });
      return;
    }
    if (friendCoordinator && friendCoordinator.handleAction(action, config)) return;
    if (action === "season") {
      startSeason(config);
      return;
    }
    if (action === "daily") {
      startDailyChallenge(config);
      return;
    }
    if (action === "watch" || action === "ai") {
      startSoloMatch(config, action === "watch"
        ? { kind: "watch", title: "观看对战", subtitle: "选好阵型后观看 AI 对战" }
        : { kind: "ai", title: "开赛前设置", subtitle: "确认双方阵型后开始比赛" });
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
    refreshCampaignUi();
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
    const config = normalizeConfig(currentConfig);
    // 赛季/每日挑战的「再来一局」必须重新走签发流程拿新场次凭证；直接复用已结算的
    // campaignMatchId/dailyAttemptId 会被账本静默拒收，玩家白踢一场。
    const route = resolveRematchRoute(config);
    if (route === "season") {
      startSeason(config);
      return;
    }
    if (route === "daily") {
      startDailyChallenge(config);
      return;
    }
    startRankedOrLocal(config, { forceNew: true });
  }

  const booted = bootOriginalRuntime({
    deferStart: true,
    onPlatformReady(context) {
      if (context.wxApi && context.wxApi.showShareMenu) {
        try { context.wxApi.showShareMenu({ withShareTicket: true }); } catch (error) {}
      }
      if (context.wxApi && context.wxApi.onShareAppMessage) {
        context.wxApi.onShareAppMessage(() => {
          const base = {
            title: context.inputHost.__RURAL_FOOTBALL_LAST_SHARE_TITLE__
              || regionalShareTitle(currentConfig, onlineFeatures.regionalShare),
            imageUrl: context.inputHost.__RURAL_FOOTBALL_LAST_SHARE_CARD__
              || context.inputHost.__RURAL_FOOTBALL_LAST_SCREENSHOT__ || undefined,
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
        config: currentConfig,
        campaign: campaignView(),
        onlineFeatures,
        desktopControls: isDesktopWechat(context.wxApi),
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
        onMatchResult(result, resultConfig) {
          const recorded = leaderboard.recordMatch(result, resultConfig || currentConfig);
          if (recorded.accepted) console.info("[rural-football-app] LEADERBOARD_MATCH_RECORDED", JSON.stringify(recorded.match));
          submitRankedResult(recorded, resultConfig || currentConfig);
        },
      });
      homeRegionRestorePromise = storedHomeRegion
        ? createRegionTeamSelection({
          path: storedHomeRegion.path.map((item) => item.code),
          customName: storedHomeRegion.customName,
        }, { wxApi }).then((selection) => updateHomeOpponent(applySelection(currentConfig, "red", selection)))
          .catch((error) => {
            console.warn("[rural-football-app] 恢复上次家乡队失败，回落空选择", error && error.message || error);
            return currentConfig;
          })
        : Promise.resolve(currentConfig);
      if (context.wxApi && typeof context.wxApi.onShow === "function") {
        context.wxApi.onShow((entry) => {
          handleFriendLaunchOptions(entry || {});
        });
      }
      if (context.wxApi && typeof context.wxApi.getLaunchOptionsSync === "function") {
        try { handleFriendLaunchOptions(context.wxApi.getLaunchOptionsSync() || {}); } catch (error) {
          console.warn("[rural-football-app] 读取好友邀请失败", error);
        }
      }
      // 首页不等引擎：主包资源已足够渲染选队页，资源分包与引擎在后台并行加载。
      // 用户在首页选队期间后台通常已就绪；就绪前点开赛会进入排队（见 beginMatch）。
      Promise.all([
        Promise.race([
          shell.whenPortraitsReady(),
          new Promise((resolve) => setTimeout(resolve, 3600)),
        ]),
        homeRegionRestorePromise,
      ]).then(() => setTimeout(() => {
        // 已排队开赛的用户正处于过渡加载页，不能把ta拽回首页。
        if (runtime || !shell || shell.screen !== "loading" || pendingBeginConfig) return;
        const friendState = friendCoordinator && friendCoordinator.diagnostics();
        if (friendState && (friendState.role || friendState.roomId || friendState.pendingIntent)) return;
        shell.showHome(currentConfig);
        console.info("[rural-football-app] HOME_READY_EARLY", "engine-booting-in-background");
      }, 280));
    },
    onProgress(progress) {
      if (shell) shell.setProgress(progress);
    },
    onMatchStarted() {
      const game = gameObject();
      if (!game || !runtime) return;
      const jerseyStatus = typeof runtime.jerseyStatus === "function" ? runtime.jerseyStatus() || {} : {};
      const matchChromeConfig = Object.assign({}, currentConfig, {
        redJersey: Object.assign({}, currentConfig.redJersey, {
          locationLabel: jerseyStatus.labels && jerseyStatus.labels.red || currentConfig.redJersey && currentConfig.redJersey.locationLabel,
        }),
        blueJersey: Object.assign({}, currentConfig.blueJersey, {
          locationLabel: jerseyStatus.labels && jerseyStatus.labels.blue || currentConfig.blueJersey && currentConfig.blueJersey.locationLabel,
        }),
      });
      shell.suspendForMatch();
      if (activeChrome) activeChrome.destroy();
      const runtimeEvents = runtime.root.__ruralFootballEvents
        || runtime.inputHost.__ruralFootballEvents
        || runtime.inputHost.window && runtime.inputHost.window.__ruralFootballEvents
        || runtime.root;
      activeChrome = createMatchChrome({
        PIXI: runtime.inputHost.PIXI || runtime.PIXI,
        game,
        inputHost: runtime.inputHost,
        runtimeEvents,
        wxApi: typeof wx !== "undefined" ? wx : null,
        config: matchChromeConfig,
        sound,
        onHome: returnHome,
        onRematch: rematch,
        onMatchEnded(detail) {
          const recorded = leaderboard.recordMatch(detail, currentConfig);
          if (recorded.accepted) console.info("[rural-football-app] LEADERBOARD_MATCH_RECORDED", JSON.stringify(recorded.match));
          submitRankedResult(recorded, currentConfig);
          recordCampaignResult(detail, currentConfig);
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
    runtime.root.__RURAL_FOOTBALL_APP__ = diagnostics;
    runtime.inputHost.__RURAL_FOOTBALL_APP__ = diagnostics;
    if (runtime.inputHost.window) runtime.inputHost.window.__RURAL_FOOTBALL_APP__ = diagnostics;
    if (typeof wx !== "undefined") wx.__RURAL_FOOTBALL_APP__ = diagnostics;
    const loadingEvents = runtime.root.__ruralFootballEvents
      || runtime.inputHost.__ruralFootballEvents
      || runtime.inputHost.window && runtime.inputHost.window.__ruralFootballEvents
      || runtime.root;
    if (loadingEvents && typeof loadingEvents.addEventListener === "function") {
      loadingEvents.addEventListener("ab-load-progress", (event) => {
        const raw = Math.max(0, Math.min(100, Number(event && event.detail) || 0));
        if (shell) shell.setProgress(Math.min(98, 82 + raw * 0.16), true);
      });
    }
    if (shell) {
      shell.setProgress(100);
      const queuedConfig = pendingBeginConfig;
      pendingBeginConfig = null;
      if (queuedConfig) {
        beginMatch(queuedConfig);
      } else if (shell.screen === "loading") {
        const showReadyHome = () => {
          const friendState = friendCoordinator && friendCoordinator.diagnostics();
          if (!friendState || (!friendState.role && !friendState.roomId && !friendState.pendingIntent)) {
            // 直接进选队主页；操作教学改到首次"立即开赛"前触发（见 handleShellAction）。
            shell.showHome(currentConfig);
          }
          console.info("[rural-football-app] HOME_READY", `devAutoStart=${DEV_AUTO_START_AI}`);
          if (DEV_AUTO_START_AI) {
            setTimeout(() => {
              diagnostics.startAi();
              setTimeout(() => handleShellAction("prematch-start", shell && shell.config), 420);
            }, 1200);
          }
        };
        Promise.all([
          Promise.race([
            shell.whenPortraitsReady(),
            new Promise((resolve) => setTimeout(resolve, 3600)),
          ]),
          homeRegionRestorePromise,
        ]).then(() => setTimeout(showReadyHome, 280));
      }
    }
    return { shell, runtime };
  });
  booted.catch(() => {
    bootFailed = true;
    pendingBeginConfig = null;
  });
  return booted;
}

module.exports = { startRuralFootballApp };
