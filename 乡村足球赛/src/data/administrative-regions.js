const snapshot = require("./china-administrative-core");

const LEVEL_ORDER = { province: 1, city: 2, county: 3, town: 4 };
const GENERIC_NAMES = new Set(["市辖区", "省直辖县级行政区划", "自治区直辖县级行政区划"]);
const DIRECT_MUNICIPALITY_PREFIXES = new Set(["11", "12", "31", "50"]);
let townsPromise = null;
let townRows = null;

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function compactName(value) {
  return text(value)
    .replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|自治县|自治旗|街道办事处|居民委员会|村民委员会|行政委员会|经济开发区|高新技术产业开发区|产业开发区|管理区|生活区|虚拟社区|办事处|街道|苏木|省|市|盟|区|县|旗|镇|乡|村|社区)$/u, "")
    || text(value);
}

function genericName(value) {
  const name = text(value);
  if (GENERIC_NAMES.has(name)) return true;
  for (const suffix of GENERIC_NAMES) {
    if (name.endsWith(`-${suffix}`)) return true;
  }
  return false;
}

function record(level, raw) {
  const code = text(raw && raw.c);
  const name = text(raw && raw.n);
  if (!code || !name) return null;
  let parentCode = "";
  if (level === "city") parentCode = `${text(raw.p)}0000`;
  if (level === "county") {
    const provincePrefix = text(raw.p);
    const cityPart = text(raw.y);
    // 直辖市没有独立地市记录；河南/湖北/海南/新疆的省直管县则挂在
    // “省直辖县级行政区划”占位节点下。对玩家选择器而言，它们都应当
    // 从省级节点直接下钻，否则会出现无子项或无意义的中间层。
    parentCode = DIRECT_MUNICIPALITY_PREFIXES.has(provincePrefix) || cityPart === "90"
      ? `${provincePrefix}0000`
      : `${provincePrefix}${cityPart}00`;
  }
  if (level === "town") parentCode = code;
  const resolvedCode = level === "town" ? `${code}${text(raw.t)}` : code;
  return {
    code: resolvedCode,
    parentCode,
    level,
    name,
    shortName: compactName(name),
  };
}

const coreRecords = [
  ...(snapshot.provinces || []).map((row) => record("province", row)),
  ...(snapshot.cities || []).map((row) => record("city", row)),
  ...(snapshot.areas || []).map((row) => record("county", row)),
].filter(Boolean);
const coreByCode = new Map(coreRecords.map((item) => [item.code, item]));
const coreChildren = new Map();
for (const item of coreRecords) {
  if (!item.parentCode) continue;
  const siblings = coreChildren.get(item.parentCode) || [];
  siblings.push(item);
  coreChildren.set(item.parentCode, siblings);
}
for (const rows of coreChildren.values()) rows.sort((left, right) => left.code.localeCompare(right.code, "zh-Hans-CN"));

function loadTownModule(options) {
  if (options && typeof options.loadTowns === "function") return options.loadTowns();
  // 启动阶段已在加载 region_data 分包时，复用同一个加载 Promise，
  // 避免并发触发第二次 loadSubpackage（原生端重复注册可能异常）。
  const host = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : {});
  if (host.__RURAL_REGION_DATA_PROMISE__) {
    return Promise.resolve(host.__RURAL_REGION_DATA_PROMISE__).then(() => require("../../region_data/game"))
      .catch((error) => {
        // 启动期加载失败后，原生端不能再安全地按需注册该分包（引擎 define 校验），
        // 明确提示用户重启，而不是留下空白列表。
        try {
          if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: "乡镇数据加载失败，请重启小游戏重试", icon: "none" });
        } catch (toastError) {}
        throw error;
      });
  }
  const wxApi = options && options.wxApi;
  if (!wxApi || typeof wxApi.loadSubpackage !== "function") return Promise.resolve().then(() => require("../../region_data/game"));
  return new Promise((resolve, reject) => {
    wxApi.loadSubpackage({
      name: "region_data",
      success: () => {
        try { resolve(require("../../region_data/game")); } catch (error) { reject(error); }
      },
      fail: (payload) => reject(new Error(`行政区划分包加载失败: ${JSON.stringify(payload || {})}`)),
    });
  });
}

async function ensureTowns(options) {
  if (townRows) return townRows;
  if (!townsPromise) {
    townsPromise = loadTownModule(options).then((module) => {
      const rows = module && Array.isArray(module.towns) ? module.towns : [];
      if (!rows.length) throw new Error("行政区划乡镇数据为空");
      townRows = rows.map((row) => record("town", row)).filter(Boolean);
      return townRows;
    }).catch((error) => {
      townsPromise = null;
      throw error;
    });
  }
  return townsPromise;
}

