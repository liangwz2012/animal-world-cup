const { regionIdentity } = require("./region-identity");
const { normalizeRegionalShareFeature } = require("./remote-feature-contracts");

const FALLBACK_TITLE = "乡村足球赛｜快来踢球！";

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

module.exports = {
  FALLBACK_TITLE,
  regionalShareTitle,
  renderTemplate,
  sideIdentity,
};
