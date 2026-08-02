import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWechatPlatform,
  loadPackageWithRetry
} from '@rural-football/platform-wechat';
import type {
  PackageProgress,
  WechatMiniGameApi
} from '@rural-football/platform-wechat';

function createFakeWechatApi(failuresBeforeSuccess = 0) {
  const hideListeners = new Set<() => void>();
  const showListeners = new Set<() => void>();
  const storage = new Map<string, string>();
  let attempts = 0;

  const api: WechatMiniGameApi = {
    createCanvas: () => ({ id: 'fake-wechat-canvas' }),
    getSystemInfoSync: () => ({
      windowWidth: 1280,
      windowHeight: 720,
      safeArea: {
        left: 20,
        top: 0,
        right: 1260,
        bottom: 700,
        width: 1240,
        height: 700
      }
    }),
    getPerformance: () => ({ now: () => 123.5 }),
    onHide: (listener) => hideListeners.add(listener),
    offHide: (listener) => hideListeners.delete(listener),
    onShow: (listener) => showListeners.add(listener),
    offShow: (listener) => showListeners.delete(listener),
    loadSubpackage: ({ success, fail }) => {
      attempts += 1;
      queueMicrotask(() => {
        if (attempts <= failuresBeforeSuccess) fail(new Error('injected failure'));
        else success();
      });
      return {
        onProgressUpdate(listener: (progress: PackageProgress) => void) {
          listener({ progress: 50, totalBytesWritten: 50, totalBytesExpectedToWrite: 100 });
        }
      };
    },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value)
  };

  return {
    api,
    get attempts() {
      return attempts;
    },
    hide: () => hideListeners.forEach((listener) => listener()),
    show: () => showListeners.forEach((listener) => listener())
  };
}

test('微信端口统一生命周期、安全区、存储和时间来源', () => {
  const fake = createFakeWechatApi();
  const platform = createWechatPlatform(fake.api);
  let pauses = 0;
  let resumes = 0;
  const removePause = platform.onPause(() => pauses += 1);
  const removeResume = platform.onResume(() => resumes += 1);

  fake.hide();
  fake.show();
  platform.setStorage('season', 'm0');

  assert.equal(platform.kind, 'wechat');
  assert.equal(platform.now(), 123.5);
  assert.equal(platform.getSafeArea().width, 1240);
  assert.equal(platform.getStorage('season'), 'm0');
  assert.equal(pauses, 1);
  assert.equal(resumes, 1);

  removePause();
  removeResume();
  fake.hide();
  fake.show();
  assert.equal(pauses, 1);
  assert.equal(resumes, 1);
});

test('分包失败可按上限重试并保留进度合同', async () => {
  const fake = createFakeWechatApi(2);
  const platform = createWechatPlatform(fake.api);
  const failedAttempts: number[] = [];
  const progress: number[] = [];

  await loadPackageWithRetry(
    platform,
    'm0-gold',
    { onProgress: (event) => progress.push(event.progress) },
    {
      retries: 2,
      onAttemptFailure: (_error, attempt) => failedAttempts.push(attempt)
    }
  );

  assert.equal(fake.attempts, 3);
  assert.deepEqual(failedAttempts, [1, 2]);
  assert.deepEqual(progress, [50, 50, 50]);
});
