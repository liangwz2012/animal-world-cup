import { FIXED_DELTA_SECONDS, M0_MATCH_CONFIG } from './config.ts';
import {
  clamp,
  clamp01,
  clampMagnitude,
  distance,
  length,
  moveTowards,
  normalize,
  quantize,
  quantizeVec
} from './math.ts';
import { XorShift32 } from './prng.ts';
import type {
  BallState,
  InputFrame,
  MatchConfig,
  MatchCoreOptions,
  MatchEvent,
  MatchSnapshot,
  PlayerCommand,
  PlayerId,
  PlayerState,
  StepResult,
  TeamId,
  Vec2
} from './types.ts';

const PLAYER_IDS: readonly PlayerId[] = ['home-1', 'home-2', 'away-1'];
const IDLE_COMMAND: Readonly<PlayerCommand> = Object.freeze({
  move: Object.freeze({ x: 0, y: 0 }),
  sprint: false
});

export class MatchCore {
  readonly config: Readonly<MatchConfig>;
  private readonly rng: XorShift32;
  private state: MatchSnapshot;

  constructor(options: MatchCoreOptions = {}) {
    this.config = options.config ?? M0_MATCH_CONFIG;
    this.rng = new XorShift32(options.seed ?? 0x20260802);
    this.state = createInitialState(this.config, this.rng.state);
  }

  get snapshot(): MatchSnapshot {
    return cloneSnapshot(this.state);
  }

  step(frame: InputFrame): StepResult {
    if (!Number.isInteger(frame.tick) || frame.tick !== this.state.tick) {
      throw new Error('输入 tick 不连续：期望 ' + this.state.tick + '，收到 ' + frame.tick);
    }

    const events: MatchEvent[] = [];

    if (this.state.phase === 'goal-freeze') {
      this.state.phaseTicksRemaining -= 1;
      if (this.state.phaseTicksRemaining <= 0) this.resetKickoff(this.state.restartTeam);
      this.finishTick();
      return { snapshot: this.snapshot, events };
    }

    this.updatePlayers(frame);
    this.applyKickCommands(frame, events);
    this.updateOwnedBall();
    this.integrateBall(events);
    this.tryCaptureBall(events);
    this.finishTick();

    return { snapshot: this.snapshot, events };
  }

  private updatePlayers(frame: InputFrame): void {
    const dt = 1 / this.config.tickRate;
    const halfLength = this.config.fieldLength / 2 - this.config.playerRadius;
    const halfWidth = this.config.fieldWidth / 2 - this.config.playerRadius;

    for (const player of this.state.players) {
      const command = frame.commands[player.id] ?? IDLE_COMMAND;
      const input = clampMagnitude(command.move, 1);
      const hasInput = length(input) > 1e-5;
      const canSprint = command.sprint && player.stamina01 > 0.04 && hasInput;
      const targetSpeed = canSprint ? this.config.sprintSpeed : this.config.jogSpeed;
      const targetVelocity = {
        x: input.x * targetSpeed,
        y: input.y * targetSpeed
      };
      const maximumDelta = this.config.acceleration * dt;

      player.velocity.x = moveTowards(player.velocity.x, targetVelocity.x, maximumDelta);
      player.velocity.y = moveTowards(player.velocity.y, targetVelocity.y, maximumDelta);
      player.position.x = clamp(player.position.x + player.velocity.x * dt, -halfLength, halfLength);
      player.position.y = clamp(player.position.y + player.velocity.y * dt, -halfWidth, halfWidth);

      if (hasInput) player.facing = normalize(input, player.facing);
      player.stamina01 = clamp01(
        player.stamina01 + (canSprint ? -0.16 : 0.09) * dt
      );
      if (player.kickCooldownTicks > 0) player.kickCooldownTicks -= 1;
    }
  }

  private applyKickCommands(frame: InputFrame, events: MatchEvent[]): void {
    const ownerId = this.state.ball.ownerId;
    if (!ownerId) return;

    const owner = this.findPlayer(ownerId);
    const command = frame.commands[ownerId];
    if (!command?.kick || owner.kickCooldownTicks > 0) return;

    const aim = normalize(command.kick.aim, owner.facing);
    const power = clamp01(command.kick.power01);
    const launchSpeed = command.kick.kind === 'shot'
      ? 15 + power * 9
      : 8 + power * 5;

    this.state.ball.ownerId = null;
    this.state.ball.lastTouchPlayerId = owner.id;
    this.state.ball.captureCooldownTicks = 6;
    this.state.ball.velocity = {
      x: aim.x * launchSpeed,
      y: aim.y * launchSpeed
    };
    this.state.ball.height = Math.max(this.state.ball.height, 0.08);
    this.state.ball.verticalVelocity = command.kick.kind === 'shot'
      ? 1.8 + power * 2.2
      : 0.6 + power * 0.9;
    owner.facing = aim;
    owner.kickCooldownTicks = 8;

    events.push({
      type: 'kick',
      tick: this.state.tick,
      playerId: owner.id,
      team: owner.team,
      kind: command.kick.kind,
      foot: this.state.tick % 2 === 0 ? 'right' : 'left',
      aim: { ...aim },
      power01: power,
      launchSpeed
    });
  }

