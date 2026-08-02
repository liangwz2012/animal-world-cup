import type {
  ContactFoot,
  MatchEvent,
  MatchSnapshot,
  PlayerId,
  TeamId
} from '@rural-football/match-core';

export type AnimationSemantic = 'idle' | 'jog' | 'sprint' | 'pass' | 'shoot' | 'stumble';

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

export interface FootContactCue {
  tick: number;
  foot: ContactFoot;
  kind: 'pass' | 'shot';
}

export interface PlayerPresentationState {
  id: PlayerId;
  team: TeamId;
  position: WorldPosition;
  yawRadians: number;
  speedMetersPerSecond: number;
  animation: AnimationSemantic;
  footContact?: FootContactCue;
}

export interface BallPresentationState {
  position: WorldPosition;
  speedMetersPerSecond: number;
  ownerId: PlayerId | null;
}

export interface PresentationFrame {
  tick: number;
  interpolationAlpha: number;
  score: Record<TeamId, number>;
  players: PlayerPresentationState[];
  ball: BallPresentationState;
  events: readonly MatchEvent[];
}

export interface PresentationPort {
  readonly engineId: 'layaair' | 'galacean';
  initialize(): Promise<void>;
  render(frame: PresentationFrame): void;
  pause(): void;
  resume(): void;
  dispose(): Promise<void> | void;
}

export interface BuildPresentationFrameInput {
  previous: MatchSnapshot;
  current: MatchSnapshot;
  interpolationAlpha: number;
  events: readonly MatchEvent[];
}
