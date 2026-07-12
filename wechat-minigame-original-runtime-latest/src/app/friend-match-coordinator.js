const { normalizeConfig } = require("../data/game-options");
const { RoomClient } = require("../net/room-client");
const { buildFriendInviteQuery, parseFriendInvite } = require("../net/friend-invite");
const { endpointErrorMessage } = require("../net/room-endpoint");
const { createFriendAuth, resolveFriendService } = require("../net/friend-service-config");
const { createFriendInputSampler } = require("../net/friend-input-sampler");

function roomFrom(message) {
  return message && (message.room || message.state) || null;
}

function roleFrom(message, client) {
  return String(message && (message.role || message.self && message.self.role) || client && client.role || "");
}

function createFriendMatchCoordinator(options) {
  const opts = options || {};
  const wxApi = opts.wxApi || null;
  const globalObject = opts.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;
  const setRepeater = opts.setInterval || setInterval;
  const clearRepeater = opts.clearInterval || clearInterval;
  const makeRoomClient = opts.roomClientFactory || ((clientOptions) => new RoomClient(clientOptions));
  const serviceResolver = opts.resolveService || resolveFriendService;
  const authFactory = opts.createAuth || createFriendAuth;
  const sampler = createFriendInputSampler();

  let client = null;
  let endpoint = null;
  let pendingIntent = null;
  let lastIntent = null;
  let connectGeneration = 0;
  let room = null;
  let role = "";
  let invite = "";
  let frozenConfig = normalizeConfig({ mode: "friend" });
  let activePhase = "";
  let pendingWarmupStart = false;
  let pendingLoadReady = false;
  let queuedAfterWarmup = false;
  let guestArrivalPrompted = false;
  let promptingGuest = false;
  let lastLaunchInvite = "";
  let kickoffTimer = null;
  let inputTimer = null;
  let destroyed = false;

  function getShell() { return typeof opts.getShell === "function" ? opts.getShell() : null; }
  function getRuntime() { return typeof opts.getRuntime === "function" ? opts.getRuntime() : null; }

  function notify(title, icon) {
    if (typeof opts.notify === "function") return opts.notify(title, icon);
    if (wxApi && typeof wxApi.showToast === "function") {
      try { wxApi.showToast({ title: String(title || "").slice(0, 18), icon: icon || "none" }); } catch (error) {}
    }
  }

  function showFriend(state) {
    const next = Object.assign({
      role: role === "guest" ? "guest" : "host",
      roomId: room && room.roomId || client && client.roomId || "",
      invite,
      config: frozenConfig,
      guestSpectating: !!(room && room.guestSpectating),
    }, state || {});
    if (typeof opts.showFriendRoom === "function") return opts.showFriendRoom(next, frozenConfig);
    const shell = getShell();
    if (shell && typeof shell.setFriendState === "function") shell.setFriendState(next);
  }

  function showHome() {
    if (typeof opts.showHome === "function") return opts.showHome(frozenConfig);
    const shell = getShell();
    if (shell && typeof shell.showHome === "function") shell.showHome(frozenConfig);
  }

  function showError(error) {
    const message = error && (error.message || error.errMsg) || "好友对战暂不可用";
    if (activePhase) notify(message);
    else showFriend({ status: "error", message });
  }

  function clearKickoffTimer() {
    if (kickoffTimer != null) clearTimer(kickoffTimer);
    kickoffTimer = null;
  }

  function stopGuestInput(sendNeutral) {
    if (inputTimer != null) clearRepeater(inputTimer);
    inputTimer = null;
    if (sendNeutral && client && client.connected && activePhase === "friend-guest") {
      const neutral = sampler.neutral();
      client.sendInput(neutral.input, { frame: neutral.frame, matchId: client.matchId });
    }
  }

  function startGuestInput() {
    stopGuestInput(false);
    sampler.reset();
    inputTimer = setRepeater(() => {
      if (!client || !client.connected || activePhase !== "friend-guest") return;
      const runtime = getRuntime();
      const input = runtime && runtime.touchInput;
      if (!input) return;
      const sampled = sampler.sample(input);
      client.sendInput(sampled.input, { frame: sampled.frame, matchId: client.matchId });
    }, 1000 / 30);
  }

  function resetSession(options) {
    const resetOptions = options || {};
    clearKickoffTimer();
    stopGuestInput(false);
    if (client && resetOptions.close !== false) {
      try { client.close({ leave: resetOptions.leave !== false, reason: resetOptions.reason || "session_reset" }); } catch (error) {}
    }
    client = null;
    endpoint = null;
    pendingIntent = null;
    room = null;
    role = "";
    invite = "";
    activePhase = "";
    pendingWarmupStart = false;
    pendingLoadReady = false;
    queuedAfterWarmup = false;
    guestArrivalPrompted = false;
    promptingGuest = false;
    sampler.reset();
  }

  function sharePayload(base) {
    if (!invite) return Object.assign({}, base || {});
    return Object.assign({}, base || {}, {
      title: "我在动物足球赛等你，来当我的对手！",
      query: buildFriendInviteQuery(invite),
    });
  }

  function shareInvite() {
    if (!invite) return false;
    const payload = sharePayload({
      imageUrl: globalObject.__ANIMAL_FOOTBALL_LAST_SCREENSHOT__ || undefined,
    });
    if (!wxApi || typeof wxApi.shareAppMessage !== "function") {
      notify("请从右上角转发给好友");
      return false;
    }
    try {
      wxApi.shareAppMessage(payload);
      return true;
    } catch (error) {
      notify("转发未打开，请再次点击");
      return false;
    }
  }

  function executeIntent(intent) {
    if (!client || !client.authenticated || !intent) return false;
    pendingIntent = null;
    if (intent.type === "create") return client.createRoom(intent.config);
    if (intent.type === "join") return client.joinInvite(intent.invite);
    return false;
  }

  function bindClient(nextClient) {
    nextClient.on("auth_ok", () => executeIntent(pendingIntent));
    nextClient.on("room_created", (message) => {
      role = "host";
      invite = String(message && message.invite || nextClient.invite || "");
      room = roomFrom(message) || room;
      if (room && room.config) frozenConfig = normalizeConfig(Object.assign({}, room.config, { mode: "friend", roomId: room.roomId }));
      showFriend({ status: "waiting_host", message: "邀请已创建，转发后可以先跟 AI 踢" });
      shareInvite();
    });
    nextClient.on("room_state", handleRoomState);
    nextClient.on("load_match", handleLoadMatch);
    nextClient.on("kickoff_at", handleKickoff);
    nextClient.on("input", (message) => {
      if (activePhase !== "friend-host") return;
      const runtime = getRuntime();
      if (runtime && typeof runtime.setRemoteInput === "function") {
        runtime.setRemoteInput(message.input, {
          sequence: message.seq,
          matchId: message.matchId,
          pulseSeq: message.input && message.input.pulseSeq,
        });
      }
    });
    nextClient.on("snapshot", (message) => {
      if (activePhase !== "friend-guest" && activePhase !== "warmup-guest") return;
      const runtime = getRuntime();
      const payload = message.binary || message.payload;
      if (runtime && payload && typeof runtime.pushAuthoritativeSnapshot === "function") {
        runtime.pushAuthoritativeSnapshot(payload, { sequence: message.seq, matchId: message.matchId });
      }
    });
    nextClient.on("pause", (message) => {
      const runtime = getRuntime();
      if (runtime && typeof runtime.pauseMatchSync === "function") runtime.pauseMatchSync("peer-disconnected");
      stopGuestInput(false);
      if (message && message.reconnectExpired && role === "host") promptGuestTimeout();
      else notify("连接中断，正在等待重连");
    });
    nextClient.on("resume_ok", (message) => {
      if (message && message.aiTakeover) {
        const runtime = getRuntime();
        if (runtime && typeof runtime.setRemotePlayerEnabled === "function") runtime.setRemotePlayerEnabled(false);
        handleKickoff({
          kickoffAt: message.resumeAt,
          serverTime: message.serverTime,
          matchId: message.matchId,
        });
      } else if (message && message.resumeAt) notify("连接已恢复，准备继续");
    });
    nextClient.on("match_end", handleServerMatchEnd);
    nextClient.on("reconnect", () => {
      if (!activePhase) showFriend({ status: "reconnecting", message: "网络波动，正在恢复房间" });
    });
    nextClient.on("reconnect-failed", () => showError(new Error("20 秒内未能恢复好友房间")));
    nextClient.on("error", showError);
    nextClient.on("protocol-error", showError);
  }

  async function connectFor(intent) {
    if (destroyed) return false;
    lastIntent = Object.assign({}, intent);
    pendingIntent = intent;
    endpoint = serviceResolver({ wxApi, globalObject, url: opts.roomUrl });
    if (!endpoint || !endpoint.ok) {
      showError(new Error(endpointErrorMessage(endpoint && endpoint.reason)));
      return false;
    }
    if (client && client.authenticated) return executeIntent(intent);
    if (client) {
      try { client.close({ leave: false, reason: "replace_connection" }); } catch (error) {}
    }
    const generation = ++connectGeneration;
    const nextClient = makeRoomClient({ url: endpoint.url });
    client = nextClient;
    bindClient(nextClient);
    let auth;
    try {
      auth = await authFactory({ wxApi, globalObject, endpoint });
    } catch (error) {
      if (generation === connectGeneration) showError(error);
      return false;
    }
    if (generation !== connectGeneration || client !== nextClient) return false;
    return nextClient.connect({ url: endpoint.url, auth });
  }

  function beginSynchronizedMatch(message, nextRole, sessionKind, startPaused) {
    const config = normalizeConfig(Object.assign({}, message.config || frozenConfig, {
      mode: "friend",
      roomId: message.roomId || room && room.roomId || "",
      localRole: nextRole,
      friendPhase: sessionKind,
      matchSync: {
        role: nextRole,
        sessionKind,
        matchId: message.matchId,
        startPaused: !!startPaused,
        snapshotHz: 20,
        bufferMs: 120,
        sendSnapshot(payload, metadata) {
          if (!client) return false;
          return client.sendSnapshot(payload, {
            sequence: metadata && metadata.sequence,
            matchId: message.matchId,
            phase: sessionKind,
          });
        },
      },
    }));
    frozenConfig = config;
    if (typeof opts.prepareMatchTransition === "function") opts.prepareMatchTransition(config);
    if (typeof opts.beginMatch === "function") opts.beginMatch(config);
  }

  function handleLoadMatch(message) {
    const phase = message && message.phase === "warmup" ? "warmup" : "friend";
    const nextRole = phase === "warmup" ? "guest" : (roleFrom(message, client) === "guest" ? "guest" : "host");
    if (phase === "warmup") {
      activePhase = "warmup-guest";
      pendingLoadReady = false;
      beginSynchronizedMatch(message, "guest", "warmup", false);
      return;
    }
    queuedAfterWarmup = false;
    pendingLoadReady = true;
    activePhase = nextRole === "guest" ? "friend-guest" : "friend-host";
    showFriend({ status: "loading", message: "双方正在加载正式好友比赛" });
    beginSynchronizedMatch(message, nextRole, "friend", true);
  }

  function handleKickoff(message) {
    if (!message || !["friend-host", "friend-guest", "warmup-host", "warmup-guest"].includes(activePhase)) return;
    clearKickoffTimer();
    const delay = Math.max(0, Number(message.kickoffAt) - Number(message.serverTime || message.kickoffAt));
    notify(delay > 500 ? `${Math.max(1, Math.ceil(delay / 1000))} 秒后开球` : "比赛继续");
    kickoffTimer = setTimer(() => {
      kickoffTimer = null;
      const runtime = getRuntime();
      if (runtime && typeof runtime.resumeMatchSync === "function") runtime.resumeMatchSync();
      if (activePhase === "friend-guest") startGuestInput();
    }, delay);
  }

  function mapLobbyState() {
    if (!room || activePhase) return;
    const currentRole = role === "guest" ? "guest" : "host";
    if (room.state === "waiting") {
      if (currentRole === "guest") showFriend({ status: "friend_ready", message: "已上线，等待房主开始好友对战" });
      else showFriend({ status: room.guestOnline ? "friend_ready" : "waiting_host", message: room.guestOnline ? "好友已上线，可以开始对战" : "等待好友打开邀请" });
    } else if (room.state === "warmup") {
      if (currentRole === "guest") showFriend({ status: room.guestSpectating ? "guest_spectating" : "guest_can_spectate" });
      else showFriend({ status: "host_warmup" });
    } else if (room.state === "queue_after_warmup") {
      showFriend({ status: "queued_after_warmup", message: currentRole === "guest" ? "房主踢完当前 AI 比赛后会自动与你对战" : "热身结束后会自动开始好友局" });
    } else if (room.state === "loading") showFriend({ status: "loading" });
    else if (room.state === "paused") showFriend({ status: "reconnecting" });
  }

  function handleRoomState(message) {
    const nextRoom = roomFrom(message);
    if (!nextRoom) return;
    room = nextRoom;
    role = roleFrom(message, client) || role;
    if (room.config) frozenConfig = normalizeConfig(Object.assign({}, room.config, { mode: "friend", roomId: room.roomId }));

    if (!room.guestOnline) {
      guestArrivalPrompted = false;
      promptingGuest = false;
    }
    if (role === "host" && activePhase === "warmup-host" && room.guestOnline && !guestArrivalPrompted && !promptingGuest) {
      promptGuestArrived();
      return;
    }
    if (role === "host" && pendingWarmupStart && ["warmup", "queue_after_warmup"].includes(room.state)) {
      pendingWarmupStart = false;
      activePhase = "warmup-host";
      beginSynchronizedMatch({
        config: room.config,
        roomId: room.roomId,
        matchId: room.warmupMatchId,
      }, "host", "warmup", false);
      return;
    }
    if (room.state === "queue_after_warmup") queuedAfterWarmup = true;
    mapLobbyState();
  }

  function queueAfterWarmup() {
    if (!client) return false;
    queuedAfterWarmup = true;
    client.queueAfterWarmup(true);
    const runtime = getRuntime();
    if (runtime && typeof runtime.resumeMatchSync === "function") runtime.resumeMatchSync();
    notify("好友局已排队，踢完自动开始");
    return true;
  }

  function startFriendNow() {
    if (!client) return false;
    queuedAfterWarmup = true;
    // WebSocket 保序：先把房间标记为“热身后开赛”，再结束热身；
    // 服务端收到 end 后会直接进入正式 load_match。
    client.queueAfterWarmup(true);
    client.endWarmup();
    return true;
  }

  function promptGuestArrived() {
    guestArrivalPrompted = true;
    promptingGuest = true;
    const runtime = getRuntime();
    if (runtime && typeof runtime.pauseMatchSync === "function") runtime.pauseMatchSync("friend-arrived");
    const settle = (startNow) => {
      promptingGuest = false;
      if (startNow) startFriendNow();
      else queueAfterWarmup();
    };
    if (!wxApi || typeof wxApi.showModal !== "function") {
      settle(false);
      return;
    }
    try {
      wxApi.showModal({
        title: "好友已上线",
        content: "现在退出 AI 比赛和好友对战，还是踢完这局后自动开始？",
        confirmText: "立即对战",
        cancelText: "踢完这局",
        success(result) { settle(!!(result && result.confirm)); },
        fail() { settle(false); },
      });
    } catch (error) { settle(false); }
  }

  function promptGuestTimeout() {
    const decide = (useAi) => {
      if (!client) return;
      client.decideGuestTimeout(useAi ? "ai_takeover" : "end_match");
    };
    if (!wxApi || typeof wxApi.showModal !== "function") {
      decide(false);
      return;
    }
    try {
      wxApi.showModal({
        title: "好友连接超时",
        content: "好友 20 秒内没有恢复连接，可以让 AI 接管蓝方，或结束本局。",
        confirmText: "AI接管",
        cancelText: "结束本局",
        success(result) { decide(!!(result && result.confirm)); },
        fail() { decide(false); },
      });
    } catch (error) { decide(false); }
  }

  function handleServerMatchEnd(message) {
    if (message && message.phase === "warmup" && message.roomContinues) {
      if (activePhase === "warmup-guest") {
        activePhase = "";
        if (typeof opts.prepareLobbyTransition === "function") opts.prepareLobbyTransition(frozenConfig);
        showFriend({ status: queuedAfterWarmup ? "queued_after_warmup" : "friend_ready", role: "guest" });
      }
      return;
    }
    if (message && message.phase === "friend" && message.result && typeof opts.showMatchResult === "function") {
      opts.showMatchResult(message.result);
    }
    stopGuestInput(false);
  }

  function handleAction(action, config) {
    if (action === "invite") {
      frozenConfig = normalizeConfig(Object.assign({}, config, { mode: "friend", roomId: "" }));
      showFriend({ status: "creating", role: "host", message: "正在创建专属房间" });
      connectFor({ type: "create", config: frozenConfig });
      return true;
    }
    if (action === "friend-share") return shareInvite();
    if (action === "warmup-ai") {
      if (!client) return false;
      pendingWarmupStart = true;
      client.startWarmup();
      return true;
    }
    if (action === "friend-start") return !!client && client.requestStart();
    if (action === "friend-start-now") return startFriendNow();
    if (action === "queue-friend-after-warmup") return queueAfterWarmup();
    if (action === "cancel-friend-after-warmup") {
      queuedAfterWarmup = false;
      return !!client && client.queueAfterWarmup(false);
    }
    if (action === "watch-warmup") return !!client && client.setWarmupSpectating(true);
    if (action === "stop-watch-warmup") {
      if (client) client.setWarmupSpectating(false);
      activePhase = "";
      if (typeof opts.prepareLobbyTransition === "function") opts.prepareLobbyTransition(frozenConfig);
      showFriend({ status: queuedAfterWarmup ? "queued_after_warmup" : "guest_can_spectate", role: "guest", guestSpectating: false });
      return true;
    }
    if (action === "friend-cancel") {
      resetSession({ close: true, leave: true, reason: "user_cancel" });
      showHome();
      return true;
    }
    if (action === "friend-retry" && lastIntent) {
      showFriend({ status: "creating", message: "正在重新连接好友房" });
      connectFor(lastIntent);
      return true;
    }
    return ["wait-warmup", "friend-ready", "friend-unready"].includes(action);
  }

  function handleLaunchOptions(launchOptions) {
    const parsed = parseFriendInvite(launchOptions);
    if (!parsed.ok) {
      if (parsed.reason !== "missing") {
        showFriend({
          status: "error",
          role: "guest",
          message: parsed.reason === "incompatible_version" ? "邀请版本不兼容，请让好友重新转发" : "好友邀请已经失效",
        });
      }
      return false;
    }
    if (parsed.token === lastLaunchInvite && client && client.roomId) return true;
    lastLaunchInvite = parsed.token;
    role = "guest";
    showFriend({ status: "creating", role: "guest", message: "正在加入好友房间" });
    connectFor({ type: "join", invite: parsed.token });
    return true;
  }

  function handleMatchStarted() {
    if (pendingLoadReady && client && (activePhase === "friend-host" || activePhase === "friend-guest")) {
      pendingLoadReady = false;
      client.loadReady({ roomId: client.roomId, matchId: client.matchId });
    }
  }

  function handleMatchEnded(detail) {
    if (activePhase === "warmup-host") {
      activePhase = "";
      if (client) client.endWarmup();
      return true;
    }
    if (activePhase === "friend-host") {
      if (client) client.sendMatchEnd(detail || null);
      return true;
    }
    return activePhase === "friend-guest" || activePhase === "warmup-guest";
  }

  function handleHomeRequest() {
    if (activePhase === "warmup-host") {
      if (client) client.endWarmup();
      activePhase = "";
      if (typeof opts.prepareLobbyTransition === "function") opts.prepareLobbyTransition(frozenConfig);
      showFriend({ status: room && room.guestOnline ? "friend_ready" : "waiting_host" });
      return true;
    }
    if (activePhase === "warmup-guest") {
      if (client) client.setWarmupSpectating(false);
      activePhase = "";
      if (typeof opts.prepareLobbyTransition === "function") opts.prepareLobbyTransition(frozenConfig);
      showFriend({ status: queuedAfterWarmup ? "queued_after_warmup" : "guest_can_spectate", role: "guest", guestSpectating: false });
      return true;
    }
    if (activePhase === "friend-host" || activePhase === "friend-guest") {
      resetSession({ close: true, leave: true, reason: "left_match" });
      showHome();
      return true;
    }
    return false;
  }

  function destroy() {
    destroyed = true;
    connectGeneration += 1;
    resetSession({ close: true, leave: false, reason: "app_destroy" });
  }

  return {
    destroy,
    handleAction,
    handleHomeRequest,
    handleLaunchOptions,
    handleMatchEnded,
    handleMatchStarted,
    shareInvite,
    sharePayload,
    get activePhase() { return activePhase; },
    get client() { return client; },
    get invite() { return invite; },
    get room() { return room; },
    get role() { return role; },
    diagnostics() {
      return {
        activePhase,
        endpoint,
        invite: !!invite,
        pendingIntent: pendingIntent && pendingIntent.type,
        queuedAfterWarmup,
        role,
        roomState: room && room.state || "",
        roomId: room && room.roomId || "",
        at: now(),
      };
    },
  };
}

module.exports = { createFriendMatchCoordinator, roleFrom, roomFrom };
