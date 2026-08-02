import { M0_MATCH_CONFIG } from '@rural-football/match-core';
import type { KickEvent, PlayerState } from '@rural-football/match-core';
import type {
  AnimationSemantic,
  BuildPresentationFrameInput,
  PlayerPresentationState,
  PresentationFrame
} from './types.ts';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * clamp01(alpha);
}

export function buildPresentationFrame(input: BuildPresentationFrameInput): PresentationFrame {
  const alpha = clamp01(input.interpolationAlpha);
  const kickByPlayer = new Map(
    input.events
      .filter((event): event is KickEvent => event.type === 'kick')
      .map((event) => [event.playerId, event])
  );

  const players = input.current.players.map((currentPlayer): PlayerPresentationState => {
    const previousPlayer =
      input.previous.players.find((candidate) => candidate.id === currentPlayer.id) ??
      currentPlayer;
    const kick = kickByPlayer.get(currentPlayer.id);
    const speed = Math.hypot(currentPlayer.velocity.x, currentPlayer.velocity.y);
    const result: PlayerPresentationState = {
      id: currentPlayer.id,
      team: currentPlayer.team,
      position: {
        x: lerp(previousPlayer.position.x, currentPlayer.position.x, alpha),
        y: 0,
        z: lerp(previousPlayer.position.y, currentPlayer.position.y, alpha)
      },
      yawRadians: yawFromFacing(currentPlayer),
      speedMetersPerSecond: speed,
      animation: animationFor(currentPlayer, kick)
    };
    if (kick) {
      result.footContact = {
        tick: kick.tick,
        foot: kick.foot,
        kind: kick.kind
      };
    }
    return result;
  });

  return {
    tick: input.current.tick,
    interpolationAlpha: alpha,
    score: { ...input.current.score },
    players,
    ball: {
      position: {
        x: lerp(input.previous.ball.position.x, input.current.ball.position.x, alpha),
        y: lerp(input.previous.ball.height, input.current.ball.height, alpha) +
          M0_MATCH_CONFIG.ballRadius,
        z: lerp(input.previous.ball.position.y, input.current.ball.position.y, alpha)
      },
      speedMetersPerSecond: Math.hypot(
        input.current.ball.velocity.x,
        input.current.ball.velocity.y
      ),
      ownerId: input.current.ball.ownerId
    },
    events: input.events
  };
}

function yawFromFacing(player: PlayerState): number {
  return Math.atan2(player.facing.x, player.facing.y);
}

function animationFor(player: PlayerState, kick?: KickEvent): AnimationSemantic {
  if (kick) return kick.kind === 'shot' ? 'shoot' : 'pass';
  const speed = Math.hypot(player.velocity.x, player.velocity.y);
  if (speed < 0.2) return 'idle';
  if (speed >= M0_MATCH_CONFIG.jogSpeed + 0.7) return 'sprint';
  return 'jog';
}
