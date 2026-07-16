#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const base = (process.argv[2] || "http://127.0.0.1:13000").replace(/\/$/, "");
const artifacts = path.resolve(process.env.LAN_TEST_ARTIFACTS || "/tmp/animal-cup-lan-playtest");
const errors = [];
const contexts = [];

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: process.env.HEADLESS === "1",
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});

function observe(page, name) {
  page.on("pageerror", (error) => errors.push(`${name}: ${String(error).slice(0, 400)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|React DevTools|animal-cup\/audio\//i.test(text)) return;
    errors.push(`${name}: ${text.slice(0, 300)}`);
  });
  return page;
}

async function page(name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
  contexts.push(context);
  return observe(await context.newPage(), name);
}

async function capture(target, name) {
  const file = path.join(artifacts, `${name}.png`);
  await target.screenshot({ path: file, type: "png" });
  return file;
}

async function waitForGame(target) {
  await target.waitForFunction(
    () => !!(window.__matchGame?.pitch?.redTeam && document.querySelector("canvas")),
    undefined,
    { timeout: 70_000 },
  );
  await target.waitForFunction(() => !document.querySelector(".cloud-curtain"), undefined, { timeout: 40_000 });
}

function layout(target) {
  return target.evaluate(() => {
    const root = document.querySelector(".pad");
    const select = document.querySelector(".pad-select");
    const confirm = document.querySelector(".pad-select__confirm");
    const rect = confirm?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rootOverflowX: root ? root.scrollWidth - root.clientWidth : null,
      selectOverflowX: select ? select.scrollWidth - select.clientWidth : null,
      teamButtons: document.querySelectorAll(".pad-select__team").length,
      confirmVisible: !!rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight,
    };
  });
}

try {
  const host = await page("kiosk-host", { width: 1280, height: 720 });
  const pad1 = await page("kiosk-pad1", { width: 844, height: 390 });
  const pad2 = await page("kiosk-pad2", { width: 844, height: 390 });

  await host.goto(`${base}/lan-kiosk`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await host.waitForURL(/\/match\?/, { timeout: 30_000 });
  await waitForGame(host);
  await host.locator(".lan-qr-dock").waitFor({ state: "visible", timeout: 20_000 });
  const room = (await host.locator(".lan-qr-dock code").innerText()).trim();
  if (!/^[A-Z2-9]{4}$/.test(room)) throw new Error(`invalid kiosk room code: ${room}`);

  await Promise.all([
    pad1.goto(`${base}/pad?room=${room}`, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    pad2.goto(`${base}/pad?room=${room}`, { waitUntil: "domcontentloaded", timeout: 30_000 }),
  ]);
  await Promise.all([
    host.locator(".lan-team-select").waitFor({ state: "visible", timeout: 20_000 }),
    pad1.locator(".pad-select").waitFor({ state: "visible", timeout: 20_000 }),
    pad2.locator(".pad-select").waitFor({ state: "visible", timeout: 20_000 }),
  ]);

  const [pad1Layout, pad2Layout] = await Promise.all([layout(pad1), layout(pad2)]);
  for (const [name, result] of [["P1", pad1Layout], ["P2", pad2Layout]]) {
    if (result.teamButtons !== 8 || result.rootOverflowX > 0 || result.selectOverflowX > 0 || !result.confirmVisible) {
      throw new Error(`${name} selection layout mismatch: ${JSON.stringify(result)}`);
    }
  }

  const selectionShots = await Promise.all([
    capture(host, "kiosk-host-team-select"),
    capture(pad1, "kiosk-pad1-team-select"),
    capture(pad2, "kiosk-pad2-team-select"),
  ]);

  await pad1.locator(".pad-select__team").filter({ hasText: "ENG" }).click();
  await pad2.locator(".pad-select__team").filter({ hasText: "BRA" }).click();
  await Promise.all([
    pad1.locator(".pad-select__confirm").click(),
    pad2.locator(".pad-select__confirm").click(),
  ]);
  await pad1.locator(".pad-select__confirm--start").waitFor({ state: "visible", timeout: 10_000 });
  await pad1.locator(".pad-select__confirm--start").click();

  await host.waitForURL((url) => url.searchParams.get("play") === "1" && url.searchParams.get("kiosk") === "1", {
    timeout: 30_000,
  });
  await waitForGame(host);
  await Promise.all([
    pad1.locator(".pad-state--playing").waitFor({ state: "visible", timeout: 20_000 }),
    pad2.locator(".pad-state--playing").waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await host.locator(".online-match-badge").count()) throw new Error("LAN match rendered ONLINE badge");

  const liveShots = await Promise.all([
    capture(host, "kiosk-host-live"),
    capture(pad1, "kiosk-pad1-live"),
    capture(pad2, "kiosk-pad2-live"),
  ]);
  const canvasFile = path.join(artifacts, "kiosk-host-live.png");
  const stats = await sharp(canvasFile).stats();
  const variation = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0);
  if (variation < 8) throw new Error("kiosk canvas appears blank");
  if (errors.length) throw new Error(`browser errors: ${errors.join(" | ")}`);

  console.log(JSON.stringify({
    ok: true,
    room,
    artifacts,
    pad1Layout,
    pad2Layout,
    canvasVariation: Number(variation.toFixed(2)),
    selectionShots,
    liveShots,
  }, null, 2));
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}
