// 战报分享卡：把裸截图升级为带品牌框/比分大字/队名的卡片，提升转发点击率(K因子)。
// matchShareTitle 为纯函数(可测)；generateMatchShareCard 用离屏 canvas 绘制，
// 全程 try/catch 且任何失败都 resolve("")，调用方回落到截图，绝不因分享卡失败而报错。

// 情绪化 + 悬念化的分享标题，比干巴巴的"动物足球赛 3:2"更能勾人来接招。
function matchShareTitle(opts) {
  const o = opts || {};
  const myScore = Number(o.myScore) || 0;
  const foeScore = Number(o.foeScore) || 0;
  const myName = o.myName || "我的球队";
  const foeName = o.foeName || "对手";
  if (myScore === foeScore) return `${myScore}:${foeScore} 平局！就差一点，来跟我踢一场？`;
  if (myScore > foeScore) return `我用${myName} ${myScore}:${foeScore} 赢了${foeName}，你敢来接招吗？`;
  return `惜败 ${myScore}:${foeScore}…谁来帮我赢回这一局？`;
}

function matchShareCaption(myScore, foeScore) {
  if (myScore === foeScore) return "势均力敌 · 握手言和";
  return myScore > foeScore ? "漂亮！拿下这一城" : "惜败一球 · 不服再战";
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 返回 Promise<tempFilePath|"">；失败一律 "".
function generateMatchShareCard(wxApi, opts) {
  return new Promise((resolve) => {
    try {
      if (!wxApi || typeof wxApi.createCanvas !== "function") { resolve(""); return; }
      const o = opts || {};
      const score = o.score || [0, 0];
      const W = 500;
      const H = 400;
      const canvas = wxApi.createCanvas();
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext && canvas.getContext("2d");
      if (!ctx) { resolve(""); return; }

      // 底 + 奶白卡片
      ctx.fillStyle = "#12351f";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff8dc";
      roundRectPath(ctx, 16, 16, W - 32, H - 32, 26);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#f1b82d";
      roundRectPath(ctx, 16, 16, W - 32, H - 32, 26);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      // 标题
      ctx.fillStyle = "#2b6b3f";
      ctx.font = "900 30px sans-serif";
      ctx.fillText("动物足球赛", W / 2, 66);

      // 队名（用与游戏一致的红/蓝可读色）
      ctx.font = "900 30px sans-serif";
      ctx.fillStyle = "#a44734";
      ctx.fillText(String(o.redName || "红队"), W * 0.25, 150);
      ctx.fillStyle = "#315a9b";
      ctx.fillText(String(o.blueName || "蓝队"), W * 0.75, 150);
      // 国名副标题
      ctx.font = "700 15px sans-serif";
      ctx.fillStyle = "#8a9377";
      if (o.redCountry) ctx.fillText(String(o.redCountry), W * 0.25, 174);
      if (o.blueCountry) ctx.fillText(String(o.blueCountry), W * 0.75, 174);

      // 比分大字
      ctx.fillStyle = "#31481f";
      ctx.font = "900 72px sans-serif";
      ctx.fillText(`${score[0]} : ${score[1]}`, W / 2, 250);

      // 战况一句话
      ctx.fillStyle = "#a44734";
      ctx.font = "800 22px sans-serif";
      ctx.fillText(String(o.caption || matchShareCaption(score[0], score[1])), W / 2, 305);

      // 引导
      ctx.fillStyle = "#5d9038";
      ctx.font = "800 18px sans-serif";
      ctx.fillText("点击加入 · 来踢一场 →", W / 2, 352);

      const done = (res) => resolve((res && (res.tempFilePath || res.filePath)) || "");
      const fail = () => resolve("");
      if (typeof canvas.toTempFilePath === "function") canvas.toTempFilePath({ success: done, fail });
      else if (typeof wxApi.canvasToTempFilePath === "function") wxApi.canvasToTempFilePath({ canvas, success: done, fail });
      else resolve("");
    } catch (error) {
      resolve("");
    }
  });
}

module.exports = {
  matchShareTitle,
  matchShareCaption,
  generateMatchShareCard,
};
