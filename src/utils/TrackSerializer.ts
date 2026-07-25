import type RailTrack from '../entities/RailTrack';
import type { TrackDef } from '../config/WorldData';

/**
 * TrackSerializer – single source of truth for converting a live RailTrack
 * to its serialised TrackDef representation (and vice-versa helpers).
 */
export class TrackSerializer {
  /** Convert a live RailTrack to a serialisable TrackDef. */
  static toTrackDef(track: RailTrack): TrackDef {
    const { p0, p1, p2, p3 } = track.getControlPoints();
    return {
      uuid: track.getUUID(),
      geometryVersion: 1,
      p0: { x: p0.x, y: p0.y },
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y },
      isTunnel: track.isTunnel || undefined,
      elevation: track.elevation || undefined,
    };
  }
}
