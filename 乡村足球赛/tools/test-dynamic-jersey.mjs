import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  normalizeJerseyIdentity,
  resolveMatchJerseyIdentity,
  sourceAssetPath,
  createJerseyTextLayout,
  sampleJerseyLuminance,
  jerseyTextPalette,
  drawLabel,
  createDynamicJerseyComposer,
} = require("../src/ui/dynamic-jersey.js");

assert.equal(normalizeJerseyIdentity({ province: "贵州", cityOrCounty: "榕江县", village: "车江村" }).displayName, "车江村");
assert.equal(normalizeJerseyIdentity({ village: "车江村", customName: "石桥村足球队" }).frontLabel, "石桥村足");
assert.equal(normalizeJerseyIdentity({ customName: "  石 桥 村\n" }).displayName, "石桥村");
assert.equal(sourceAssetPath("argentina", "goalkeeper", "back"), "/match-runtime-min/data/teams/argentina/goalkeeper/shirt_back.png");
assert.equal((await resolveMatchJerseyIdentity({ locationCodes: ["440983", "440983101000"] })).displayName, "镇隆");
let matchTownSubpackageLoads = 0;
const preparedLabel = await resolveMatchJerseyIdentity(
  { locationCodes: ["440983", "440983101000"], locationLabel: "镇隆" },
  { wxApi: { loadSubpackage() { matchTownSubpackageLoads += 1; } } },
);
assert.equal(preparedLabel.displayName, "镇隆");
assert.equal(matchTownSubpackageLoads, 0, "已有地区显示名时，开赛不得重新加载乡镇分包");

const layoutContext = {
  font: "",
  measureText(label) {
    const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "8");
    return { width: Array.from(label).length * size };
  },
};
const frontLayout = createJerseyTextLayout(layoutContext, "镇隆", "front", 56, 52);
const longFrontLayout = createJerseyTextLayout(layoutContext, "镇隆青年足球队", "front", 56, 52);
const backLayout = createJerseyTextLayout(layoutContext, "镇隆青年队", "back", 56, 52);
const highResolutionFront = createJerseyTextLayout(layoutContext, "镇隆", "front", 112, 104);
assert.ok(frontLayout.size > longFrontLayout.size, "长队名必须自动缩小");
assert.ok(longFrontLayout.measuredWidth * longFrontLayout.scaleX <= longFrontLayout.maxWidth + 0.01, "长队名必须压进胸口安全区");
assert.ok(frontLayout.size >= 15, "两字地区名必须在56×52比赛纹理上保持可读字号");
assert.ok(frontLayout.maxWidth >= 45, "正面地区名必须使用主要胸口宽度");
assert.ok(backLayout.y >= 52 * 0.23 && backLayout.y <= 52 * 0.27, "背面地区名应位于肩胛区域，不能顶到领口");
assert.equal(backLayout.y, Math.round(52 * 0.25), "背部队名必须按 0.25 高度比例定位");
const jerseyModuleSource = await fs.readFile(path.join(projectDir, "src/ui/dynamic-jersey.js"), "utf8");
assert.match(jerseyModuleSource, /const BACK_LABEL_Y_RATIO = 0\.25;/, "背部队名比例常量必须保持已验收的 0.25");
assert.match(jerseyModuleSource, /height \* BACK_LABEL_Y_RATIO/, "布局表达式必须真实引用 BACK_LABEL_Y_RATIO，禁止死常量");
assert.ok(Math.abs(highResolutionFront.size / frontLayout.size - 2) < 0.01, "2倍纹理的字体必须同比放大");
assert.equal(highResolutionFront.y, frontLayout.y * 2, "2倍纹理的队名基线必须同比放大");
assert.equal(jerseyTextPalette(220).mode, "dark-on-light");
assert.equal(jerseyTextPalette(40).mode, "light-on-dark");
assert.equal(sampleJerseyLuminance({
  getImageData() {
    return { data: new Uint8ClampedArray([240, 240, 240, 255, 240, 240, 240, 255]) };
  },
}, frontLayout, 56, 52), 240);

const drawCalls = [];
const drawn = drawLabel({
  save() {},
  restore() {},
  measureText: layoutContext.measureText,
  getImageData() {
    return { data: new Uint8ClampedArray([26, 44, 36, 255, 26, 44, 36, 255]) };
  },
  translate(x, y) { drawCalls.push(["translate", x, y]); },
  scale(x, y) { drawCalls.push(["scale", x, y]); },
  fillRect(x, y, width, height) { drawCalls.push(["badge", x, y, width, height]); },
  strokeText(label, x, y) { drawCalls.push(["stroke", label, x, y, this.lineWidth]); },
  fillText(label, x, y) { drawCalls.push(["fill", label, x, y]); },
}, "镇隆青年足球队", "front", 56, 52);
assert.equal(drawn.palette, "light-on-dark");
assert.equal(drawCalls.filter((call) => call[0] === "stroke").length, 2, "地区名必须使用双层描边");
assert.equal(drawCalls.filter((call) => call[0] === "fill").length, 1);
assert.equal(drawCalls.filter((call) => call[0] === "badge").length, 1, "地区名必须有高对比号码布底");

