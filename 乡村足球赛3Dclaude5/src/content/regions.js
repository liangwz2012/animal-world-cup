// 地域文化系统：9 个母版家族 + 34 个省级叠加层。
// 母版决定球场周围的地貌、建筑和光照；省级叠加决定标志性小品、横幅用语和观众服饰倾向。
// 所有元素都是几何体 + 程序化贴图，不引入任何外部美术资源。

export const CULTURE_FAMILIES = Object.freeze({
  "southwest-mountain": {
    id: "southwest-mountain",
    name: "西南山地村寨",
    blurb: "梯田环抱、鼓楼风雨桥，村超的原点",
    sky: { top: "#8FC5E8", bottom: "#DCEBF2", sun: "#FFF2D0" },
    fog: { color: "#C9DCE2", density: 0.0085 },
    ground: { grass: "#4E7F3E", grassAlt: "#5E8F45", soil: "#7A5B3C", line: "#F3F0E4" },
    terrain: { hills: 0.85, terrace: true, water: "stream", treeLine: 0.9 },
    props: ["drum-tower", "wind-rain-bridge", "stilt-house", "terrace-field", "fir-forest", "banner-arch", "bamboo-fence"],
    crowd: { density: 0.95, palette: ["#1F3F6B", "#C3272B", "#2E7350", "#E8B11B", "#F5E9D0"], style: "ethnic-festival" },
    lighting: { intensity: 1.02, ambient: "#BFD6DD", shadow: 0.85 },
    audio: "lusheng",
  },
  jiangnan: {
    id: "jiangnan",
    name: "江南水乡村场",
    blurb: "白墙黛瓦、石桥流水、油菜花田",
    sky: { top: "#9DC3DE", bottom: "#EAF1F3", sun: "#FFF6E2" },
    fog: { color: "#DCE7EA", density: 0.011 },
    ground: { grass: "#5B8A4A", grassAlt: "#6C9A55", soil: "#8A7A5E", line: "#FAF7EC" },
    terrain: { hills: 0.2, terrace: false, water: "canal", treeLine: 0.5 },
    props: ["white-wall-house", "stone-arch-bridge", "wu-peng-boat", "rape-flower-field", "willow", "banner-arch", "clay-jar"],
    crowd: { density: 0.85, palette: ["#2A4E7A", "#7A9EB8", "#C9D6C0", "#B44B4B", "#EFE7D2"], style: "market-town" },
    lighting: { intensity: 0.96, ambient: "#D2E0E4", shadow: 0.7 },
    audio: "pipa",
  },
  lingnan: {
    id: "lingnan",
    name: "岭南乡村球场",
    blurb: "大榕树、镬耳墙、荔枝林与龙舟",
    sky: { top: "#7EC0E4", bottom: "#E4F1F0", sun: "#FFF0C8" },
    fog: { color: "#D6E9E6", density: 0.009 },
    ground: { grass: "#3F7A3C", grassAlt: "#4F8C46", soil: "#8C6742", line: "#F6F2E6" },
    terrain: { hills: 0.35, terrace: false, water: "pond", treeLine: 0.8 },
    props: ["wok-ear-house", "banyan-tree", "arcade-shop", "lychee-grove", "dragon-boat", "banner-arch", "ancestral-hall"],
    crowd: { density: 1, palette: ["#C3272B", "#E8B11B", "#2E7350", "#F5E9D0", "#3B5C8A"], style: "clan-village" },
    lighting: { intensity: 1.05, ambient: "#CBE3DC", shadow: 0.8 },
    audio: "gongdrum",
  },
  "northern-plain": {
    id: "northern-plain",
    name: "北方平原麦场",
    blurb: "麦垛打谷场、砖瓦院墙、白杨成行",
    sky: { top: "#A7C6DE", bottom: "#F0EEE2", sun: "#FFF3CE" },
    fog: { color: "#E4E4D6", density: 0.0075 },
    ground: { grass: "#6E8B45", grassAlt: "#7E9B50", soil: "#9C7A4E", line: "#FBF8EC" },
    terrain: { hills: 0.08, terrace: false, water: "none", treeLine: 0.4 },
    props: ["brick-courtyard", "wheat-stack", "poplar-row", "tractor", "grain-drying-yard", "banner-arch", "well-head"],
    crowd: { density: 0.8, palette: ["#8C3A2B", "#2E4A7A", "#D8C48A", "#4A6B3A", "#EDE3CB"], style: "wheat-village" },
    lighting: { intensity: 1.08, ambient: "#E6E2CE", shadow: 0.9 },
    audio: "suona",
  },
  northeast: {
    id: "northeast",
    name: "东北黑土村场",
    blurb: "白桦成排、红砖粮仓、玉米金黄",
    sky: { top: "#93B7D8", bottom: "#E8F0F4", sun: "#FFF7DC" },
    fog: { color: "#DDE7EC", density: 0.008 },
    ground: { grass: "#5C7C3E", grassAlt: "#6B8C46", soil: "#4A3A2C", line: "#FAF6EA" },
    terrain: { hills: 0.15, terrace: false, water: "none", treeLine: 0.7 },
    props: ["birch-row", "grain-barn", "red-brick-house", "corn-rack", "haystack", "banner-arch", "chimney"],
    crowd: { density: 0.75, palette: ["#B4322C", "#274A6B", "#D9B65C", "#3F6B4A", "#F0E6D0"], style: "black-soil" },
    lighting: { intensity: 1, ambient: "#DCE6EA", shadow: 0.75 },
    audio: "errenzhuan",
  },
  "northwest-loess": {
    id: "northwest-loess",
    name: "西北黄土绿洲",
    blurb: "窑洞土塬、葡萄架、白杨挡风林",
    sky: { top: "#9BB8D2", bottom: "#F3EAD8", sun: "#FFEEBE" },
    fog: { color: "#EADCC2", density: 0.0095 },
    ground: { grass: "#7C8B44", grassAlt: "#8B9950", soil: "#B08A52", line: "#FBF6E4" },
    terrain: { hills: 0.6, terrace: true, water: "none", treeLine: 0.35 },
    props: ["cave-dwelling", "loess-ridge", "grape-trellis", "poplar-row", "windmill", "banner-arch", "sheepfold"],
    crowd: { density: 0.7, palette: ["#C05A2B", "#2F4E7A", "#E0C78C", "#7A3B3B", "#F2E8D2"], style: "loess-village" },
    lighting: { intensity: 1.12, ambient: "#EEE0C4", shadow: 0.95 },
    audio: "waist-drum",
  },
  plateau: {
    id: "plateau",
    name: "高原石村球场",
    blurb: "雪山远景、石砌村舍、牦牛与彩幡",
    sky: { top: "#3E7FC1", bottom: "#CFE6F2", sun: "#FFFFF0" },
    fog: { color: "#D8EAF4", density: 0.006 },
    ground: { grass: "#6C8E4C", grassAlt: "#7C9E58", soil: "#8E7A5C", line: "#FFFDF2" },
    terrain: { hills: 1, terrace: false, water: "none", treeLine: 0.2, snowPeak: true },
    props: ["stone-house", "stone-cairn", "colour-banner-line", "yak", "barley-field", "banner-arch", "prayer-wall"],
    crowd: { density: 0.65, palette: ["#B03A2E", "#1F4E79", "#E0B84C", "#3E7A5A", "#F4EEDC"], style: "highland" },
    lighting: { intensity: 1.18, ambient: "#D8E8F2", shadow: 1 },
    audio: "horn",
  },
  coastal: {
    id: "coastal",
    name: "海岛沿海村场",
    blurb: "椰林渔船、晒网架、海风与灯塔",
    sky: { top: "#5FB4E0", bottom: "#DFF2F4", sun: "#FFF6D6" },
    fog: { color: "#D4EAEE", density: 0.007 },
    ground: { grass: "#4E8A54", grassAlt: "#5E9A5E", soil: "#C6B287", line: "#FBFAF0" },
    terrain: { hills: 0.25, terrace: false, water: "sea", treeLine: 0.6 },
    props: ["coconut-palm", "fishing-boat", "net-rack", "lighthouse", "stone-fish-house", "banner-arch", "shell-wall"],
    crowd: { density: 0.85, palette: ["#1F6E8C", "#E8B11B", "#C3272B", "#F5E9D0", "#3E8A6A"], style: "fishing-village" },
    lighting: { intensity: 1.1, ambient: "#D8EEF0", shadow: 0.85 },
    audio: "sea-drum",
  },
  "capital-outskirt": {
    id: "capital-outskirt",
    name: "京畿近郊村场",
    blurb: "灰砖四合院、国槐成荫、砖影壁",
    sky: { top: "#A9C4DA", bottom: "#EFEFE8", sun: "#FFF4D6" },
    fog: { color: "#E2E4DE", density: 0.008 },
    ground: { grass: "#5F8248", grassAlt: "#6E9152", soil: "#8E7C60", line: "#FAF8EE" },
    terrain: { hills: 0.18, terrace: false, water: "none", treeLine: 0.55 },
    props: ["grey-courtyard", "screen-wall", "scholar-tree", "stone-drum", "bicycle-shed", "banner-arch", "lamp-post"],
    crowd: { density: 0.9, palette: ["#8C3A3A", "#2F4A6B", "#D6C49A", "#4A6B4A", "#F0EADA"], style: "suburb" },
    lighting: { intensity: 1, ambient: "#E4E6E0", shadow: 0.8 },
    audio: "drum-gong",
  },
});