  private updateOwnedBall(): void {
    const ownerId = this.state.ball.ownerId;
    if (!ownerId) return;

    const owner = this.findPlayer(ownerId);
    const dt = 1 / this.config.tickRate;
    const strideSide = this.state.tick % 12 < 6 ? -0.08 : 0.08;
    const target = {
      x: owner.position.x + owner.facing.x * 0.7 - owner.facing.y * strideSide,
      y: owner.position.y + owner.facing.y * 0.7 + owner.facing.x * strideSide
    };
    const offset = {
      x: target.x - this.state.ball.position.x,
      y: target.y - this.state.ball.position.y
    };

    this.state.ball.velocity.x =
      (this.state.ball.velocity.x + offset.x * this.config.dribbleSpring * dt) *
      this.config.dribbleDamping;
    this.state.ball.velocity.y =
      (this.state.ball.velocity.y + offset.y * this.config.dribbleSpring * dt) *
      this.config.dribbleDamping;
    this.state.ball.height = 0;
    this.state.ball.verticalVelocity = 0;
  }

  private integrateBall(events: MatchEvent[]): void {
    const ball = this.state.ball;
    const dt = FIXED_DELTA_SECONDS;

    if (!ball.ownerId) {
      const drag = Math.max(0, 1 - this.config.ballDrag * dt);
      ball.velocity.x *= drag;
      ball.velocity.y *= drag;
    }

    ball.position.x += ball.velocity.x * dt;
    ball.position.y += ball.velocity.y * dt;

    if (ball.height > 0 || ball.verticalVelocity > 0) {
      ball.verticalVelocity -= this.config.ballGravity * dt;
      ball.height += ball.verticalVelocity * dt;
      if (ball.height <= 0) {
        const impact = ball.verticalVelocity;
        ball.height = 0;
        if (Math.abs(impact) > 0.8) {
          ball.verticalVelocity = -impact * this.config.groundRestitution;
          events.push({
            type: 'ball-bounce',
            tick: this.state.tick,
            verticalSpeedBeforeImpact: Math.abs(impact)
          });
        } else {
          ball.verticalVelocity = 0;
        }
      }
    }

    if (this.tryRegisterGoal(events)) return;
    this.resolveFieldBoundaries();
  }

  private tryRegisterGoal(events: MatchEvent[]): boolean {
    const ball = this.state.ball;
    const halfLength = this.config.fieldLength / 2;
    const insideMouth =
      Math.abs(ball.position.y) <= this.config.goalWidth / 2 &&
      ball.height <= this.config.goalHeight;
    if (!insideMouth || Math.abs(ball.position.x) < halfLength) return false;

    const scoringTeam: TeamId = ball.position.x > 0 ? 'home' : 'away';
    const scorer = ball.lastTouchPlayerId
      ? this.findPlayer(ball.lastTouchPlayerId)
      : null;
    this.state.score[scoringTeam] += 1;
    this.state.phase = 'goal-freeze';
    this.state.phaseTicksRemaining = this.config.resetDelayTicks;
    this.state.restartTeam = scoringTeam === 'home' ? 'away' : 'home';
    ball.ownerId = null;
    ball.velocity = { x: 0, y: 0 };
    ball.verticalVelocity = 0;

    events.push({
      type: 'goal',
      tick: this.state.tick,
      team: scoringTeam,
      scorerId: scorer?.team === scoringTeam ? scorer.id : null,
      score: { ...this.state.score }
    });
    return true;
  }

  private resolveFieldBoundaries(): void {
    const ball = this.state.ball;
    const halfLength = this.config.fieldLength / 2 - this.config.ballRadius;
    const halfWidth = this.config.fieldWidth / 2 - this.config.ballRadius;
    const insideGoalChannel =
      Math.abs(ball.position.y) <= this.config.goalWidth / 2 &&
      ball.height <= this.config.goalHeight;

    if (Math.abs(ball.position.x) > halfLength && !insideGoalChannel) {
      ball.position.x = clamp(ball.position.x, -halfLength, halfLength);
      ball.velocity.x *= -0.58;
      ball.ownerId = null;
    }
    if (Math.abs(ball.position.y) > halfWidth) {
      ball.position.y = clamp(ball.position.y, -halfWidth, halfWidth);
      ball.velocity.y *= -0.58;
      ball.ownerId = null;
    }
  }

