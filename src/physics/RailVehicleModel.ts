import {
  RouteCursor,
  type RouteCursorState,
  type RouteResolver,
} from './RouteCursor';
import type { DerailmentHazardState } from './DerailmentEvaluator';

export interface RailVehicleDefinition {
  id: string;
  massKg: number;
  bodyLength: number;
  wheelbase: number;
  frontCouplerOffset: number;
  rearCouplerOffset: number;
  maxTractiveEffortN: number;
  maxBrakeForceN: number;
}

export interface OnRailVehicleState {
  mode: 'on-rail';
  vehicleId: string;
  centre: RouteCursorState;
  speedMps: number;
  hazard: DerailmentHazardState;
}

export interface RailVehiclePose {
  centre: { x: number; y: number };
  angleRad: number;
  frontBogie: { x: number; y: number };
  rearBogie: { x: number; y: number };
  frontCoupler: { x: number; y: number };
  rearCoupler: { x: number; y: number };
  curvature: number;
}

export function deriveRailVehiclePose(
  definition: RailVehicleDefinition,
  state: OnRailVehicleState,
  resolver: RouteResolver,
): RailVehiclePose {
  const centreCursor = new RouteCursor(state.centre, resolver);
  const frontBogie = centreCursor.movedBy(definition.wheelbase / 2).pose().point;
  const rearBogie = centreCursor.movedBy(-definition.wheelbase / 2).pose().point;
  const frontCoupler = centreCursor.movedBy(definition.frontCouplerOffset).pose().point;
  const rearCoupler = centreCursor.movedBy(-definition.rearCouplerOffset).pose().point;
  const centrePose = centreCursor.pose();

  return {
    centre: {
      x: (frontBogie.x + rearBogie.x) / 2,
      y: (frontBogie.y + rearBogie.y) / 2,
    },
    angleRad: Math.atan2(
      frontBogie.y - rearBogie.y,
      frontBogie.x - rearBogie.x,
    ),
    frontBogie,
    rearBogie,
    frontCoupler,
    rearCoupler,
    curvature: centrePose.curvature,
  };
}
