import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outDir = path.join(root, "备案截图", "动物足球赛");
fs.mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 720;
const gameName = "动物足球赛";

const asset = (...parts) => path.join(root, ...parts);
const portrait = (id) => asset("public", "animal-cup", "portraits", `${id}.png`);
const flag = (id) => asset("public", "match-runtime-min", "data", "teams", id, "flag.png");
const stadium = asset("public", "match-runtime-min", "data", "stadiums", "international", "stadium.jpg");
const pitchFrozen = asset("public", "animal-cup", "ui", "gen", "_pitch-frozen.jpg");
const ball = asset("public", "match-runtime-min", "data", "balls", "classic_1", "texture.png");
const pattern = asset("public", "match-runtime-min", "images", "interface", "pattern.png");
const generated = (...parts) => asset("wechat-minigame-cocos-production", "assets", "resources", "animal_football", "web_runtime", "generated", ...parts);

function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function optionalDataUri(file, fallback = "") {
  return fs.existsSync(file) ? dataUri(file) : fallback;
}

const imgs = {
  pattern: dataUri(pattern),
  stadium: dataUri(stadium),
  pitch: dataUri(pitchFrozen),
  ball: dataUri(ball),
  ballRender: optionalDataUri(generated("ball_classic.png"), dataUri(ball)),
  playerArgentinaBack: optionalDataUri(generated("player_argentina_back_idle_0.png")),
  playerArgentinaFront: optionalDataUri(generated("player_argentina_front_idle_0.png")),
  playerArgentinaRun: optionalDataUri(generated("player_argentina_front_run_2.png")),
  playerPortugalBack: optionalDataUri(generated("player_portugal_back_idle_0.png")),
  playerPortugalFront: optionalDataUri(generated("player_portugal_front_idle_0.png")),
  playerPortugalRun: optionalDataUri(generated("player_portugal_front_run_2.png")),
  playerZebra: optionalDataUri(generated("player_zebra_front.png")),
  argentina: dataUri(portrait("argentina")),
  portugal: dataUri(portrait("portugal")),
  england: dataUri(portrait("england")),
  brazil: dataUri(portrait("brazil")),
  france: dataUri(portrait("france")),
  germany: dataUri(portrait("germany")),
  spain: dataUri(portrait("spain")),
  usa: dataUri(portrait("usa")),
  fArgentina: dataUri(flag("argentina")),
  fPortugal: dataUri(flag("portugal")),
  fEngland: dataUri(flag("england")),
  fBrazil: dataUri(flag("brazil")),
};

const teams = [
  ["argentina", "阿根廷", "美洲狮", imgs.argentina, "#69b7d8"],
  ["portugal", "葡萄牙", "伊比利亚狼", imgs.portugal, "#b84c3e"],
  ["england", "英格兰", "雄狮", imgs.england, "#c94839"],
  ["brazil", "巴西", "美洲豹", imgs.brazil, "#4f9f47"],
  ["france", "法国", "高卢雄鸡", imgs.france, "#4e78b7"],
  ["germany", "德国", "黑鹰", imgs.germany, "#5e5530"],
  ["spain", "西班牙", "公牛", imgs.spain, "#c66f3c"],
  ["usa", "美国", "白头鹰", imgs.usa, "#66789b"],
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[c]));
}

function chrome() {
  return `
    <g>
      <rect x="0" y="0" width="${W}" height="54" fill="#f7f7f5"/>
      <text x="52" y="35" font-size="24" font-weight="800" fill="#202124">${gameName}</text>
      <text x="194" y="35" font-size="17" fill="#606368">微信小游戏</text>
      <g transform="translate(1132 12)">
        <rect width="112" height="32" rx="16" fill="#111b14" opacity=".82"/>
        <circle cx="28" cy="16" r="4.8" fill="#fff"/>
        <circle cx="48" cy="16" r="4.8" fill="#fff"/>
        <circle cx="68" cy="16" r="4.8" fill="#fff"/>
        <line x1="82" y1="7" x2="82" y2="25" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
        <circle cx="98" cy="16" r="9" fill="none" stroke="#fff" stroke-width="4"/>
      </g>
    </g>`;
}

