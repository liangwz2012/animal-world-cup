import type {
  LoadPackageOptions,
  PlatformPort,
  SafeArea,
  WechatMiniGameApi
} from './types.ts';

export function createWechatPlatform(api: WechatMiniGameApi): PlatformPort {
  const canvas = api.createCanvas();
  const systemInfo = api.getSystemInfoSync();

  return {
    kind: 'wechat',
    canvas,
    now: () => api.getPerformance?.().now() ?? Date.now(),
    getSafeArea: () => normalizeSafeArea(systemInfo),
    onPause(listener) {
      api.onHide(listener);
      return () => api.offHide?.(listener);
    },
    onResume(listener) {
      api.onShow(listener);
      return () => api.offShow?.(listener);
    },
    loadPackage(name: string, options: LoadPackageOptions = {}) {
      return new Promise<void>((resolve, reject) => {
        const task = api.loadSubpackage({
          name,
          success: resolve,
          fail: reject
        });
        if (options.onProgress && task.onProgressUpdate) {
          task.onProgressUpdate(options.onProgress);
        }
      });
    },
    getStorage(key) {
      const value = api.getStorageSync(key);
      return typeof value === 'string' ? value : null;
    },
    setStorage(key, value) {
      api.setStorageSync(key, value);
    }
  };
}

function normalizeSafeArea(systemInfo: ReturnType<WechatMiniGameApi['getSystemInfoSync']>): SafeArea {
  return systemInfo.safeArea ?? {
    left: 0,
    top: 0,
    right: systemInfo.windowWidth,
    bottom: systemInfo.windowHeight,
    width: systemInfo.windowWidth,
    height: systemInfo.windowHeight
  };
}
