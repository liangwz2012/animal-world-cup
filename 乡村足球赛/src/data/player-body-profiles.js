const { RURAL_SQUAD } = require("./rural-squad");

const MIN_VISUAL_SCALE = 0.88;
const MAX_VISUAL_SCALE = 1.12;
const RUNTIME_SIDE_SIZE = 7;

const BODY_PROFILES = Object.freeze({
  balanced: Object.freeze({
    scaleX: 1, scaleY: 1, label: "标准",
    fit: Object.freeze({ shirtX: 1, shirtY: 1, sleeveX: 1, sleeveY: 1, shortsX: 1, shortsY: 1, sockX: 1, sockY: 1, shoeX: 1, shoeY: 1 }),
  }),
  "tall-slim": Object.freeze({
    scaleX: 0.9, scaleY: 1.1, label: "高瘦",
    fit: Object.freeze({ shirtX: 0.99, shirtY: 1.01, sleeveX: 0.99, sleeveY: 1.01, shortsX: 0.99, shortsY: 1.01, sockX: 1, sockY: 1, shoeX: 1, shoeY: 1 }),
  }),
  "compact-strong": Object.freeze({
    scaleX: 1.1, scaleY: 0.94, label: "矮壮",
    fit: Object.freeze({ shirtX: 1.01, shirtY: 0.99, sleeveX: 1.01, sleeveY: 0.99, shortsX: 1.01, shortsY: 0.99, sockX: 1, sockY: 1, shoeX: 1, shoeY: 1 }),
  }),
  "tall-strong": Object.freeze({
    scaleX: 1.04, scaleY: 1.08, label: "高壮",
    fit: Object.freeze({ shirtX: 1.01, shirtY: 1.01, sleeveX: 1.01, sleeveY: 1.01, shortsX: 1, shortsY: 1, sockX: 1, sockY: 1, shoeX: 1, shoeY: 1 }),
  }),
  large: Object.freeze({
    scaleX: 1.08, scaleY: 1.08, label: "同比例偏大",
    fit: Object.freeze({ shirtX: 1, shirtY: 1, sleeveX: 1, sleeveY: 1, shortsX: 1, shortsY: 1, sockX: 1, sockY: 1, shoeX: 1, shoeY: 1 }),
  }),
});

// 球衣槽位按体型做"裁剪"微调：只缩附件、不动骨骼和头部，零新增图片素材
const KIT_SLOT_FIT = Object.freeze({
  chest_shirt: Object.freeze({ x: "shirtX", y: "shirtY", jitter: true }),
  number: Object.freeze({ x: "shirtX", y: "shirtY", jitter: true }),
  arm_left_sleeve: Object.freeze({ x: "sleeveX", y: "sleeveY" }),
  arm_right_sleeve: Object.freeze({ x: "sleeveX", y: "sleeveY" }),
  pelvis_shorts: Object.freeze({ x: "shortsX", y: "shortsY" }),
  leg_left_shorts: Object.freeze({ x: "shortsX", y: "shortsY" }),
  leg_right_shorts: Object.freeze({ x: "shortsX", y: "shortsY" }),
  leg_left_sock: Object.freeze({ x: "sockX", y: "sockY" }),
  leg_right_sock: Object.freeze({ x: "sockX", y: "sockY" }),
  leg_left_shoe: Object.freeze({ x: "shoeX", y: "shoeY" }),
  leg_right_shoe: Object.freeze({ x: "shoeX", y: "shoeY" }),
});

// 同体型的人只保留约 ±1% 的稳定接缝差异；人物多样性由根骨架体型负责，
// 不能再通过大幅缩放胸衣附件制造，否则会重复放大肩膀和腰身。
function kitJitter(playerId) {
  const value = Math.abs(Number(playerId)) || 0;
  return {
    x: 0.99 + (value % 5) * 0.005,
    y: 0.99 + (Math.floor(value / 5) % 3) * 0.01,
  };
}

// 附件只允许处理接缝，体型已由 Spine 根节点整体缩放。
const KIT_FIT_MIN = 0.97;
const KIT_FIT_MAX = 1.03;

function kitFitScale(value) {
  return clamp(Number.isFinite(value) ? value : 1, KIT_FIT_MIN, KIT_FIT_MAX);
}

function slotNameOf(slot) {
  return (slot && (slot.name || (slot.data && slot.data.name))) || "";
}