  private tryCaptureBall(events: MatchEvent[]): void {
    const ball = this.state.ball;
    if (ball.ownerId || ball.captureCooldownTicks > 0) return;
    if (length(ball.velocity) > this.config.captureMaxSpeed || ball.height > 0.5) return;

    const candidates = this.state.players
      .map((player) => ({ player, distance: distance(player.position, ball.position) }))
      .filter(({ distance: value }) => value <= this.config.captureRadius)
      .sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id));
    const winner = candidates[0]?.player;
    if (!winner) return;

    const previousOwnerId = ball.ownerId;
    ball.ownerId = winner.id;
    ball.lastTouchPlayerId = winner.id;
    ball.velocity.x *= 0.35;
    ball.velocity.y *= 0.35;
    events.push({
      type: 'possession',
      tick: this.state.tick,
      playerId: winner.id,
      previousOwnerId
    });
  }

  private resetKickoff(team: TeamId): void {
    const ownerId: PlayerId = team === 'home' ? 'home-1' : 'away-1';
    const sign = team === 'home' ? -1 : 1;
    for (const player of this.state.players) {
      const position = initialPlayerPosition(player.id);
      player.position = position;
      player.velocity = { x: 0, y: 0 };
      player.facing = player.team === 'home' ? { x: 1, y: 0 } : { x: -1, y: 0 };
      player.kickCooldownTicks = 0;
    }
    const owner = this.findPlayer(ownerId);
    owner.position = { x: sign * 0.9, y: 0 };
    this.state.ball = createBall(owner, this.config);
    this.state.phase = 'playing';
    this.state.phaseTicksRemaining = 0;
  }

  private finishTick(): void {
    if (this.state.ball.captureCooldownTicks > 0) {
      this.state.ball.captureCooldownTicks -= 1;
    }

    for (const player of this.state.players) {
      player.position = quantizeVec(player.position);
      player.velocity = quantizeVec(player.velocity);
      player.facing = quantizeVec(normalize(player.facing));
      player.stamina01 = quantize(player.stamina01);
    }
    this.state.ball.position = quantizeVec(this.state.ball.position);
    this.state.ball.velocity = quantizeVec(this.state.ball.velocity);
    this.state.ball.height = quantize(this.state.ball.height);
    this.state.ball.verticalVelocity = quantize(this.state.ball.verticalVelocity);
    this.state.rngState = this.rng.state;
    this.state.tick += 1;
  }

  private findPlayer(id: PlayerId): PlayerState {
    const player = this.state.players.find((candidate) => candidate.id === id);
    if (!player) throw new Error('未知球员：' + id);
    return player;
  }
}

function createInitialState(config: Readonly<MatchConfig>, rngState: number): MatchSnapshot {
  const players = PLAYER_IDS.map((id): PlayerState => ({
    id,
    team: id.startsWith('home') ? 'home' : 'away',
    position: initialPlayerPosition(id),
    velocity: { x: 0, y: 0 },
    facing: id.startsWith('home') ? { x: 1, y: 0 } : { x: -1, y: 0 },
    stamina01: 1,
    kickCooldownTicks: 0
  }));
  const owner = players[0];
  if (!owner) throw new Error('M0 至少需要一个球员');
  return {
    version: 1,
    tick: 0,
    phase: 'playing',
    phaseTicksRemaining: 0,
    restartTeam: 'home',
    score: { home: 0, away: 0 },
    rngState,
    players,
    ball: createBall(owner, config)
  };
}

function initialPlayerPosition(id: PlayerId): Vec2 {
  switch (id) {
    case 'home-1':
      return { x: -8, y: 0 };
    case 'home-2':
      return { x: -13, y: 6 };
    case 'away-1':
      return { x: 7, y: 0 };
  }
}

function createBall(owner: PlayerState, config = M0_MATCH_CONFIG): BallState {
  return {
    position: {
      x: owner.position.x + owner.facing.x * (config.playerRadius + config.ballRadius + 0.23),
      y: owner.position.y + owner.facing.y * (config.playerRadius + config.ballRadius + 0.23)
    },
    velocity: { x: 0, y: 0 },
    height: 0,
    verticalVelocity: 0,
    ownerId: owner.id,
    lastTouchPlayerId: owner.id,
    captureCooldownTicks: 0
  };
}

function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return {
    version: snapshot.version,
    tick: snapshot.tick,
    phase: snapshot.phase,
    phaseTicksRemaining: snapshot.phaseTicksRemaining,
    restartTeam: snapshot.restartTeam,
    score: { ...snapshot.score },
    rngState: snapshot.rngState,
    players: snapshot.players.map((player) => ({
      ...player,
      position: { ...player.position },
      velocity: { ...player.velocity },
      facing: { ...player.facing }
    })),
    ball: {
      ...snapshot.ball,
      position: { ...snapshot.ball.position },
      velocity: { ...snapshot.ball.velocity }
    }
  };
}
