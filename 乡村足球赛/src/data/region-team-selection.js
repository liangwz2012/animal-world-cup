const {
  children: defaultChildren,
  entry: defaultEntry,
} = require("./administrative-regions");
const {
  MAX_CUSTOM_TEAM_NAME_LENGTH: MAX_CUSTOM_NAME_LENGTH,
  normalizeTeamNameDraft,
  validateCustomTeamName,
} = require("./team-name-policy");

const LEVEL_ORDER = Object.freeze({
  province: 1,
  city: 2,
  county: 3,
  town: 4,
});
const MAX_PATH_LENGTH = 4;

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function cleanCustomName(value) {
  const result = validateCustomTeamName(value, { allowEmpty: true });
  return result.ok ? result.value : "";
}

function clonePlace(place) {
  if (!place || typeof place !== "object") return null;
  const level = text(place.level);
  const code = text(place.code);
  if (!code || !LEVEL_ORDER[level]) return null;
  return {
    code,
    parentCode: text(place.parentCode),
    level,
    name: text(place.name),
    shortName: text(place.shortName || place.name),
  };
}

function pathCodes(input) {
  const source = input && typeof input === "object" ? input : {};
  const raw = Array.isArray(source.path)
    ? source.path
    : (Array.isArray(source.locationCodes) ? source.locationCodes : []);
  const codes = [];
  for (const item of raw.slice(0, MAX_PATH_LENGTH)) {
    const code = text(item && typeof item === "object" ? item.code : item);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

function selectionSnapshot(entries, input) {
  const source = input && typeof input === "object" ? input : {};
  const path = entries.map(clonePlace).filter(Boolean);
  const leaf = path[path.length - 1] || null;
  const customName = leaf ? cleanCustomName(source.customName || source.name) : "";
  const displayName = customName || (leaf && leaf.shortName) || "";
  return {
    version: 1,
    path,
    leaf: leaf && clonePlace(leaf),
    customName,
    displayName,
    locationCodes: path.map((item) => item.code),
    locationLabel: displayName,
    opponentNonce: Math.max(0, Math.floor(Number(source.opponentNonce) || 0)),
  };
}

function lookupEntry(code, options) {
  const config = options || {};
  const resolver = typeof config.entry === "function" ? config.entry : defaultEntry;
  return Promise.resolve(resolver(code, config));
}

function lookupChildren(parentCode, options) {
  const config = options || {};
  const resolver = typeof config.children === "function" ? config.children : defaultChildren;
  return Promise.resolve(resolver(parentCode, config));
}

async function createRegionTeamSelection(input, options) {
  const source = input && typeof input === "object" ? input : {};
  const codes = pathCodes(source);
  if (!codes.length) return selectionSnapshot([], source);
  const entries = [];
  for (const code of codes) {
    const place = clonePlace(await lookupEntry(code, options));
    if (!place) throw new Error(`地区代码无效: ${code}`);
    if (!entries.length) {
      if (place.level !== "province" || place.parentCode) throw new Error("地区路径必须从省级行政区开始");
    } else {
      const parent = entries[entries.length - 1];
      if (place.parentCode !== parent.code) throw new Error(`${place.shortName} 不是 ${parent.shortName} 的下一级地区`);
      if (LEVEL_ORDER[place.level] <= LEVEL_ORDER[parent.level]) throw new Error("地区路径层级顺序无效");
    }
    entries.push(place);
  }
  return selectionSnapshot(entries, source);
}

async function selectRegion(selection, code, options) {
  const current = await createRegionTeamSelection(selection, options);
  const place = clonePlace(await lookupEntry(code, options));
  if (!place) throw new Error("请选择有效地区");
  if (place.level === "province") {
    return selectionSnapshot([place], { opponentNonce: 0 });
  }
  const parentIndex = current.path.findIndex((item) => item.code === place.parentCode);
  if (parentIndex < 0) throw new Error("请选择当前地区的下一级");
  const nextPath = current.path.slice(0, parentIndex + 1);
  nextPath.push(place);
  return selectionSnapshot(nextPath, { opponentNonce: 0 });
}

async function setCustomTeamName(selection, customName, options) {
  const current = await createRegionTeamSelection(selection, options);
  const result = validateCustomTeamName(customName, { allowEmpty: true });
  if (!result.ok) {
    const error = new Error(result.message);
    error.code = result.code;
    throw error;
  }
  return selectionSnapshot(current.path, {
    customName: result.value,
    opponentNonce: current.opponentNonce,
  });
}

function jerseyIdentity(selection, number) {
  const source = selection && typeof selection === "object" ? selection : {};
  const path = Array.isArray(source.path) ? source.path.map(clonePlace).filter(Boolean) : [];
  const leaf = path[path.length - 1] || clonePlace(source.leaf);
  const customName = cleanCustomName(source.customName);
  const locationLabel = customName || text(source.locationLabel) || (leaf && leaf.shortName) || "";
  const numeric = Math.round(Number(number));
  return {
    // 现有球衣解析器只需要最细一级和它的直接上级；完整路径保留在 selection.path。
    locationCodes: path.slice(-2).map((item) => item.code),
    locationLabel,
    customName,
    number: Number.isFinite(numeric) && numeric >= 1 && numeric <= 99 ? numeric : 0,
  };
}

function stableHash(value) {
  let hash = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function candidateRows(rows, anchor) {
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const place = clonePlace(row);
    if (!place || place.level !== anchor.level || place.code === anchor.code) continue;
    if (!items.some((item) => item.code === place.code)) items.push(place);
  }
  return items.sort((left, right) => left.code.localeCompare(right.code, "zh-Hans-CN"));
}

async function resolveOpponentPool(selection, options) {
  const config = options || {};
  const current = await createRegionTeamSelection(selection, config);
  if (!current.leaf) {
    return {
      selection: current,
      candidates: [],
      anchor: null,
      parentCode: "",
      level: "",
      fallback: false,
      fallbackDepth: 0,
      reason: "请先选择主队地区",
    };
  }
  const minimumCandidates = Math.max(1, Math.floor(Number(config.minimumCandidates) || 1));
  for (let index = current.path.length - 1; index >= 0; index -= 1) {
    const anchor = current.path[index];
    const rows = await lookupChildren(anchor.parentCode, config);
    const candidates = candidateRows(rows, anchor);
    if (candidates.length >= minimumCandidates || index === 0) {
      return {
        selection: current,
        candidates,
        anchor: clonePlace(anchor),
        parentCode: anchor.parentCode,
        level: anchor.level,
        fallback: index !== current.path.length - 1,
        fallbackDepth: current.path.length - 1 - index,
        reason: index === current.path.length - 1
          ? ""
          : `${current.leaf.shortName}同级对手不足，已扩大到${anchor.shortName}所在范围`,
      };
    }
  }
  return {
    selection: current,
    candidates: [],
    anchor: clonePlace(current.path[0]),
    parentCode: "",
    level: "province",
    fallback: current.path.length > 1,
    fallbackDepth: Math.max(0, current.path.length - 1),
    reason: "暂未收录可用对手",
  };
}

function opponentResult(pool, opponent, nonce, manual) {
  const seedParts = [
    pool.selection.leaf && pool.selection.leaf.code,
    pool.selection.customName,
    pool.anchor && pool.anchor.code,
    nonce,
  ];
  return {
    opponent: clonePlace(opponent),
    candidates: pool.candidates.map(clonePlace),
    anchor: clonePlace(pool.anchor),
    parentCode: pool.parentCode,
    level: pool.level,
    fallback: pool.fallback,
    fallbackDepth: pool.fallbackDepth,
    reason: pool.reason,
    nonce,
    manual: !!manual,
    stableKey: seedParts.join("|"),
  };
}

async function pickStableOpponent(selection, options) {
  const config = options || {};
  const pool = await resolveOpponentPool(selection, config);
  const nonceSource = config.nonce == null ? pool.selection.opponentNonce : config.nonce;
  const nonce = Math.max(0, Math.floor(Number(nonceSource) || 0));
  if (!pool.candidates.length) return opponentResult(pool, null, nonce, false);
  const seed = text(config.seed) || "rural-football";
  const key = `${seed}|${pool.selection.leaf.code}|${pool.selection.customName}|${pool.anchor.code}|${nonce}`;
  const opponent = pool.candidates[stableHash(key) % pool.candidates.length];
  return opponentResult(pool, opponent, nonce, false);
}

async function rerollOpponent(selection, currentOpponent, options) {
  const config = options || {};
  const currentCode = text(currentOpponent && typeof currentOpponent === "object"
    ? currentOpponent.code
    : currentOpponent);
  const nonce = Math.max(0, Math.floor(Number(config.nonce) || 0)) + 1;
  // 只有一个同级对手时向上回退，保证“换一个”确实能换；回退状态会显式返回给 UI。
  const pool = await resolveOpponentPool(selection, Object.assign({}, config, { minimumCandidates: currentCode ? 2 : 1 }));
  let candidates = pool.candidates;
  if (currentCode && candidates.length > 1) {
    const alternatives = candidates.filter((item) => item.code !== currentCode);
    if (alternatives.length) candidates = alternatives;
  }
  if (!candidates.length) return opponentResult(pool, null, nonce, false);
  const seed = text(config.seed) || "rural-football";
  const key = `${seed}|${pool.selection.leaf.code}|${pool.selection.customName}|${pool.anchor.code}|${nonce}`;
  const opponent = candidates[stableHash(key) % candidates.length];
  return opponentResult(Object.assign({}, pool, { candidates: pool.candidates }), opponent, nonce, false);
}

async function selectManualOpponent(selection, code, options) {
  const pool = await resolveOpponentPool(selection, options);
  const normalized = text(code);
  const opponent = pool.candidates.find((item) => item.code === normalized);
  if (!opponent) throw new Error("手选对手必须来自当前同级同父地区");
  return opponentResult(pool, opponent, Math.max(0, Math.floor(Number(options && options.nonce) || 0)), true);
}

module.exports = {
  LEVEL_ORDER,
  MAX_CUSTOM_NAME_LENGTH,
  cleanCustomName,
  createRegionTeamSelection,
  jerseyIdentity,
  pickStableOpponent,
  rerollOpponent,
  resolveOpponentPool,
  selectManualOpponent,
  selectRegion,
  setCustomTeamName,
  normalizeTeamNameDraft,
  validateCustomTeamName,
  stableHash,
};