// 省级叠加：家族 + 标志性小品 + 横幅词 + 观众口号。地名与队名来自真实行政区划数据。
export const PROVINCE_STYLES = Object.freeze({
  "110000": { family: "capital-outskirt", accent: ["screen-wall", "scholar-tree"], flavor: "京郊麦收后的土场", cheer: "加油！" },
  "120000": { family: "capital-outskirt", accent: ["grey-courtyard", "lamp-post"], flavor: "津郊运河边的球场", cheer: "冲啊！" },
  "130000": { family: "northern-plain", accent: ["wheat-stack", "well-head"], flavor: "冀中平原打谷场", cheer: "使劲儿！" },
  "140000": { family: "northwest-loess", accent: ["cave-dwelling", "sheepfold"], flavor: "晋中土塬边的球场", cheer: "得劲！" },
  "150000": { family: "plateau", accent: ["yurt", "horse-post"], flavor: "草原上的敖包球场", cheer: "赛因！" },
  "210000": { family: "northeast", accent: ["grain-barn", "corn-rack"], flavor: "辽南屯里的煤渣场", cheer: "整上！" },
  "220000": { family: "northeast", accent: ["birch-row", "chimney"], flavor: "吉林黑土地村场", cheer: "干哈呢！" },
  "230000": { family: "northeast", accent: ["haystack", "birch-row"], flavor: "黑土屯的雪后球场", cheer: "老铁冲！" },
  "310000": { family: "jiangnan", accent: ["canal-dock", "willow"], flavor: "沪郊水乡村场", cheer: "加油噢！" },
  "320000": { family: "jiangnan", accent: ["stone-arch-bridge", "rape-flower-field"], flavor: "苏北圩村球场", cheer: "冲呀！" },
  "330000": { family: "jiangnan", accent: ["white-wall-house", "tea-terrace"], flavor: "浙东山村球场", cheer: "闹猛！" },
  "340000": { family: "jiangnan", accent: ["clay-jar", "rape-flower-field"], flavor: "皖南徽墙村场", cheer: "上啊！" },
  "350000": { family: "coastal", accent: ["stone-fish-house", "banyan-tree"], flavor: "闽南红砖厝球场", cheer: "拼啦！" },
  "360000": { family: "jiangnan", accent: ["rice-terrace", "willow"], flavor: "赣中稻田边球场", cheer: "呷劲！" },
  "370000": { family: "northern-plain", accent: ["brick-courtyard", "tractor"], flavor: "鲁西麦场球场", cheer: "使劲！" },
  "410000": { family: "northern-plain", accent: ["grain-drying-yard", "poplar-row"], flavor: "豫东打麦场", cheer: "中！" },
  "420000": { family: "jiangnan", accent: ["lotus-pond", "clay-jar"], flavor: "鄂中垸村球场", cheer: "搞快点！" },
  "430000": { family: "southwest-mountain", accent: ["rice-terrace", "fir-forest"], flavor: "湘西吊脚楼球场", cheer: "霸得蛮！" },
  "440000": { family: "lingnan", accent: ["wok-ear-house", "lychee-grove"], flavor: "粤东祠堂前球场", cheer: "顶硬上！" },
  "450000": { family: "lingnan", accent: ["drum-tower", "rice-terrace"], flavor: "桂北村寨球场", cheer: "得劲咧！" },
  "460000": { family: "coastal", accent: ["coconut-palm", "fishing-boat"], flavor: "琼北椰林球场", cheer: "冲啊！" },
  "500000": { family: "southwest-mountain", accent: ["stilt-house", "rice-terrace"], flavor: "渝东山村球场", cheer: "雄起！" },
  "510000": { family: "southwest-mountain", accent: ["bamboo-fence", "tea-terrace"], flavor: "川南竹林球场", cheer: "雄起！" },
  "520000": { family: "southwest-mountain", accent: ["drum-tower", "wind-rain-bridge"], flavor: "黔东南村超主场", cheer: "干！" },
  "530000": { family: "southwest-mountain", accent: ["terrace-field", "banana-grove"], flavor: "滇西梯田球场", cheer: "加油嘎！" },
  "540000": { family: "plateau", accent: ["stone-cairn", "yak"], flavor: "藏东南石村球场", cheer: "呀啦嗦！" },
  "610000": { family: "northwest-loess", accent: ["cave-dwelling", "waist-drum-stage"], flavor: "陕北窑洞球场", cheer: "美滴很！" },
  "620000": { family: "northwest-loess", accent: ["loess-ridge", "windmill"], flavor: "陇中旱塬球场", cheer: "攒劲！" },
  "630000": { family: "plateau", accent: ["barley-field", "stone-house"], flavor: "青海高原村场", cheer: "好着呢！" },
  "640000": { family: "northwest-loess", accent: ["grape-trellis", "sheepfold"], flavor: "宁夏引黄灌区球场", cheer: "攒劲！" },
  "650000": { family: "northwest-loess", accent: ["grape-trellis", "poplar-row"], flavor: "天山脚下绿洲球场", cheer: "亚克西！" },
});

