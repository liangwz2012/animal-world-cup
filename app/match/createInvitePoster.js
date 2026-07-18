import QRCode from "qrcode";
import { PLAYABLE_TEAMS, portraitSrc, runtimeHeadSrc } from "../data/teams";

export const PUBLIC_HOME_URL = "https://football.allrich.ai";
export const PUBLIC_HOME_LABEL = "football.allrich.ai";

function teamMeta(id) {
  return PLAYABLE_TEAMS.find((team) => team.id === id) || { id, shortName: id.toUpperCase(), palette: ["#5d9038", "#fff7e2", "#3f7fb1"] };
}

function loadImg(src, fallback) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (!fallback) return resolve(null);
      const fb = new Image();
      fb.onload = () => resolve(fb);
      fb.onerror = () => resolve(null);
      fb.src = fallback;
    };
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function coverImage(ctx, img, x, y, w, h) {
  if (!img) return;
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s;
  const ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function drawPortrait(ctx, img, x, y, size, ring) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fffef8";
  ctx.fill();
  ctx.clip();
  coverImage(ctx, img, x + size * 0.05, y + size * 0.05, size * 0.9, size * 0.9);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

function drawLogoTitle(ctx, text, x, y, font) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = `900 106px "Titan One", "ZCOOL KuaiLe", ${font}`;
  [
    [14, "#21401a"],
    [11, "#2f5220"],
    [8, "#3f6a26"],
    [5, "#4f8a2f"],
  ].forEach(([dy, color]) => {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + dy);
  });
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#3a2a15";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fff7e2";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export async function createInvitePoster({ teams, t, url }) {
  const red = teamMeta(teams.red);
  const blue = teamMeta(teams.blue);
  const [redHead, blueHead, qrImg] = await Promise.all([
    loadImg(portraitSrc(red.id), runtimeHeadSrc(red.id)),
    loadImg(portraitSrc(blue.id), runtimeHeadSrc(blue.id)),
    QRCode.toDataURL(url, {
      width: 220,
      margin: 0,
      color: { dark: "#14351d", light: "#fffef8" },
      errorCorrectionLevel: "M",
    }).then((src) => loadImg(src)),
  ]);

  const W = 1080;
  const H = 1620;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const font = getComputedStyle(document.body).fontFamily || "Arial, sans-serif";

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#77b957");
  bg.addColorStop(0.52, "#4f8a2f");
  bg.addColorStop(1, "#1f5a31");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = 0.22;
  for (let x = -120; x < W + 160; x += 150) {
    ctx.fillStyle = x / 150 % 2 ? "#fffef8" : "#2e783c";
    ctx.fillRect(x, 0, 92, H);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(255,254,248,0.45)";
  ctx.lineWidth = 8;
  roundRect(ctx, 88, 300, W - 176, 520, 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2, 300);
  ctx.lineTo(W / 2, 820);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, 560, 120, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "center";
  drawLogoTitle(ctx, t("invite.posterTitle"), W / 2, 150, font);
  ctx.font = `800 36px ${font}`;
  ctx.fillStyle = "#fff7e2";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 3;
  ctx.fillText(t("invite.posterSubtitle"), W / 2, 214);
  ctx.shadowOffsetY = 0;

  const cardY = 355;
  const drawTeam = (team, img, x, color) => {
    ctx.fillStyle = "rgba(255,254,248,0.94)";
    roundRect(ctx, x, cardY, 330, 390, 34);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.stroke();
    drawPortrait(ctx, img, x + 75, cardY + 40, 180, color);
    ctx.fillStyle = "#315222";
    ctx.font = `900 46px ${font}`;
    ctx.fillText(t(`team.${team.id}.name`), x + 165, cardY + 272);
    ctx.fillStyle = "#5f704d";
    ctx.font = `800 30px ${font}`;
    ctx.fillText(t(`team.${team.id}.animal`), x + 165, cardY + 318);
    ctx.fillStyle = color;
    ctx.font = `900 28px ${font}`;
    ctx.fillText(team.shortName, x + 165, cardY + 360);
  };

  drawTeam(red, redHead, 94, red.palette[1] || "#c54539");
  drawTeam(blue, blueHead, W - 424, blue.palette[0] || "#3f7fb1");

  ctx.fillStyle = "#fff7e2";
  ctx.beginPath();
  ctx.arc(W / 2, cardY + 190, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4f8a2f";
  ctx.font = `900 48px ${font}`;
  ctx.fillText("VS", W / 2, cardY + 207);

  const qrSize = 220;
  const qrPad = 12;
  const qrCard = qrSize + qrPad * 2;
  const qrX = (W - qrCard) / 2;
  const qrY = 950;

  ctx.fillStyle = "rgba(255,254,248,0.95)";
  roundRect(ctx, qrX, qrY, qrCard, qrCard, 28);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(20, 53, 29, 0.18)";
  ctx.stroke();
  if (qrImg) ctx.drawImage(qrImg, qrX + qrPad, qrY + qrPad, qrSize, qrSize);

  ctx.fillStyle = "#315222";
  ctx.font = `900 38px ${font}`;
  ctx.fillText(t("invite.scanToJoin"), W / 2, 1320);
  ctx.fillStyle = "rgba(255,247,226,0.9)";
  ctx.font = `800 30px ${font}`;
  ctx.fillText(PUBLIC_HOME_LABEL, W / 2, 1378);

  return { dataUrl: cv.toDataURL("image/png"), url, displayUrl: PUBLIC_HOME_URL };
}