function team(id) {
  const kits = {};
  for (const kit of ["home", "away", "goalkeeper"]) {
    kits[kit] = {
      shirt_front: { name: `/match-runtime-min/data/teams/${id}/${kit}/shirt_front.png` },
      shirt_back: { name: `/match-runtime-min/data/teams/${id}/${kit}/shirt_back.png` },
    };
  }
  return { id, kits };
}

const teams = new Map([["argentina", team("argentina")], ["portugal", team("portugal")]]);
const registryTarget = {};
let imageLoads = 0;
let serial = 0;
const composer = createDynamicJerseyComposer({
  root: registryTarget,
  inputHost: registryTarget,
  resolvePath: (value) => String(value || "").replace(/^\/+/, "runtime-assets/"),
  loadImage: async () => {
    imageLoads += 1;
    return { width: 56, height: 52 };
  },
  createCanvas: () => ({
    getContext: () => ({ clearRect() {}, drawImage() {}, save() {}, restore() {}, strokeText() {}, fillText() {} }),
    toDataURL: () => `data:image/png;base64,jersey-${++serial}`,
  }),
});

composer.installRuntimeHook();
const first = await composer.prepare({
  redTeam: "argentina",
  blueTeam: "portugal",
  redJersey: { customName: "石桥村", number: 7 },
  blueJersey: { village: "稻香村", number: 9 },
});
assert.equal(first.applied, 12, "双方三套球衣的正反面均应生成");
assert.equal(first.failed, 0);
assert.ok(Object.keys(registryTarget.__RURAL_DYNAMIC_IMAGE_DATA_URIS__).length >= 12);
assert.equal(registryTarget.__ANIMAL_DYNAMIC_IMAGE_DATA_URIS__, undefined, "发布代码不得重新建立旧品牌动态图片注册表");
assert.equal(composer.applyToTeamCollection({ get: (id) => teams.get(id) }), 12);
assert.match(teams.get("argentina").kits.home.shirt_front.name, /\.jersey-/);
assert.match(teams.get("portugal").kits.goalkeeper.shirt_back.name, /\.jersey-/);

const second = await composer.prepare({
  redTeam: "argentina",
  blueTeam: "portugal",
  redJersey: { customName: "石桥村", number: 7 },
  blueJersey: { village: "稻香村", number: 9 },
});
assert.equal(second.applied, 12);
assert.equal(imageLoads, 12, "同配置再次开赛必须复用生成缓存");
const targetsBeforeNumberChange = composer.slots().map((slot) => slot.target);
const numberChanged = await composer.prepare({
  redTeam: "argentina",
  blueTeam: "portugal",
  redJersey: { customName: "石桥村", number: 88 },
  blueJersey: { village: "稻香村", number: 66 },
});
assert.equal(numberChanged.applied, 12);
assert.deepEqual(
  composer.slots().map((slot) => slot.target),
  targetsBeforeNumberChange,
  "球员号码由原引擎逐人绘制，不能让球队共享上衣因号码变化而重复生成",
);
assert.equal(imageLoads, 12);

const oldRegistryKeys = Object.keys(registryTarget.__RURAL_DYNAMIC_IMAGE_DATA_URIS__);
const switched = await composer.prepare({
  redTeam: "argentina",
  blueTeam: "portugal",
  redJersey: { customName: "镇隆" },
  blueJersey: { customName: "水口" },
});
assert.equal(switched.applied, 12);
assert.ok(
  oldRegistryKeys.every((key) => !(key in registryTarget.__RURAL_DYNAMIC_IMAGE_DATA_URIS__)),
  "切换比赛时必须释放上一场动态球衣注册项",
);

const stalled = createDynamicJerseyComposer({
  root: {},
  inputHost: {},
  prepareTimeoutMs: 200,
  loadImage: () => new Promise(() => {}),
  createCanvas: () => ({}),
});
const timeoutResult = await stalled.prepare({
  redTeam: "argentina",
  blueTeam: "portugal",
  redJersey: { customName: "镇隆" },
  blueJersey: { customName: "广州" },
});
assert.equal(timeoutResult.applied, 0, "队服生成超时必须回退原球衣");
assert.match(timeoutResult.reason, /超时/);
assert.equal(stalled.slots().length, 0, "超时不得给原引擎注入半成品贴图");

const previewPath = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "动态地区名称预览.png");
const [previewMetadata, previewStats] = await Promise.all([
  sharp(previewPath).metadata(),
  fs.stat(previewPath),
]);
assert.equal(previewMetadata.width, 1200);
assert.equal(previewMetadata.height, 740);
assert.ok(previewStats.size < 500 * 1024, "动态地区名称预览必须压缩在 500 KiB 内");

console.info("[test:dynamic-jersey] PASS：地区简称、自适应压缩、明暗描边、十二张队服纹理、号码隔离、缓存与引擎注入正常");
