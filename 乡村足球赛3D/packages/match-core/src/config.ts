import type { MatchConfig } from './types.ts';

export const M0_MATCH_CONFIG: Readonly<MatchConfig> = Object.freeze({
  tickRate: 30,
  fieldLength: 64,
  fieldWidth: 42,
  goalWidth: 7.32,
  goalHeight: 2.44,
  playerRadius: 0.36,
  ballRadius: 0.11,
  jogSpeed: 5.4,
  sprintSpeed: 7.2,
  acceleration: 18,
  ballDrag: 0.55,
  ballGravity: 9.81,
  groundRestitution: 0.34,
  captureRadius: 0.86,
  captureMaxSpeed: 10,
  dribbleSpring: 42,
  dribbleDamping: 0.72,
  resetDelayTicks: 45
});

export const FIXED_DELTA_SECONDS = 1 / M0_MATCH_CONFIG.tickRate;
