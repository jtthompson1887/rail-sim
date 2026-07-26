import {
  CAB_PARTS,
  CAB_MATERIALS,
  CAB_DRIVER_EYE,
  CAB_SHELL_IDS,
  getCabPartBuildOrder,
  type CabPart,
  type CabPartKind,
} from '../../src/cab3d/cab/CabPartLibrary';

/**
 * Pure geometry checks for the cab part tables.
 *
 * These helpers mirror the transforms the Babylon builder will apply so the
 * tests can validate the data without importing @babylonjs.
 */

type Vec3 = [number, number, number];

type AABB = {
  min: Vec3;
  max: Vec3;
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function matMul(a: number[][], b: number[][]): number[][] {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

function rotationX(theta: number): number[][] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function rotationY(theta: number): number[][] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function rotationZ(theta: number): number[][] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function eulerMatrix(rx: number, ry: number, rz: number): number[][] {
  // Match Babylon's RotationYawPitchRoll order: Z * X * Y
  return matMul(rotationZ(rz), matMul(rotationX(rx), rotationY(ry)));
}

function transformPoint(m: number[][], t: Vec3, p: Vec3): Vec3 {
  return [
    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + t[0],
    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + t[1],
    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + t[2],
  ];
}

function combineAABBs(a: AABB, b: AABB): AABB {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

function getHalfSizes(kind: CabPartKind, size: readonly number[]): Vec3 | null {
  switch (kind) {
    case 'box':
      return [size[0] / 2, size[1] / 2, size[2] / 2];
    case 'cylinder': {
      const r = size[0] / 2;
      const hh = size[1] / 2;
      return [r, hh, r];
    }
    case 'sphere': {
      const r = size[0] / 2;
      return [r, r, r];
    }
    case 'plane':
      return [size[0] / 2, size[1] / 2, 0];
    case 'node':
      return null;
    default:
      return null;
  }
}

function partLocalCorners(kind: CabPartKind, size: readonly number[]): Vec3[] {
  const hs = getHalfSizes(kind, size);
  if (!hs) return [];

  const corners: Vec3[] = [];
  for (let ix = -1; ix <= 1; ix += 2) {
    for (let iy = -1; iy <= 1; iy += 2) {
      for (let iz = -1; iz <= 1; iz += 2) {
        corners.push([hs[0] * ix, hs[1] * iy, hs[2] * iz]);
      }
    }
  }
  return corners;
}

function computePartAABB(
  part: CabPart,
  byId: Map<string, CabPart>,
  memo: Map<string, { m: number[][]; t: Vec3 }>,
): AABB | null {
  if (part.kind === 'node') return null;

  function worldTransform(id: string): { m: number[][]; t: Vec3 } {
    if (memo.has(id)) return memo.get(id)!;

    const p = byId.get(id)!;
    const localM = eulerMatrix(
      degToRad(p.rotationDeg[1] ?? 0),
      degToRad(p.rotationDeg[0] ?? 0),
      degToRad(p.rotationDeg[2] ?? 0),
    );

    if (p.parent) {
      const parent = worldTransform(p.parent);
      const t: Vec3 = transformPoint(parent.m, parent.t, [
        p.position[1] ?? 0,
        p.position[0] ?? 0,
        p.position[2] ?? 0,
      ]);
      const m = matMul(parent.m, localM);
      const result = { m, t };
      memo.set(id, result);
      return result;
    }

    const result = {
      m: localM,
      t: [p.position[1] ?? 0, p.position[0] ?? 0, p.position[2] ?? 0] as Vec3,
    };
    memo.set(id, result);
    return result;
  }

  // Wait: the position array is [x, y, z]. The transform helpers above swap x
  // and y because they assumed [pitch, yaw, roll] ordering. Correct that here.
  function worldTransformCorrected(id: string): { m: number[][]; t: Vec3 } {
    if (memo.has(id)) return memo.get(id)!;

    const p = byId.get(id)!;
    const localM = eulerMatrix(
      degToRad(p.rotationDeg[0] ?? 0),
      degToRad(p.rotationDeg[1] ?? 0),
      degToRad(p.rotationDeg[2] ?? 0),
    );

    const localT: Vec3 = [p.position[0], p.position[1], p.position[2]];

    if (p.parent) {
      const parent = worldTransformCorrected(p.parent);
      const t: Vec3 = transformPoint(parent.m, parent.t, localT);
      const m = matMul(parent.m, localM);
      const result = { m, t };
      memo.set(id, result);
      return result;
    }

    const result = { m: localM, t: localT };
    memo.set(id, result);
    return result;
  }

  const wt = worldTransformCorrected(part.id);
  const corners = partLocalCorners(part.kind, part.size);
  if (corners.length === 0) return null;

  const first = transformPoint(wt.m, wt.t, corners[0]);
  const aabb: AABB = { min: [...first], max: [...first] };

  for (let i = 1; i < corners.length; i += 1) {
    const p = transformPoint(wt.m, wt.t, corners[i]);
    for (let axis = 0; axis < 3; axis += 1) {
      aabb.min[axis] = Math.min(aabb.min[axis], p[axis]);
      aabb.max[axis] = Math.max(aabb.max[axis], p[axis]);
    }
  }

  return aabb;
}

function pointInsideAABB(point: Vec3, aabb: AABB): boolean {
  return (
    point[0] >= aabb.min[0]
    && point[0] <= aabb.max[0]
    && point[1] >= aabb.min[1]
    && point[1] <= aabb.max[1]
    && point[2] >= aabb.min[2]
    && point[2] <= aabb.max[2]
  );
}

function distancePointToAABB(point: Vec3, aabb: AABB): number {
  let dx = 0;
  if (point[0] < aabb.min[0]) dx = aabb.min[0] - point[0];
  else if (point[0] > aabb.max[0]) dx = point[0] - aabb.max[0];

  let dy = 0;
  if (point[1] < aabb.min[1]) dy = aabb.min[1] - point[1];
  else if (point[1] > aabb.max[1]) dy = point[1] - aabb.max[1];

  let dz = 0;
  if (point[2] < aabb.min[2]) dz = aabb.min[2] - point[2];
  else if (point[2] > aabb.max[2]) dz = point[2] - aabb.max[2];

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

describe('CabPartLibrary', () => {
  const byId = new Map(CAB_PARTS.map((p) => [p.id, p]));

  it('is frozen', () => {
    expect(Object.isFrozen(CAB_PARTS)).toBe(true);
    expect(Object.isFrozen(CAB_MATERIALS)).toBe(true);
  });

  it('has unique ids', () => {
    const ids = CAB_PARTS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('has no duplicate material ids', () => {
    const ids = Object.values(CAB_MATERIALS).map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('references only defined materials', () => {
    const missing = CAB_PARTS.filter(
      (p) => p.material && !CAB_MATERIALS[p.material],
    );
    expect(missing).toEqual([]);
  });

  it('resolves every parent', () => {
    const failures = CAB_PARTS.filter(
      (p) => p.parent && !byId.has(p.parent),
    ).map((p) => p.id);
    expect(failures).toEqual([]);
  });

  it('has no cycles', () => {
    expect(() => getCabPartBuildOrder(CAB_PARTS)).not.toThrow();
    const order = getCabPartBuildOrder(CAB_PARTS);
    const orderIds = order.map((p) => p.id);
    const seen = new Set<string>();
    for (const id of orderIds) {
      const part = byId.get(id)!;
      if (part.parent) {
        expect(seen.has(part.parent)).toBe(true);
      }
      seen.add(id);
    }
  });

  it('parents appear before children in the build order', () => {
    const order = getCabPartBuildOrder(CAB_PARTS);
    const index = new Map(order.map((p, i) => [p.id, i]));
    for (const part of CAB_PARTS) {
      if (part.parent) {
        expect(index.get(part.parent)!).toBeLessThan(index.get(part.id)!);
      }
    }
  });

  it('places the driver eye inside the shell AABB', () => {
    const shellParts = CAB_PARTS.filter((p) =>
      (CAB_SHELL_IDS as readonly string[]).includes(p.id),
    );
    expect(shellParts.length).toBe(CAB_SHELL_IDS.length);

    const memo = new Map<string, { m: number[][]; t: Vec3 }>();
    const aabbs = shellParts
      .map((p) => computePartAABB(p, byId, memo))
      .filter((a): a is AABB => a !== null);

    expect(aabbs.length).toBe(shellParts.length);

    const shellAABB = aabbs.reduce(combineAABBs);
    const eye: Vec3 = [CAB_DRIVER_EYE.x, CAB_DRIVER_EYE.y, CAB_DRIVER_EYE.z];
    expect(pointInsideAABB(eye, shellAABB)).toBe(true);
  });

  it('keeps the driver eye outside every solid AABB by at least 0.02 m', () => {
    const solidKinds: ReadonlySet<CabPartKind> = new Set([
      'box',
      'cylinder',
      'sphere',
    ]);
    const solidParts = CAB_PARTS.filter((p) => solidKinds.has(p.kind));
    const eye: Vec3 = [CAB_DRIVER_EYE.x, CAB_DRIVER_EYE.y, CAB_DRIVER_EYE.z];

    const memo = new Map<string, { m: number[][]; t: Vec3 }>();
    const failures: string[] = [];

    for (const part of solidParts) {
      const aabb = computePartAABB(part, byId, memo);
      if (!aabb) continue;

      const distance = distancePointToAABB(eye, aabb);
      if (distance < 0.02) {
        failures.push(
          `${part.id}: distance ${distance.toFixed(4)} m is less than 0.02 m`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