function titleBar(subtitle = "") {
  return `
    <g>
      <rect x="34" y="76" width="66" height="66" rx="18" fill="#fff7df" opacity=".94"/>
      <rect x="34" y="76" width="66" height="66" rx="18" fill="none" stroke="#315222" stroke-opacity=".32" stroke-width="3"/>
      <image href="${imgs.argentina}" x="40" y="82" width="54" height="54"/>
      <text x="114" y="111" font-size="38" font-weight="900" fill="#fff7df" stroke="#243713" stroke-width="6" paint-order="stroke">${gameName}</text>
      <text x="116" y="141" font-size="20" font-weight="800" fill="#ecf5da" stroke="#21401a" stroke-opacity=".45" stroke-width="3" paint-order="stroke">${esc(subtitle)}</text>
    </g>`;
}

function stadiumNamePatch() {
  return `
    <g transform="translate(560 58)">
      <rect width="160" height="43" rx="8" fill="#6c5a2e" opacity=".94"/>
      <rect x="4" y="4" width="152" height="35" rx="6" fill="#315222" opacity=".54"/>
      <text x="80" y="29" text-anchor="middle" font-size="24" font-weight="900" fill="#f7e9a8" stroke="#2c2410" stroke-opacity=".45" stroke-width="2" paint-order="stroke">${gameName}</text>
    </g>`;
}