function coreEntry(code) {
  return coreByCode.get(text(code)) || null;
}

async function entry(code, options) {
  const normalized = text(code);
  const known = coreEntry(normalized);
  if (known) return known;
  if (!/^\d{12}$/.test(normalized)) return null;
  try {
    const towns = await ensureTowns(options);
    return towns.find((item) => item.code === normalized) || null;
  } catch (error) {
    return null;
  }
}

async function pathTo(code, options) {
  const result = [];
  let current = await entry(code, options);
  const seen = new Set();
  while (current && !seen.has(current.code) && result.length < 4) {
    seen.add(current.code);
    result.unshift(current);
    current = current.parentCode ? await entry(current.parentCode, options) : null;
  }
  return result;
}

function sortSelection(items) {
  return items.slice().sort((left, right) => (LEVEL_ORDER[left.level] || 0) - (LEVEL_ORDER[right.level] || 0));
}

function validPair(items) {
  if (items.length < 2) return true;
  const [parent, child] = sortSelection(items);
  return child.parentCode === parent.code;
}

function jerseyFromEntries(items, input) {
  const selected = sortSelection(items);
  const source = input && typeof input === "object" ? input : {};
  // 球衣与场边牌只展示用户最终选中的最细一级；例如选择广东→广州时印“广州”，
  // 选择信宜→镇隆时印“镇隆”。用户已通过级联过程知道所属层级，没必要把文字拼成长串。
  const leaf = selected[selected.length - 1] || null;
  const label = leaf ? leaf.shortName : "";
  const province = selected.find((item) => item.level === "province");
  const city = selected.find((item) => item.level === "city");
  const county = selected.find((item) => item.level === "county");
  const town = selected.find((item) => item.level === "town");
  return {
    codes: selected.map((item) => item.code),
    label,
    levels: selected.map((item) => item.level),
    entries: selected,
    jersey: {
      province: province ? province.name : text(source.province),
      cityOrCounty: (county || city) ? (county || city).name : text(source.cityOrCounty || source.city || source.county),
      village: town ? town.name : text(source.village),
      locationLabel: label,
      locationCodes: selected.map((item) => item.code),
    },
  };
}

async function resolveJerseyLocation(input, options) {
  const source = input && typeof input === "object" ? input : {};
  const codes = Array.from(new Set((Array.isArray(source.locationCodes) ? source.locationCodes : source.codes || [])
    .map(text)
    .filter((code) => /^\d{6}(?:\d{6})?$/.test(code))))
    .slice(0, 2);
  if (!codes.length) return jerseyFromEntries([], source);
  const items = (await Promise.all(codes.map((code) => entry(code, options)))).filter(Boolean);
  const valid = validPair(items);
  const ordered = sortSelection(items);
  const selected = valid ? items : [ordered[ordered.length - 1]].filter(Boolean);
  const result = jerseyFromEntries(selected, source);
  result.valid = valid && selected.length === codes.length;
  result.reason = result.valid ? "" : "两级选择必须是相邻的父子行政区，已保留更细一级";
  return result;
}

async function children(parentCode, options) {
  const normalized = text(parentCode);
  if (!normalized) return coreRecords.filter((item) => item.level === "province");
  const core = coreChildren.get(normalized);
  if (core) return core.filter((item) => !genericName(item.name));
  if (/^\d{6}$/.test(normalized)) {
    try {
      return (await ensureTowns(options)).filter((item) => item.parentCode === normalized && !genericName(item.name));
    } catch (error) {
      return [];
    }
  }
  return [];
}

async function search(keyword, options) {
  const query = compactName(keyword);
  if (!query) return [];
  const source = coreRecords.concat(await ensureTowns(options).catch(() => []));
  return source
    .filter((item) => !genericName(item.name) && (item.name.includes(query) || item.shortName.includes(query)))
    .slice(0, 30);
}

function stats() {
  return {
    source: snapshot.source,
    provinces: (snapshot.provinces || []).length,
    cities: (snapshot.cities || []).length,
    counties: (snapshot.areas || []).length,
    towns: townRows ? townRows.length : 0,
  };
}

module.exports = {
  compactName,
  children,
  entry,
  ensureTowns,
  genericName,
  pathTo,
  resolveJerseyLocation,
  search,
  stats,
};
