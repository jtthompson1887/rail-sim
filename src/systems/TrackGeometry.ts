import { GameConfig } from '../config/GameConfig';
import type { Vec2Def } from '../config/WorldData';

export interface TrackGeometryDef {
  geometryVersion: 1;
  p0: Vec2Def;
  p1: Vec2Def;
  p2: Vec2Def;
  p3: Vec2Def;
}

export interface TrackGeometry {
  pointAt(t: number): Vec2Def;
  tangentAt(t: number): Vec2Def;
  approximateLength(sampleCount?: number): number;
  sample(sampleCount: number): Array<{ t: number; point: Vec2Def }>;
}

export interface AutomaticCubicInput {
  start: Vec2Def;
  end: Vec2Def;
  startOutward?: Vec2Def;
  endOutward?: Vec2Def;
}

function clampUnit(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function normalise(vector: Vec2Def, fallback: Vec2Def): Vec2Def {
  const length = Math.hypot(vector.x, vector.y);
  if (length > 0) {
    return { x: vector.x / length, y: vector.y / length };
  }

  const fallbackLength = Math.hypot(fallback.x, fallback.y);
  if (fallbackLength > 0) {
    return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
  }
  return { x: 1, y: 0 };
}

export function deriveTrackEndpointOutward(
  def: TrackGeometryDef,
  endpoint: 'start' | 'end',
): Vec2Def {
  const tangentCandidates = endpoint === 'start'
    ? [{
      x: def.p1.x - def.p0.x,
      y: def.p1.y - def.p0.y,
    }, {
      x: def.p2.x - def.p0.x,
      y: def.p2.y - def.p0.y,
    }, {
      x: def.p3.x - def.p0.x,
      y: def.p3.y - def.p0.y,
    }]
    : [{
      x: def.p3.x - def.p2.x,
      y: def.p3.y - def.p2.y,
    }, {
      x: def.p3.x - def.p1.x,
      y: def.p3.y - def.p1.y,
    }, {
      x: def.p3.x - def.p0.x,
      y: def.p3.y - def.p0.y,
    }];
  const tangent = tangentCandidates.find(
    (candidate) => candidate.x !== 0 || candidate.y !== 0,
  ) ?? { x: 1, y: 0 };
  const direction = normalise(tangent, { x: 1, y: 0 });
  const outward = endpoint === 'start'
    ? { x: -direction.x, y: -direction.y }
    : direction;
  return {
    x: Object.is(outward.x, -0) ? 0 : outward.x,
    y: Object.is(outward.y, -0) ? 0 : outward.y,
  };
}

export function createTrackGeometry(def: TrackGeometryDef): TrackGeometry {
  const pointAt = (rawT: number): Vec2Def => {
    const t = clampUnit(rawT);
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * def.p0.x
        + 3 * inverse ** 2 * t * def.p1.x
        + 3 * inverse * t ** 2 * def.p2.x
        + t ** 3 * def.p3.x,
      y: inverse ** 3 * def.p0.y
        + 3 * inverse ** 2 * t * def.p1.y
        + 3 * inverse * t ** 2 * def.p2.y
        + t ** 3 * def.p3.y,
    };
  };

  const tangentAt = (rawT: number): Vec2Def => {
    const t = clampUnit(rawT);
    const inverse = 1 - t;
    const derivative = {
      x: 3 * inverse ** 2 * (def.p1.x - def.p0.x)
        + 6 * inverse * t * (def.p2.x - def.p1.x)
        + 3 * t ** 2 * (def.p3.x - def.p2.x),
      y: 3 * inverse ** 2 * (def.p1.y - def.p0.y)
        + 6 * inverse * t * (def.p2.y - def.p1.y)
        + 3 * t ** 2 * (def.p3.y - def.p2.y),
    };
    return normalise(derivative, {
      x: def.p3.x - def.p0.x,
      y: def.p3.y - def.p0.y,
    });
  };

  const sample = (sampleCount: number): Array<{ t: number; point: Vec2Def }> => {
    const count = Math.max(1, Math.floor(sampleCount));
    return Array.from({ length: count + 1 }, (_, index) => {
      const t = index / count;
      return { t, point: pointAt(t) };
    });
  };

  return {
    pointAt,
    tangentAt,
    sample,
    approximateLength(sampleCount = 100): number {
      const samples = sample(sampleCount);
      let length = 0;
      for (let index = 1; index < samples.length; index++) {
        length += Math.hypot(
          samples[index].point.x - samples[index - 1].point.x,
          samples[index].point.y - samples[index - 1].point.y,
        );
      }
      return length;
    },
  };
}

export function deriveAutomaticCubic(input: AutomaticCubicInput): TrackGeometryDef {
  const chord = {
    x: input.end.x - input.start.x,
    y: input.end.y - input.start.y,
  };
  const chordLength = Math.hypot(chord.x, chord.y);
  const chordDirection = normalise(chord, { x: 1, y: 0 });
  const startDirection = normalise(input.startOutward ?? chordDirection, chordDirection);
  const endOutward = normalise(input.endOutward ?? {
    x: -chordDirection.x,
    y: -chordDirection.y,
  }, {
    x: -chordDirection.x,
    y: -chordDirection.y,
  });
  const controlDistance = Math.max(
    GameConfig.TRACK.MIN_CONTROL_DISTANCE_PX,
    Math.min(GameConfig.TRACK.MAX_CONTROL_DISTANCE_PX, chordLength / 3),
  );

  return {
    geometryVersion: 1,
    p0: { ...input.start },
    p1: {
      x: input.start.x + startDirection.x * controlDistance,
      y: input.start.y + startDirection.y * controlDistance,
    },
    p2: {
      x: input.end.x + endOutward.x * controlDistance,
      y: input.end.y + endOutward.y * controlDistance,
    },
    p3: { ...input.end },
  };
}