function baseGrass() {
  return `
    <rect x="0" y="54" width="${W}" height="${H - 54}" fill="#5d9038"/>
    <image href="${imgs.pattern}" x="0" y="54" width="${W}" height="${H - 54}" opacity=".28" preserveAspectRatio="none"/>
    <g opacity=".18">
      ${Array.from({ length: 14 }, (_, i) => `<rect x="${i * 102}" y="54" width="55" height="${H - 54}" fill="${i % 2 ? "#2f7b38" : "#fff7d8"}"/>`).join("")}
    </g>`;
}

function fieldLines() {
  return `
    <rect x="82" y="102" width="1116" height="548" rx="20" fill="rgba(83,145,66,.54)" stroke="#fff" stroke-opacity=".65" stroke-width="5"/>
    <line x1="640" y1="102" x2="640" y2="650" stroke="#fff" stroke-opacity=".6" stroke-width="4"/>
    <circle cx="640" cy="376" r="98" fill="none" stroke="#fff" stroke-opacity=".58" stroke-width="5"/>
    <rect x="82" y="246" width="150" height="260" fill="none" stroke="#fff" stroke-opacity=".58" stroke-width="5"/>
    <rect x="1048" y="246" width="150" height="260" fill="none" stroke="#fff" stroke-opacity=".58" stroke-width="5"/>
  `;
}

function teamCard(team, x, y, selected = false) {
  const [, name, animal, img, color] = team;
  return `
    <g transform="translate(${x} ${y})">
      <rect width="132" height="142" rx="20" fill="${selected ? "#eef8e9" : "#fffef8"}" stroke="${selected ? color : "#ded8ca"}" stroke-width="${selected ? 5 : 2}"/>
      <image href="${img}" x="36" y="16" width="60" height="60"/>
      <text x="66" y="99" text-anchor="middle" font-size="21" font-weight="900" fill="#315222">${esc(name)}</text>
      <text x="66" y="124" text-anchor="middle" font-size="15" font-weight="800" fill="#566949">${esc(animal)}</text>
      ${selected ? `<circle cx="112" cy="22" r="14" fill="#5d9038"/><text x="112" y="28" text-anchor="middle" font-size="18" font-weight="900" fill="#fff">✓</text>` : ""}
    </g>`;
}

function playerSprite(teamId, facing, pose) {
  const map = {
    argentina: {
      front: pose === "run" ? imgs.playerArgentinaRun : imgs.playerArgentinaFront,
      back: imgs.playerArgentinaBack,
    },
    portugal: {
      front: pose === "run" ? imgs.playerPortugalRun : imgs.playerPortugalFront,
      back: imgs.playerPortugalBack,
    },
    zebra: {
      front: imgs.playerZebra,
      back: imgs.playerZebra,
    },
  };
  return map[teamId]?.[facing] || map[teamId]?.front || "";
}

function player(team, x, y, n, selected = false, facing = "front", pose = "idle") {
  const [id, , , img, color] = team;
  const sprite = playerSprite(id, facing, pose);
  if (sprite) {
    return `
      <g transform="translate(${x} ${y})">
        ${selected ? `<ellipse cx="0" cy="48" rx="42" ry="13" fill="none" stroke="#fff" stroke-width="5"/>` : ""}
        <ellipse cx="0" cy="54" rx="34" ry="10" fill="#162b16" opacity=".28"/>
        <image href="${sprite}" x="-48" y="-76" width="96" height="112" preserveAspectRatio="xMidYMid meet"/>
        <g transform="translate(19 -5)">
          <rect x="-16" y="-16" width="32" height="28" rx="7" fill="${color}" fill-opacity=".95" stroke="#fff" stroke-width="2"/>
          <text x="0" y="5" text-anchor="middle" font-size="17" font-weight="900" fill="#fff">${n}</text>
        </g>
      </g>`;
  }
  return `
    <g transform="translate(${x} ${y})">
      ${selected ? `<ellipse cx="0" cy="86" rx="38" ry="14" fill="none" stroke="#fff" stroke-width="5"/>` : ""}
      <ellipse cx="0" cy="91" rx="31" ry="9" fill="#1a2b16" opacity=".24"/>
      <path d="M-28 18 C-50 34 -50 55 -32 58" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>
      <path d="M28 18 C50 34 50 55 32 58" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>
      <rect x="-22" y="8" width="44" height="52" rx="11" fill="${color}" stroke="#fff" stroke-width="3"/>
      <text x="0" y="41" text-anchor="middle" font-size="19" font-weight="900" fill="#fff">${n}</text>
      <rect x="-24" y="56" width="48" height="20" rx="7" fill="#f6f3e5" stroke="#26401c" stroke-opacity=".25" stroke-width="2"/>
      <path d="M-14 74 L-20 92" stroke="#f6d7a6" stroke-width="8" stroke-linecap="round"/>
      <path d="M14 74 L20 92" stroke="#f6d7a6" stroke-width="8" stroke-linecap="round"/>
      <path d="M-28 95 C-18 88 -8 90 -4 96" fill="#263347"/>
      <path d="M8 96 C14 90 25 90 32 96" fill="#263347"/>
      <image href="${img}" x="-33" y="-46" width="66" height="66"/>
    </g>`;
}

function controls() {
  return `
    <g opacity=".72">
      <circle cx="160" cy="560" r="78" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-opacity=".45" stroke-width="5"/>
      <circle cx="160" cy="560" r="36" fill="#fff" fill-opacity=".38"/>
      <circle cx="1028" cy="552" r="48" fill="#4f8a2f" fill-opacity=".38" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
      <text x="1028" y="564" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">传</text>
      <circle cx="1116" cy="488" r="48" fill="#c98a3b" fill-opacity=".38" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
      <text x="1116" y="500" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">射</text>
      <circle cx="1128" cy="604" r="48" fill="#5d9038" fill-opacity=".38" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
      <text x="1128" y="616" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">冲</text>
      <circle cx="944" cy="620" r="45" fill="#f2b705" fill-opacity=".38" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
      <text x="944" y="633" text-anchor="middle" font-size="25" font-weight="900" fill="#3a2e0a">防</text>
    </g>`;
}

function scoreboard(min = "3'", score = "0 - 0", left = imgs.argentina, right = imgs.fPortugal) {
  return `
    <g transform="translate(330 82)">
      <rect width="620" height="86" rx="28" fill="#111b14" opacity=".76"/>
      <image href="${left}" x="38" y="22" width="56" height="36"/>
      <text x="190" y="54" text-anchor="middle" font-size="42" font-weight="900" fill="#fff">${score.split("-")[0].trim()}</text>
      <text x="310" y="54" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">-</text>
      <text x="430" y="54" text-anchor="middle" font-size="42" font-weight="900" fill="#fff">${score.split("-")[1].trim()}</text>
      <image href="${right}" x="526" y="22" width="56" height="36"/>
      <text x="310" y="78" text-anchor="middle" font-size="18" font-weight="800" fill="#dce9d3">${min} · 动物球员控球</text>
    </g>`;
}

function homeScene() {
  const cards = teams.map((t, i) => teamCard(t, 190 + (i % 4) * 150, 220 + Math.floor(i / 4) * 164, i === 0 || i === 1)).join("");
  return svg(`${baseGrass()}${chrome()}${titleBar("选择动物球队、阵型、难度和比赛时长")}
    <rect x="132" y="188" width="1016" height="420" rx="32" fill="#123126" opacity=".72"/>
    ${cards}
    <rect x="330" y="622" width="160" height="54" rx="27" fill="#f2c84b"/><text x="410" y="657" text-anchor="middle" font-size="26" font-weight="900" fill="#13243b">随机对阵</text>
    <rect x="510" y="622" width="180" height="54" rx="27" fill="#99d36d"/><text x="600" y="657" text-anchor="middle" font-size="26" font-weight="900" fill="#13243b">阵型 2-3-1</text>
    <rect x="710" y="622" width="160" height="54" rx="27" fill="#8fd2eb"/><text x="790" y="657" text-anchor="middle" font-size="26" font-weight="900" fill="#13243b">难度 普通</text>
    <rect x="890" y="622" width="150" height="54" rx="27" fill="#18bf6c"/><text x="965" y="657" text-anchor="middle" font-size="28" font-weight="900" fill="#fff">开球</text>`);
}

function formationScene() {
  return svg(`${baseGrass()}${chrome()}${titleBar("阵型设置与球队对阵")}
    <rect x="120" y="170" width="460" height="430" rx="30" fill="#fffef8" opacity=".96"/>
    <rect x="700" y="170" width="460" height="430" rx="30" fill="#fffef8" opacity=".96"/>
    ${teamCard(teams[0], 170, 210, true)}${teamCard(teams[2], 320, 210)}${teamCard(teams[4], 170, 380)}${teamCard(teams[5], 320, 380)}
    ${teamCard(teams[1], 750, 210, true)}${teamCard(teams[3], 900, 210)}${teamCard(teams[6], 750, 380)}${teamCard(teams[7], 900, 380)}
    <circle cx="640" cy="386" r="58" fill="#5d9038" stroke="#fff7e2" stroke-width="6"/><text x="640" y="402" text-anchor="middle" font-size="32" font-weight="900" fill="#fff">VS</text>
    <text x="350" y="638" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">主队：阿根廷 美洲狮</text>
    <text x="930" y="638" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">客队：葡萄牙 伊比利亚狼</text>`);
}

