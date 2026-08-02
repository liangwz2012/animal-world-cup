import type { PlatformPort } from './types.ts';

export function createBrowserPlatform(canvas: HTMLCanvasElement): PlatformPort {
  return {
    kind: 'browser',
    canvas,
    now: () => performance.now(),
    getSafeArea: () => ({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight
    }),
    onPause(listener) {
      const handler = () => {
        if (document.visibilityState === 'hidden') listener();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    onResume(listener) {
      const handler = () => {
        if (document.visibilityState === 'visible') listener();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    async loadPackage() {
      return Promise.resolve();
    },
    getStorage(key) {
      return localStorage.getItem(key);
    },
    setStorage(key, value) {
      localStorage.setItem(key, value);
    }
  };
}
