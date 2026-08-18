import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const RURAL_ASSET_SPECS = Object.freeze({
  "portrait.png": Object.freeze([192, 192]),
  "head.png": Object.freeze([81, 77]),
  "head_back.png": Object.freeze([81, 77]),
  "neck.png": Object.freeze([20, 18]),
  "arm_left.png": Object.freeze([14, 11]),
  "arm_right.png": Object.freeze([15, 17]),
  "hand_left.png": Object.freeze([25, 28]),
  "hand_right.png": Object.freeze([23, 38]),
  "knee.png": Object.freeze([8, 9]),
});

export const RUNTIME_BODY_FILES = Object.freeze(
  Object.keys(RURAL_ASSET_SPECS).filter((name) => name !== "portrait.png"),
);

export async function readRuralManifest(projectDir, manifestPath) {
  const target = manifestPath
    ? path.resolve(projectDir, manifestPath)
    : path.join(projectDir, "美术整体替换包", "乡村队12人", "manifest.json");
  return JSON.parse(await fs.readFile(target, "utf8"));
}

export async function validateRgbaPng(target, expectedSize, options = {}) {
  const [expectedWidth, expectedHeight] = expectedSize;
  const image = sharp(target, { failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png") throw new Error(`${target} 不是 PNG`);
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new Error(`${target} 尺寸为 ${metadata.width}×${metadata.height}，必须是 ${expectedWidth}×${expectedHeight}`);
  }
  if (!metadata.hasAlpha) throw new Error(`${target} 必须包含透明通道`);

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 4) throw new Error(`${target} 必须是 RGBA PNG`);

  let visiblePixels = 0;
  let transparentPixels = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels + info.channels - 1;
      const alpha = data[offset];
      if (alpha > 16) {
        visiblePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < 16) transparentPixels += 1;
    }
  }
  const pixelCount = info.width * info.height;
  if (visiblePixels < Math.max(4, Math.round(pixelCount * 0.003))) {
    throw new Error(`${target} 几乎没有可见人物像素`);
  }
  if (options.requireTransparentPadding !== false && transparentPixels < 4) {
    throw new Error(`${target} 没有足够透明留边`);
  }

  if (options.transparentCorners !== false) {
    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + info.channels - 1];
    const corners = [
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1),
    ];
    if (corners.some((alpha) => alpha > 16)) {
      throw new Error(`${target} 四角必须透明，避免跑动时出现方形底色`);
    }
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX >= minX ? maxX - minX + 1 : 0,
    height: maxY >= minY ? maxY - minY + 1 : 0,
  };
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const componentSizes = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    if (data[start * info.channels + info.channels - 1] <= 16) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let size = 0;
    while (head < tail) {
      const index = queue[head++];
      size += 1;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < info.width ? index + 1 : -1,
        y > 0 ? index - info.width : -1,
        y + 1 < info.height ? index + info.width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || visited[next]) continue;
        visited[next] = 1;
        if (data[next * info.channels + info.channels - 1] > 16) queue[tail++] = next;
      }
    }
    componentSizes.push(size);
  }
  componentSizes.sort((left, right) => right - left);
  return {
    width: info.width,
    height: info.height,
    visibleRatio: visiblePixels / pixelCount,
    bounds,
    componentSizes,
  };
}

export async function validateNoMagentaResidue(target, options = {}) {
  const image = sharp(target, { failOn: "error" });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaFloor = options.alphaFloor ?? 12;
  const allowedRatio = options.allowedRatio ?? 0.0008;
  let visiblePixels = 0;
  let suspiciousPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha <= alphaFloor) continue;
    visiblePixels += 1;
    const magentaDominance = Math.min(red, blue) - green;
    if (red >= 150 && blue >= 150 && magentaDominance >= 65) suspiciousPixels += 1;
  }
  const ratio = suspiciousPixels / Math.max(1, visiblePixels);
  if (ratio > allowedRatio) {
    throw new Error(
      `${target} 存在洋红残边：${suspiciousPixels}/${visiblePixels} (${(ratio * 100).toFixed(3)}%)，不得进入运行素材`,
    );
  }
  return { visiblePixels, suspiciousPixels, ratio };
}

export async function validatePlayerAssetDirectory(playerDir, options = {}) {
  const results = {};
  for (const [file, size] of Object.entries(RURAL_ASSET_SPECS)) {
    const target = path.join(playerDir, file);
    results[file] = await validateRgbaPng(target, size);
    if (options.rejectMagentaResidue) await validateNoMagentaResidue(target, options.magenta);
  }
  for (const file of ["head.png", "head_back.png"]) {
    const { bounds } = results[file];
    if (bounds.width < 65 || bounds.height < 71) {
      throw new Error(`${path.join(playerDir, file)} 头部占框过小：${bounds.width}×${bounds.height}，至少应为 65×71`);
    }
    const centerX = bounds.x + (bounds.width - 1) / 2;
    if (Math.abs(centerX - 40) > 2) {
      throw new Error(`${path.join(playerDir, file)} 水平中心偏移：${centerX.toFixed(1)}，必须稳定在画布中心 40±2px`);
    }
    if (bounds.y > 4 || bounds.y + bounds.height < 74) {
      throw new Error(`${path.join(playerDir, file)} 顶/底基线不统一：y=${bounds.y}, h=${bounds.height}`);
    }
    if ((results[file].componentSizes[1] || 0) > 8) {
      throw new Error(`${path.join(playerDir, file)} 存在游离碎片：第二连通块 ${results[file].componentSizes[1]}px`);
    }
  }
  return results;
}