function matchScene(score = "0 - 0") {
  return svg(`${chrome()}<image href="${imgs.stadium}" x="0" y="54" width="${W}" height="${H - 54}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="0" y="54" width="${W}" height="${H - 54}" fill="#5d9038" opacity=".16"/>
    ${stadiumNamePatch()}
    ${scoreboard("5'", score)}
    ${player(teams[0], 450, 356, 6, true, "front", "run")}${player(teams[0], 520, 295, 2, false, "back")}${player(teams[0], 560, 430, 3, false, "front")}
    ${player(teams[1], 695, 350, 8, false, "front", "run")}${player(teams[1], 760, 290, 5, false, "back")}${player(teams[1], 815, 420, 9, false, "front")}
    <image href="${imgs.ballRender}" x="594" y="368" width="46" height="46"/>
    ${controls()}
    <text x="54" y="104" font-size="27" font-weight="900" fill="#fff" stroke="#17341a" stroke-width="4" paint-order="stroke">${gameName}</text>`);
}

function goalScene() {
  return svg(`${chrome()}<image href="${imgs.stadium}" x="0" y="54" width="${W}" height="${H - 54}" preserveAspectRatio="xMidYMid slice"/>
    ${stadiumNamePatch()}
    ${scoreboard("18'", "1 - 0")}
    ${player(teams[0], 520, 352, 10, true, "front", "run")}${player(teams[0], 440, 425, 6, false, "front")}${player(teams[1], 745, 366, 4, false, "front", "run")}
    <image href="${imgs.ballRender}" x="245" y="350" width="50" height="50"/>
    <rect x="424" y="180" width="432" height="118" rx="28" fill="#fffef8" opacity=".94"/>
    <text x="640" y="228" text-anchor="middle" font-size="36" font-weight="900" fill="#4f8a2f">进球！</text>
    <text x="640" y="268" text-anchor="middle" font-size="24" font-weight="900" fill="#315222">阿根廷 美洲狮完成射门</text>
    ${controls()}`);
}

