import { MatchCore } from './match-core.ts';
import type { MatchSnapshot, Replay, ReplayResult } from './types.ts';

export function runReplay(replay: Replay): ReplayResult {
  if (replay.version !== 1) throw new Error('不支持的回放版本：' + replay.version);
  const core = new MatchCore({ seed: replay.seed });
  const events = [];

  for (const frame of replay.frames) {
    const result = core.step(frame);
    events.push(...result.events);
  }

  const snapshot = core.snapshot;
  return {
    snapshot,
    checksum: checksumSnapshot(snapshot),
    events
  };
}

export function checksumSnapshot(snapshot: MatchSnapshot): string {
  const canonical = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(canonical);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
