import type {
  OnRailVehicleState,
  RailVehicleDefinition,
  RailVehiclePose,
} from './RailVehicleModel';

export interface RailCollision {
  vehicleAId: string;
  vehicleBId: string;
  point: { x: number; y: number };
  normal: { x: number; y: number };
  closingSpeedMps: number;
  impulseNs: number;
}

export interface RailCollisionVehicle {
  vehicleId: string;
  definition: RailVehicleDefinition;
  state: OnRailVehicleState;
}

function normalBetween(
  left: { x: number; y: number },
  right: { x: number; y: number },
): { x: number; y: number } {
  const x = right.x - left.x;
  const y = right.y - left.y;
  const length = Math.hypot(x, y);
  return length > 1e-12 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function effectiveMass(leftKg: number, rightKg: number): number {
  return (leftKg * rightKg) / (leftKg + rightKg);
}

function segmentIntersection(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number },
): { x: number; y: number } | null {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) <= 1e-12) return null;
  const offsetX = b0.x - a0.x;
  const offsetY = b0.y - a0.y;
  const alongA = (offsetX * by - offsetY * bx) / denominator;
  const alongB = (offsetX * ay - offsetY * ax) / denominator;
  if (alongA < 0 || alongA > 1 || alongB < 0 || alongB > 1) return null;
  return { x: a0.x + ax * alongA, y: a0.y + ay * alongA };
}

function velocity(
  vehicle: RailCollisionVehicle,
  pose: RailVehiclePose,
): { x: number; y: number } {
  return {
    x: Math.cos(pose.angleRad) * vehicle.state.speedMps,
    y: Math.sin(pose.angleRad) * vehicle.state.speedMps,
  };
}

export function detectRailCollisions(
  vehicles: readonly RailCollisionVehicle[],
  previousPoses: ReadonlyMap<string, RailVehiclePose>,
  currentPoses: ReadonlyMap<string, RailVehiclePose>,
  dtSeconds: number,
): readonly RailCollision[] {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new Error('Rail collision step duration must be a positive finite number');
  }

  const collisions: RailCollision[] = [];
  for (let leftIndex = 0; leftIndex < vehicles.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < vehicles.length; rightIndex++) {
      const vehicleA = vehicles[leftIndex];
      const vehicleB = vehicles[rightIndex];
      const currentA = currentPoses.get(vehicleA.vehicleId);
      const currentB = currentPoses.get(vehicleB.vehicleId);
      const previousA = previousPoses.get(vehicleA.vehicleId);
      const previousB = previousPoses.get(vehicleB.vehicleId);
      if (!currentA || !currentB || !previousA || !previousB) continue;

      if (vehicleA.state.centre.trackUUID === vehicleB.state.centre.trackUUID) {
        const routeSeparation = Math.abs(
          vehicleA.state.centre.distance - vehicleB.state.centre.distance,
        );
        const contactDistance = (
          vehicleA.definition.bodyLength + vehicleB.definition.bodyLength
        ) / 2;
        if (routeSeparation > contactDistance) continue;

        const aBeforeB = vehicleA.state.centre.distance <= vehicleB.state.centre.distance;
        const lower = aBeforeB ? vehicleA : vehicleB;
        const upper = aBeforeB ? vehicleB : vehicleA;
        const lowerVelocity = lower.state.speedMps * lower.state.centre.direction;
        const upperVelocity = upper.state.speedMps * upper.state.centre.direction;
        const closingSpeedMps = Math.max(0, lowerVelocity - upperVelocity);
        const impulseNs = effectiveMass(
          vehicleA.definition.massKg,
          vehicleB.definition.massKg,
        ) * closingSpeedMps;
        collisions.push({
          vehicleAId: vehicleA.vehicleId,
          vehicleBId: vehicleB.vehicleId,
          point: {
            x: (currentA.centre.x + currentB.centre.x) / 2,
            y: (currentA.centre.y + currentB.centre.y) / 2,
          },
          normal: normalBetween(currentA.centre, currentB.centre),
          closingSpeedMps,
          impulseNs,
        });
        continue;
      }

      const point = segmentIntersection(
        previousA.centre,
        currentA.centre,
        previousB.centre,
        currentB.centre,
      );
      if (!point) continue;
      const velocityA = velocity(vehicleA, currentA);
      const velocityB = velocity(vehicleB, currentB);
      const relativeVelocity = {
        x: velocityA.x - velocityB.x,
        y: velocityA.y - velocityB.y,
      };
      const closingSpeedMps = Math.hypot(relativeVelocity.x, relativeVelocity.y);
      collisions.push({
        vehicleAId: vehicleA.vehicleId,
        vehicleBId: vehicleB.vehicleId,
        point,
        normal: normalBetween(currentA.centre, currentB.centre),
        closingSpeedMps,
        impulseNs: effectiveMass(
          vehicleA.definition.massKg,
          vehicleB.definition.massKg,
        ) * closingSpeedMps,
      });
    }
  }
  return collisions;
}