function resultScene() {
  return svg(`${baseGrass()}${chrome()}${titleBar("比赛结束，统计比分和胜负")}
    <rect x="310" y="178" width="660" height="420" rx="36" fill="#fffef8" stroke="#e6ddc8" stroke-width="6"/>
    <text x="640" y="248" text-anchor="middle" font-size="38" font-weight="900" fill="#5d9038">比赛结束</text>
    <image href="${imgs.argentina}" x="418" y="292" width="118" height="118"/>
    <text x="565" y="374" text-anchor="middle" font-size="68" font-weight="900" fill="#315222">2</text>
    <text x="640" y="374" text-anchor="middle" font-size="42" font-weight="900" fill="#8a7a62">-</text>
    <text x="715" y="374" text-anchor="middle" font-size="68" font-weight="900" fill="#315222">1</text>
    <image href="${imgs.portugal}" x="744" y="292" width="118" height="118"/>
    <text x="640" y="462" text-anchor="middle" font-size="26" font-weight="900" fill="#4f8a2f">阿根廷 美洲狮 获胜</text>
    <rect x="490" y="510" width="130" height="48" rx="24" fill="#5d9038"/><text x="555" y="542" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">再赛一场</text>
    <rect x="660" y="510" width="130" height="48" rx="24" fill="#fff" stroke="#5d9038" stroke-width="3"/><text x="725" y="542" text-anchor="middle" font-size="22" font-weight="900" fill="#5d9038">返回首页</text>`);
}

function backgroundScene() {
  return svg(`${chrome()}<image href="${imgs.pitch}" x="0" y="54" width="${W}" height="${H - 54}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="0" y="54" width="${W}" height="${H - 54}" fill="#1e4b22" opacity=".2"/>
    ${titleBar("卡通动物组成的足球世界")}
    ${fieldLines()}
    ${player(teams[0], 455, 370, 7, false, "front")}${player(teams[1], 825, 370, 11, false, "front")}
    <image href="${imgs.ballRender}" x="615" y="362" width="50" height="50"/>
    <text x="640" y="640" text-anchor="middle" font-size="28" font-weight="900" fill="#fff" stroke="#21401a" stroke-width="5" paint-order="stroke">不同动物球队参加轻松友谊足球赛</text>`);
}

