"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export const FAKE_LANDSCAPE_KEY = "animalCupFakeLandscape:v2";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function fullscreenActive() {
  if (typeof document === "undefined") return false;
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setFakeLandscapeClass(active) {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("ac-fake-landscape", active);
  document.documentElement.classList.toggle("ac-fake-landscape-root", active);
}

export function forceViewportRefresh(onResize, fakeLandscape = false) {
  if (typeof window === "undefined") return;
  if (onResize) onResize(fakeLandscape);
  try {
    window.dispatchEvent(new CustomEvent("ac-force-layout-refresh", {
      detail: { fakeLandscape },
    }));
  } catch {}
}

export function scheduleViewportRefresh(onResize, fakeLandscape = false) {
  if (typeof window === "undefined") return;
  const run = () => forceViewportRefresh(onResize, fakeLandscape);
  requestAnimationFrame(run);
  [0, 60, 140, 280, 520, 900, 1300].forEach((delay) => {
    setTimeout(run, delay);
  });
}

async function waitForLandscapeViewport(timeout = 650) {
  if (typeof window === "undefined" || !isPortraitViewport()) return true;
  const started = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let raf = 0;
    const finish = (ok) => {
      if (done) return;
      done = true;
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
      if (raf) cancelAnimationFrame(raf);
      resolve(ok);
    };
    const check = () => {
      if (!isPortraitViewport()) {
        finish(true);
        return;
      }
      if (performance.now() - started >= timeout) {
        finish(false);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    check();
  });
}

export async function requestLandscapeMode() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement;
  try {
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fs && !fullscreenActive()) {
      await Promise.resolve(fs.call(el));
    }
  } catch {}

  let locked = false;
  try {
    if (typeof screen !== "undefined" && screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
      locked = true;
    }
  } catch {}
  if (!isPortraitViewport()) return true;
  if (locked || fullscreenActive()) return await waitForLandscapeViewport();
  await wait(40);
  return !isPortraitViewport();
}

export async function requestFullscreenOnly() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement;
  try {
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fs && !fullscreenActive()) {
      await Promise.resolve(fs.call(el));
    }
  } catch {}
  return fullscreenActive();
}

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
}

export function isPortraitViewport() {
  if (typeof window === "undefined") return false;
  return window.innerHeight > window.innerWidth;
}

export function getViewportSize(fakeLandscape = false) {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  if (!fakeLandscape) return { width: window.innerWidth, height: window.innerHeight };
  return {
    width: Math.max(window.innerWidth, window.innerHeight),
    height: Math.min(window.innerWidth, window.innerHeight),
  };
}

export function usePageLandscapeMode({ enabled = true, auto = false, nativeOnGesture = true, onResize } = {}) {
  const [touch, setTouch] = useState(false);
  const [fakeLandscape, setFakeLandscape] = useState(false);

  useIsoLayoutEffect(() => {
    if (!enabled) return undefined;
    const nextTouch = isTouchDevice();
    setTouch(nextTouch);
    const carriedFakeLandscape = document.body.classList.contains("ac-fake-landscape");
    const shouldFake = nextTouch && isPortraitViewport() && (carriedFakeLandscape || auto);
    if (shouldFake) {
      try { sessionStorage.setItem(FAKE_LANDSCAPE_KEY, "1"); } catch {}
      setFakeLandscapeClass(true);
      setFakeLandscape(true);
      scheduleViewportRefresh(onResize, true);
    }
    return undefined;
  }, [enabled, auto, onResize]);

  useEffect(() => {
    if (!enabled || !touch || !nativeOnGesture) return undefined;
    const tryNativeLock = async () => {
      if (touch && isPortraitViewport()) return;
      const locked = await requestLandscapeMode();
      if (locked) {
        try { sessionStorage.removeItem(FAKE_LANDSCAPE_KEY); } catch {}
        setFakeLandscape(false);
        setFakeLandscapeClass(false);
        scheduleViewportRefresh(onResize, false);
      }
    };
    window.addEventListener("pointerdown", tryNativeLock, { once: true, capture: true });
    window.addEventListener("touchstart", tryNativeLock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", tryNativeLock, true);
      window.removeEventListener("touchstart", tryNativeLock, true);
    };
  }, [enabled, touch, nativeOnGesture, onResize]);

  useEffect(() => {
    const active = enabled && touch && fakeLandscape && isPortraitViewport();
    setFakeLandscapeClass(active);
    if (active) {
      scheduleViewportRefresh(onResize, true);
      const onWindowResize = () => {
        if (!isPortraitViewport()) {
          try { sessionStorage.removeItem(FAKE_LANDSCAPE_KEY); } catch {}
          setFakeLandscape(false);
          setFakeLandscapeClass(false);
          scheduleViewportRefresh(onResize, false);
          return;
        }
        scheduleViewportRefresh(onResize, true);
      };
      window.addEventListener("resize", onWindowResize);
      window.addEventListener("orientationchange", onWindowResize);
      return () => {
        setFakeLandscapeClass(false);
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("orientationchange", onWindowResize);
        scheduleViewportRefresh(onResize, false);
      };
    }
    scheduleViewportRefresh(onResize, false);
    return () => setFakeLandscapeClass(false);
  }, [enabled, touch, fakeLandscape, onResize]);

  async function enterLandscapeMode() {
    if (touch && isPortraitViewport()) {
      try { sessionStorage.setItem(FAKE_LANDSCAPE_KEY, "1"); } catch {}
      setFakeLandscapeClass(true);
      setFakeLandscape(true);
      scheduleViewportRefresh(onResize, true);
      return "fake";
    }
    const locked = await requestLandscapeMode();
    if (!locked && touch && isPortraitViewport()) {
      try { sessionStorage.setItem(FAKE_LANDSCAPE_KEY, "1"); } catch {}
      setFakeLandscapeClass(true);
      setFakeLandscape(true);
      scheduleViewportRefresh(onResize, true);
      return "fake";
    }
    if (locked) {
      try { sessionStorage.removeItem(FAKE_LANDSCAPE_KEY); } catch {}
      setFakeLandscape(false);
      setFakeLandscapeClass(false);
      scheduleViewportRefresh(onResize, false);
      return "locked";
    }
    return false;
  }

  function enterFakeLandscapeMode() {
    if (!touch || !isPortraitViewport()) {
      if (onResize) onResize(false);
      return false;
    }
    try { sessionStorage.setItem(FAKE_LANDSCAPE_KEY, "1"); } catch {}
    setFakeLandscapeClass(true);
    setFakeLandscape(true);
    scheduleViewportRefresh(onResize, true);
    return "fake";
  }

  return { touch, fakeLandscape, setFakeLandscape, enterLandscapeMode, enterFakeLandscapeMode };
}
