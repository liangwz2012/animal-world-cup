export interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PackageProgress {
  progress: number;
  totalBytesWritten?: number;
  totalBytesExpectedToWrite?: number;
}

export interface LoadPackageOptions {
  onProgress?: (progress: PackageProgress) => void;
}

export interface PlatformPort {
  readonly kind: 'browser' | 'wechat';
  readonly canvas: unknown;
  now(): number;
  getSafeArea(): SafeArea;
  onPause(listener: () => void): () => void;
  onResume(listener: () => void): () => void;
  loadPackage(name: string, options?: LoadPackageOptions): Promise<void>;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
}

export interface WechatSystemInfo {
  windowWidth: number;
  windowHeight: number;
  safeArea?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

export interface WechatSubpackageTask {
  onProgressUpdate?(listener: (progress: PackageProgress) => void): void;
}

export interface WechatMiniGameApi {
  createCanvas(): unknown;
  getSystemInfoSync(): WechatSystemInfo;
  getPerformance?(): { now(): number };
  onHide(listener: () => void): void;
  offHide?(listener: () => void): void;
  onShow(listener: () => void): void;
  offShow?(listener: () => void): void;
  loadSubpackage(options: {
    name: string;
    success(): void;
    fail(error: unknown): void;
  }): WechatSubpackageTask;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
}

export interface RetryOptions {
  retries: number;
  onAttemptFailure?: (error: unknown, attempt: number) => void;
}