function inviteScene() {
  return svg(`${baseGrass()}${chrome()}${titleBar("分享邀请系统")}
    <rect x="360" y="166" width="560" height="446" rx="32" fill="#fffef8" stroke="#e6ddc8" stroke-width="6"/>
    <text x="640" y="224" text-anchor="middle" font-size="34" font-weight="900" fill="#315222">长按图片转发给好友或保存</text>
    <rect x="488" y="272" width="304" height="256" rx="20" fill="#f8f6e8" stroke="#d6d2bd" stroke-width="4"/>
    <g fill="#14351d">${Array.from({ length: 13 }, (_, r) => Array.from({ length: 13 }, (_, c) => ((r * 7 + c * 5 + r * c) % 3 === 0 ? `<rect x="${512 + c * 18}" y="${294 + r * 16}" width="12" height="12"/>` : "")).join("")).join("")}</g>
    <text x="640" y="570" text-anchor="middle" font-size="26" font-weight="900" fill="#4f8a2f">邀请加入比赛</text>
    <text x="640" y="604" text-anchor="middle" font-size="20" font-weight="900" fill="#fff" stroke="#21401a" stroke-width="4" paint-order="stroke">master-ai.cn/football</text>`);
}

function systemScene() {
  return svg(`${baseGrass()}${chrome()}${titleBar("队伍选择、比赛流程和操作控制")}
    <rect x="90" y="190" width="320" height="360" rx="28" fill="#fffef8" opacity=".95"/>
    <text x="250" y="238" text-anchor="middle" font-size="28" font-weight="900" fill="#315222">队伍选择系统</text>
    ${teamCard(teams[0], 126, 270, true)}${teamCard(teams[1], 276, 270)}
    <rect x="480" y="190" width="320" height="360" rx="28" fill="#fffef8" opacity=".95"/>
    <text x="640" y="238" text-anchor="middle" font-size="28" font-weight="900" fill="#315222">比赛系统</text>
    <text x="640" y="316" text-anchor="middle" font-size="60" font-weight="900" fill="#4f8a2f">2 - 1</text>
    <text x="640" y="370" text-anchor="middle" font-size="24" font-weight="900" fill="#5f704d">计时 / 比分 / 胜负</text>
    <rect x="552" y="412" width="176" height="56" rx="28" fill="#5d9038"/><text x="640" y="449" text-anchor="middle" font-size="25" font-weight="900" fill="#fff">比赛结束</text>
    <rect x="870" y="190" width="320" height="360" rx="28" fill="#fffef8" opacity=".95"/>
    <text x="1030" y="238" text-anchor="middle" font-size="28" font-weight="900" fill="#315222">操作控制系统</text>
    <circle cx="960" cy="370" r="58" fill="#5d9038" opacity=".35" stroke="#5d9038" stroke-width="4"/>
    <circle cx="1095" cy="330" r="38" fill="#c98a3b" opacity=".65"/><text x="1095" y="342" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">射</text>
    <circle cx="1095" cy="424" r="38" fill="#4f8a2f" opacity=".65"/><text x="1095" y="436" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">传</text>`);
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
    </style>
    <rect width="${W}" height="${H}" fill="#5d9038"/>
    ${body}
  </svg>`;
}

const shots = [
  ["01_场景_主界面选队.png", homeScene()],
  ["02_场景_阵型与对阵.png", formationScene()],
  ["03_场景_比赛球场.png", matchScene()],
  ["04_玩法_虚拟摇杆操作.png", matchScene("0 - 0")],
  ["05_玩法_传球射门进球.png", goalScene()],
  ["06_玩法_比赛结束结算.png", resultScene()],
  ["07_背景_动物足球世界.png", backgroundScene()],
  ["08_背景_球场与动物球队.png", matchScene("1 - 1")],
  ["09_背景_轻松友谊赛.png", formationScene()],
  ["10_系统_队伍比赛操作.png", systemScene()],
  ["11_系统_邀请海报.png", inviteScene()],
  ["12_系统_比分结算.png", resultScene()],
];

for (const [name, source] of shots) {
  const file = path.join(outDir, name);
  await sharp(Buffer.from(source)).png({ compressionLevel: 8 }).toFile(file);
}

const rows = fs.readdirSync(outDir)
  .filter((name) => name.endsWith(".png"))
  .sort()
  .map((name) => {
    const size = fs.statSync(path.join(outDir, name)).size;
    return `${name}\t${Math.round(size / 1024)}KB`;
  });
console.log(outDir);
console.log(rows.join("\n"));
