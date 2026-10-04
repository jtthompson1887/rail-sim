import type { JunctionDef, Vec2Def } from '../config/WorldData';
import type { TrackGeometryDef } from '../systems/TrackGeometry';
import { MAX_SEGMENT_LENGTH } from '../config/ConstructionConfig';

export interface TemplateTrack extends TrackGeometryDef { uuid: string }
export interface PassingLoopTemplate {
  tracks: TemplateTrack[];
  junctions: JunctionDef[];
  mainTrackId: string;
  loopTrackIds: string[];
  clearStandingLength: number;
}
export type PassingLoopResult = { ok: true; template: PassingLoopTemplate } | { ok: false; message: string };

/** Six reservation sections: two approach stems, one main line and a three-section parallel loop. */
export function fitPassingLoop(input: { start: Vec2Def; end: Vec2Def; tangentAngleRad?: number; side?: 1 | -1; idPrefix?: string }): PassingLoopResult {
  if (![input.start.x, input.start.y, input.end.x, input.end.y].every(Number.isFinite)) return { ok: false, message: 'Choose two finite endpoints for the loop.' };
  const dx = input.end.x - input.start.x, dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 2_200 || length > Math.min(8_000, MAX_SEGMENT_LENGTH / 0.7)) return { ok: false, message: 'A passing loop needs endpoints between 2,200 and 8,000 world units apart.' };
  const angle = Math.atan2(dy, dx);
  if (input.tangentAngleRad !== undefined && (!Number.isFinite(input.tangentAngleRad) || Math.abs(Math.atan2(Math.sin(input.tangentAngleRad - angle), Math.cos(input.tangentAngleRad - angle))) > 0.01)) return { ok: false, message: 'Align both selected endpoints with the approach direction before fitting a loop.' };
  const tangent = { x: dx / length, y: dy / length };
  const normal = { x: -tangent.y * (input.side ?? 1), y: tangent.x * (input.side ?? 1) };
  const point = (x: number, y = 0): Vec2Def => ({ x: input.start.x + tangent.x * x + normal.x * y, y: input.start.y + tangent.y * x + normal.y * y });
  const prefix = input.idPrefix ?? 'passing-loop';
  const stem = length * 0.15;
  const turnoutLength = 500;
  const separation = 144;
  const cubic = (name: string, startX: number, endX: number, startY = 0, endY = 0): TemplateTrack => ({ uuid: `${prefix}:${name}`, geometryVersion: 1, p0: point(startX, startY), p1: point(startX + (endX - startX) / 3, startY), p2: point(startX + 2 * (endX - startX) / 3, endY), p3: point(endX, endY) });
  const tracks = [
    cubic('west-approach', 0, stem),
    cubic('main', stem, length - stem),
    cubic('east-approach', length - stem, length),
    cubic('loop-entry', stem, stem + turnoutLength, 0, separation),
    cubic('loop-standing', stem + turnoutLength, length - stem - turnoutLength, separation, separation),
    cubic('loop-exit', length - stem - turnoutLength, length - stem, separation, 0),
  ];
  const junctions: JunctionDef[] = [
    { uuid: `${prefix}:west-turnout`, mainTrackUUID: tracks[0].uuid, leftTrackUUID: tracks[3].uuid, rightTrackUUID: tracks[1].uuid, position: 1, branchState: 'right' },
    { uuid: `${prefix}:east-turnout`, mainTrackUUID: tracks[2].uuid, leftTrackUUID: tracks[5].uuid, rightTrackUUID: tracks[1].uuid, position: 0, branchState: 'right' },
  ];
  return { ok: true, template: { tracks, junctions, mainTrackId: tracks[1].uuid, loopTrackIds: tracks.slice(3).map(t => t.uuid), clearStandingLength: length - 2 * stem - 2 * turnoutLength } };
}