function applyKitFit(renderer, profile) {
  const spine = renderer && renderer.spine;
  const skeleton = spine && spine.skeleton;
  const slots = skeleton && skeleton.slots;
  if (!Array.isArray(slots) || !slots.length) return;
  const fit = (profile && profile.fit) || BODY_PROFILES.balanced.fit;
  const jitter = kitJitter(renderer.player && renderer.player.id);
  for (const slot of slots) {
    const binding = KIT_SLOT_FIT[slotNameOf(slot)];
    if (!binding) continue;
    const attachment = slot.attachment;
    if (!attachment) continue;
    if (!attachment.__ruralKitBase) {
      attachment.__ruralKitBase = {
        x: Number.isFinite(attachment.scaleX) ? attachment.scaleX : 1,
        y: Number.isFinite(attachment.scaleY) ? attachment.scaleY : 1,
      };
    }
    const base = attachment.__ruralKitBase;
    const factorX = kitFitScale((Number(fit[binding.x]) || 1) * (binding.jitter ? jitter.x : 1));
    const factorY = kitFitScale((Number(fit[binding.y]) || 1) * (binding.jitter ? jitter.y : 1));
    attachment.scaleX = base.x * factorX;
    attachment.scaleY = base.y * factorY;
  }
}

const PLAYER_PROFILE_SEQUENCE = Object.freeze(
  RURAL_SQUAD.slice(0, RUNTIME_SIDE_SIZE).map((player) => player.bodyProfile),
);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeScale(value) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : 1, MIN_VISUAL_SCALE, MAX_VISUAL_SCALE);
}

function rendererIndex(renderer, fallbackIndex) {
  const id = renderer && renderer.player && Number(renderer.player.id);
  const numeric = Number.isFinite(id) ? Math.trunc(Math.abs(id)) : Math.trunc(Math.abs(fallbackIndex || 0));
  return numeric % RUNTIME_SIDE_SIZE;
}

function collectPlayerRenderers(game) {
  const renderers = [];
  function walk(node, depth) {
    if (!node || depth > 8) return;
    if (node.spine && node.player) {
      const playerId = Number(node.player.id);
      // 比赛双方球员固定为 0-13。运行时还会创建 id=900 的裁判/球衣参考
      // Renderer；它不属于球员体型系统，不能被误计为第 15 名球员。
      if (Number.isFinite(playerId) && playerId >= 0 && playerId < RUNTIME_SIDE_SIZE * 2) {
        renderers.push(node);
      }
      return;
    }
    const children = node.children || [];
    for (const child of children) walk(child, depth + 1);
  }
  walk(game && game.stadium, 0);
  return renderers;
}

