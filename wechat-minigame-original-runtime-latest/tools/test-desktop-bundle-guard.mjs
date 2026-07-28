import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const shim = fs.readFileSync(new URL("../generated/shim.static.js", import.meta.url), "utf8");

class FakeEventTarget {
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

class FakeElement extends FakeEventTarget {
  setAttribute(name, value) { this[name] = value; }
}

class NullBundleXHR extends FakeEventTarget {
  open() {}
  send() {
    this.status = 200;
    this.responseText = "null";
  }
}

const window = new FakeEventTarget();
Object.assign(window, {
  window,
  document: {
    readyState: "complete",
    getElementById() { return null; },
  },
  XMLHttpRequest: NullBundleXHR,
  Element: FakeElement,
  HTMLImageElement: FakeElement,
  HTMLScriptElement: FakeElement,
  HTMLLinkElement: FakeElement,
  HTMLAudioElement: FakeElement,
  HTMLSourceElement: FakeElement,
  URL: { createObjectURL() { return "blob:desktop-test"; } },
  Blob: class Blob {},
  atob() { return ""; },
  Uint8Array,
  TextDecoder,
  EventTarget: FakeEventTarget,
  setTimeout() { return 0; },
  setInterval() { return 0; },
  requestAnimationFrame() { return 0; },
  console: { info() {}, warn() {}, error() {} },
});

vm.runInNewContext(shim, window, { filename: "shim.static.js" });
assert.equal(
  window.__bundleReadText("/match-runtime-min/data/teams/england/team.json"),
  null,
  "电脑端把资源索引响应解析为 null 时，必须回退为空索引而不是 Object.keys(null) 崩溃",
);

console.info("[test-desktop-bundle-guard] PASS：电脑端 JSON null 资源索引安全降级");