const FALLBACK_STYLE = Object.freeze({ family: "northern-plain", accent: ["wheat-stack"], flavor: "乡村土场", cheer: "加油！" });

export function provinceStyle(provinceCode) {
  return PROVINCE_STYLES[provinceCode] || FALLBACK_STYLE;
}

export function cultureFor(provinceCode) {
  const style = provinceStyle(provinceCode);
  const family = CULTURE_FAMILIES[style.family] || CULTURE_FAMILIES["northern-plain"];
  return {
    ...family,
    accent: style.accent,
    flavor: style.flavor,
    cheer: style.cheer,
    props: [...new Set([...family.props, ...style.accent])],
  };
}

export const TIME_OF_DAY = Object.freeze({
  morning: { id: "morning", label: "清晨", sunAngle: 0.28, warm: 0.35, exposure: 1, weatherId: "clear" },
  noon: { id: "noon", label: "晌午", sunAngle: 1.18, warm: 0.1, exposure: 1.08, weatherId: "clear" },
  dusk: { id: "dusk", label: "黄昏", sunAngle: 0.18, warm: 0.85, exposure: 0.95, weatherId: "dusk" },
  night: { id: "night", label: "夜灯", sunAngle: 0.9, warm: 0.55, exposure: 0.72, weatherId: "night" },
  rain: { id: "rain", label: "雨后", sunAngle: 0.62, warm: 0.15, exposure: 0.85, weatherId: "rain" },
});

export function listFamilies() {
  return Object.values(CULTURE_FAMILIES);
}
