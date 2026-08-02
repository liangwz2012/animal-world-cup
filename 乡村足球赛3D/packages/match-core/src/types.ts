export interface Vec2 {
  x: number;
  y: number;
}

export type TeamId = 'home' | 'away';
export type PlayerId = 'home-1' | 'home-2' | 'away-1';
export type KickKind = 'pass' | 'shot';
export type ContactFoot = 'left' | 'right';
export type MatchPhase = 'playing' | 'goal-freeze';

export interface MatchConfig {
  tickRate: number;
  fieldLength: number;
  fieldWidth: number;
  goalWidth: number;
  goalHeight: number;
  playerRadius: number;
  ballRadius: number;
  jogSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  ballDrag: number;
  ballGravity: number;
  groundRestitution: number;
  captureRadius: number;
  captureMaxSpeed: number;
  dribbleSpring: number;
  dribbleDamping: number;
  resetDelayTicks: number;
}

export interface KickCommand {
  kind: KickKind;
  aim: Vec2;
  power01: number;
}

export interface PlayerCommand {
  move: Vec2;
  sprint: boolean;
  kick?: KickCommand;
}

export interface InputFrame {
  tick: number;
  commands: Partial<Record<PlayerId, PlayerCommand>>;
}

export interface PlayerState {
  id: PlayerId;
  team: TeamId;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  stamina01: number;
  kickCooldownTicks: number;
}

export interface BallState {
  position: Vec2;
  velocity: Vec2;
  height: number;
  verticalVelocity: number;
  ownerId: PlayerId | null;
  lastTouchPlayerId: PlayerId | null;
  captureCooldownTicks: number;
}

export interface MatchSnapshot {
  version: 1;
  tick: number;
  phase: MatchPhase;
  phaseTicksRemaining: number;
  restartTeam: TeamId;
  score: Record<TeamId, number>;
  rngState: number;
  players: PlayerState[];
  ball: BallState;
}

export interface KickEvent {
  type: 'kick';
  tick: number;
  playerId: PlayerId;
  team: TeamId;
  kind: KickKind;
  foot: ContactFoot;
  aim: Vec2;
  power01: number;
  launchSpeed: number;
}

export interface PossessionEvent {
  type: 'possession';
  tick: number;
  playerId: PlayerId;
  previousOwnerId: PlayerId | null;
}

export interface GoalEvent {
  type: 'goal';
  tick: number;
  team: TeamId;
  scorerId: PlayerId | null;
  score: Record<TeamId, number>;
}

export interface BallBounceEvent {
  type: 'ball-bounce';
  tick: number;
  verticalSpeedBeforeImpact: number;
}

export type MatchEvent = KickEvent | PossessionEvent | GoalEvent | BallBounceEvent;

export interface StepResult {
  snapshot: MatchSnapshot;
  events: MatchEvent[];
}

export interface MatchCoreOptions {
  seed?: number;
  config?: Readonly<MatchConfig>;
}

export interface Replay {
  version: 1;
  seed: number;
  frames: InputFrame[];
}

export interface ReplayResult {
  snapshot: MatchSnapshot;
  checksum: string;
  events: MatchEvent[];
}
