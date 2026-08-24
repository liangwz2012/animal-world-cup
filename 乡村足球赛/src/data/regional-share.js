const { regionIdentity } = require("./region-identity");
const { normalizeRegionalShareFeature } = require("./remote-feature-contracts");

const FALLBACK_TITLE = "选好家乡队，快来踢球！";

function withoutTeamSuffix(value) {
  return String(value || "").replace(/队$/u, "");
}

function pathPart(path, level) {
  return (Array.isArray(path) ? path : []).find((item) => item && item.level === level) || null;
}

function sideIdentity(region, jersey) {
  const source = region && typeof region === "object" ? region : {};
  const identity = regionIdentity(source.path, source.customName);
  const leaf = identity.leaf;
  const fallback = jersey && typeof jersey === "object" ? jersey : {};
  const town = pathPart(identity.path, "town");
  const custom = withoutTeamSuffix(identity.customName);
  const customWithTown = custom && town
    ? (custom.startsWith(town.shortName) || custom.startsWith(town.officialName) ? custom : `${town.officialName}${custom}`)
    : custom;
  const rawLeaf = customWithTown || leaf && leaf.officialName || fallback.locationLabel || "乡亲";
  return Object.assign(identity, {
    leafToken: withoutTeamSuffix(rawLeaf),
    compactLeaf: custom || leaf && leaf.shortName || withoutTeamSuffix(fallback.locationLabel) || "乡亲",
    province: pathPart(identity.path, "province"),
    city: pathPart(identity.path, "city"),
    county: pathPart(identity.path, "county"),
    town,
  });
}

function commonPath(red, blue) {
  const result = [];
  const length = Math.min(red.path.length, blue.path.length);
  for (let index = 0; index < length; index += 1) {
    if (red.path[index].code !== blue.path[index].code) break;
    result.push(red.path[index]);
  }
  return result;
}

function compactTeam(side, category) {
  const leaf = side.compactLeaf || side.leafToken || "乡亲";
  const prefix = category === "sameProvince"
    ? side.city && side.city.shortName || side.county && side.county.shortName || side.province && side.province.shortName || ""
    : side.province && side.province.shortName || "";
  return `${prefix}${leaf}队`;
}

function localTeam(side, category) {
  const custom = withoutTeamSuffix(side.customName);
  const town = side.town && side.town.shortName || "";
  const leaf = custom ? `${town}${custom}` : side.compactLeaf || side.leafToken || "乡亲";
  const prefix = category === "sameCounty"
    ? side.county && side.county.shortName || side.city && side.city.shortName || ""
    : category === "sameProvince"
      ? side.city && side.city.shortName || side.county && side.county.shortName || ""
      : side.province && side.province.shortName || side.city && side.city.shortName || "";
  return `${prefix}${leaf}`;
}

function renderTemplate(template, values) {
  return String(template || "").replace(/{{([A-Za-z]+)}}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "");
}

function regionalShareTitle(config, feature) {
  const source = config && typeof config === "object" ? config : {};
  const red = sideIdentity(source.redRegion, source.redJersey);
  const blue = sideIdentity(source.blueRegion, source.blueJersey);
  if (!red.path.length || !blue.path.length) return FALLBACK_TITLE;
  const common = commonPath(red, blue);
  const commonCounty = common.find((item) => item.level === "county");
  const commonProvince = common.find((item) => item.level === "province");
  const category = commonCounty ? "sameCounty" : commonProvince ? "sameProvince" : "crossProvince";
  const normalizedFeature = normalizeRegionalShareFeature(feature);
  if (!normalizedFeature.enabled) return FALLBACK_TITLE;
  const commonRegionPath = commonCounty
    ? common.filter((item) => item.level === "city" || item.level === "county")
    : common;
  const values = {
    commonRegion: commonRegionPath.map((item) => item.officialName).join(""),
    commonProvince: commonProvince ? commonProvince.officialName : "",
    redLeaf: red.leafToken,
    blueLeaf: blue.leafToken,
    redCompact: compactTeam(red, category),
    blueCompact: compactTeam(blue, category),
    redLocal: localTeam(red, category),
    blueLocal: localTeam(blue, category),
    redFull: red.fullTeamName,
    blueFull: blue.fullTeamName,
  };
  const template = category === "sameCounty"
    ? normalizedFeature.sameCountyTemplate
    : category === "sameProvince"
      ? normalizedFeature.sameProvinceTemplate
      : normalizedFeature.crossProvinceTemplate;
  const rendered = renderTemplate(template, values).replace(/\s+/g, " ").trim();
  return rendered && Array.from(rendered).length <= 80 ? rendered : FALLBACK_TITLE;
}

function regionalScoreShareTitle(config, score, feature) {
  const base = regionalShareTitle(config, feature);
  const values = Array.isArray(score) ? score : [];
  const red = Math.max(0, Math.floor(Number(values[0]) || 0));
  const blue = Math.max(0, Math.floor(Number(values[1]) || 0));
  const matchup = base
    .replace(/[，,]\s*快来踢球[！!]?$/u, "")
    .replace(/[！!]$/u, "")
    .trim();
  const title = `${matchup} ${red}:${blue}！快来踢球`;
  return matchup && Array.from(title).length <= 80 ? title : base;
}

module.exports = {
  FALLBACK_TITLE,
  regionalScoreShareTitle,
  regionalShareTitle,
  renderTemplate,
  sideIdentity,
};