function createBodyProfileController(options) {
  options = options || {};
  const targets = [];
  for (const target of options.targets || []) {
    if (target && !targets.includes(target)) targets.push(target);
  }
  let activeGame = null;
  let previewProfile = "";
  const playerOverrides = Object.create(null);
  let lastAssignments = [];
  let installedHook = null;
  let appliedLogSignature = "";

  function profileNameFor(renderer, index) {
    if (previewProfile) return previewProfile;
    const playerId = renderer && renderer.player && Number(renderer.player.id);
    if (Number.isFinite(playerId) && playerOverrides[Math.trunc(playerId)]) {
      return playerOverrides[Math.trunc(playerId)];
    }
    return PLAYER_PROFILE_SEQUENCE[rendererIndex(renderer, index)] || "balanced";
  }

  function applyToRenderer(renderer, index) {
    const spine = renderer && renderer.spine;
    if (!spine || !spine.scale) return null;
    if (!renderer.__ruralBodyBaseScale) {
      const fallback = Number(renderer.defaultScale) > 0 ? Number(renderer.defaultScale) : 0.5;
      renderer.__ruralBodyBaseScale = {
        x: Math.abs(Number(spine.scale.x)) || fallback,
        y: Math.abs(Number(spine.scale.y)) || fallback,
      };
    }
    const name = profileNameFor(renderer, index);
    const profile = BODY_PROFILES[name] || BODY_PROFILES.balanced;
    const base = renderer.__ruralBodyBaseScale;
    const direction = Number(spine.scale.x) < 0 ? -1 : 1;
    const scaleX = safeScale(profile.scaleX);
    const scaleY = safeScale(profile.scaleY);
    spine.scale.x = direction * base.x * scaleX;
    spine.scale.y = base.y * scaleY;

    // 球是独立的比赛实体，只是持球时临时挂到右手容器。抵消人物根缩放，
    // 避免“高瘦球员拿椭圆球”或“大体型球员把足球也放大”。
    if (spine.ballContainer && spine.ballContainer.scale) {
      spine.ballContainer.scale.x = 1 / Math.abs(spine.scale.x || base.x);
      spine.ballContainer.scale.y = 1 / Math.abs(spine.scale.y || base.y);
    }
    applyKitFit(renderer, profile);
    renderer.__ruralBodyProfile = name;
    return {
      playerId: renderer.player && renderer.player.id,
      localIndex: rendererIndex(renderer, index),
      profile: name,
      scaleX,
      scaleY,
    };
  }

  function snapshot() {
    const profiles = {};
    for (const name in BODY_PROFILES) {
      if (!Object.prototype.hasOwnProperty.call(BODY_PROFILES, name)) continue;
      profiles[name] = Object.assign({}, BODY_PROFILES[name]);
    }
    const overrides = {};
    for (const playerId in playerOverrides) {
      if (Object.prototype.hasOwnProperty.call(playerOverrides, playerId)) overrides[playerId] = playerOverrides[playerId];
    }
    return {
      installed: !!installedHook,
      previewProfile,
      limits: { min: MIN_VISUAL_SCALE, max: MAX_VISUAL_SCALE },
      // 不使用 Object.entries/fromEntries：旧版微信开发工具会把它错误转换成
      // 不存在的 @babel/runtime/helpers/Objectentries.js，导致启动阶段直接黑屏。
      profiles,
      playerProfiles: PLAYER_PROFILE_SEQUENCE.slice(),
      applied: lastAssignments.length,
      assignments: lastAssignments.map((entry) => Object.assign({}, entry)),
      overrides,
    };
  }

  function publishStatus() {
    const status = snapshot();
    for (const target of targets) target.__RURAL_BODY_PROFILE_STATUS__ = status;
    return status;
  }

  function applyToGame(game) {
    activeGame = game || activeGame;
    const renderers = collectPlayerRenderers(activeGame);
    lastAssignments = renderers
      .map((renderer, index) => applyToRenderer(renderer, index))
      .filter(Boolean);
    const logSignature = lastAssignments
      .map((entry) => `${entry.playerId}:${entry.profile}:${entry.scaleX}:${entry.scaleY}`)
      .join("|");
    if (lastAssignments.length >= RUNTIME_SIDE_SIZE * 2 && logSignature !== appliedLogSignature) {
      appliedLogSignature = logSignature;
      console.info(
        "[rural-body-profiles] applied",
        `players=${lastAssignments.length}`,
        lastAssignments.map((entry) => `${entry.playerId}:${entry.profile}`).join(","),
      );
    }
    return publishStatus();
  }

  function setPreview(name) {
    const next = name == null ? "" : String(name).trim();
    if (next && !BODY_PROFILES[next]) throw new Error(`未知球员体型：${next}`);
    previewProfile = next;
    return activeGame ? applyToGame(activeGame) : publishStatus();
  }

  function setPlayerProfile(playerId, name) {
    const id = Math.trunc(Number(playerId));
    if (!Number.isFinite(id) || id < 0 || id >= RUNTIME_SIDE_SIZE * 2) throw new Error(`未知球员编号：${playerId}`);
    const next = name == null ? "" : String(name).trim();
    if (next && !BODY_PROFILES[next]) throw new Error(`未知球员体型：${next}`);
    if (next) playerOverrides[id] = next;
    else delete playerOverrides[id];
    return activeGame ? applyToGame(activeGame) : publishStatus();
  }

  function install() {
    installedHook = (game) => applyToGame(game);
    for (const target of targets) {
      target.__RURAL_BODY_PROFILE_APPLY__ = installedHook;
      target.__RURAL_BODY_PROFILE_SET_PREVIEW__ = setPreview;
      target.__RURAL_BODY_PROFILE_SET_PLAYER__ = setPlayerProfile;
    }
    publishStatus();
    return installedHook;
  }

  return {
    applyToGame,
    collectPlayerRenderers,
    install,
    setPreview,
    setPlayerProfile,
    snapshot,
  };
}

module.exports = {
  BODY_PROFILES,
  MAX_VISUAL_SCALE,
  MIN_VISUAL_SCALE,
  PLAYER_PROFILE_SEQUENCE,
  RUNTIME_SIDE_SIZE,
  collectPlayerRenderers,
  createBodyProfileController,
  safeScale,
};
