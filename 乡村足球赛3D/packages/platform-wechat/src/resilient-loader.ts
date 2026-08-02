import type { LoadPackageOptions, PlatformPort, RetryOptions } from './types.ts';

export async function loadPackageWithRetry(
  platform: PlatformPort,
  name: string,
  options: LoadPackageOptions,
  retry: RetryOptions
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retry.retries + 1; attempt += 1) {
    try {
      await platform.loadPackage(name, options);
      return;
    } catch (error) {
      lastError = error;
      retry.onAttemptFailure?.(error, attempt);
    }
  }
  throw lastError;
}
