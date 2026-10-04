import type { RailVehicleDefinition } from '../physics/RailVehicleModel';
import type { TrainDef } from '../config/WorldData';
import { getFreightSet } from '../freight/FreightSetCatalog';
import { getProduct } from '../economy/ProductCatalog';

export interface PoweredVehicleFamily {
  id: string; displayName: string; role: 'shunting' | 'mixed-traffic' | 'heavy-freight' | 'regional-passenger' | 'commuter' | 'express';
  traction: 'diesel' | 'electric'; purchasePrice: number; runningCostPerTick: number;
  powerKw: number; tractiveEffortN: number; massKg: number; brakeForceN: number;
  maxSpeedKph: number; lengthMetres: number; passengerCapacity: number;
  description: string;
}
export interface UnpoweredVehicleFamily {
  id: string; displayName: string; compatibleProductIds: readonly string[]; payloadKg: number; volumeLitres: number;
  passengerCapacity: number; massKg: number; lengthMetres: number; maxSpeedKph: number; purchasePrice: number;
}

export const POWERED_VEHICLE_FAMILIES: readonly PoweredVehicleFamily[] = [
  { id: 'diesel-shunter', displayName: 'D35 Yard Shunter', role: 'shunting', traction: 'diesel', purchasePrice: 55_000, runningCostPerTick: 10, powerKw: 350, tractiveEffortN: 180_000, massKg: 49_000, brakeForceN: 90_000, maxSpeedKph: 45, lengthMetres: 11, passengerCapacity: 0, description: 'Cheap short-distance freight; strong starts, low line speed.' },
  { id: 'mixed-diesel', displayName: 'D16 Mixed Traffic', role: 'mixed-traffic', traction: 'diesel', purchasePrice: 90_000, runningCostPerTick: 20, powerKw: 1_600, tractiveEffortN: 260_000, massKg: 84_000, brakeForceN: 150_000, maxSpeedKph: 120, lengthMetres: 19, passengerCapacity: 0, description: 'Flexible diesel for freight or coaches without overhead wires.' },
  { id: 'electric-freight', displayName: 'E50 Freight Electric', role: 'heavy-freight', traction: 'electric', purchasePrice: 160_000, runningCostPerTick: 15, powerKw: 5_000, tractiveEffortN: 340_000, massKg: 90_000, brakeForceN: 220_000, maxSpeedKph: 140, lengthMetres: 20, passengerCapacity: 0, description: 'Heavy loads and steep grades; requires an electrified route.' },
  { id: 'regional-dmu', displayName: 'D2 Regional Unit', role: 'regional-passenger', traction: 'diesel', purchasePrice: 100_000, runningCostPerTick: 13, powerKw: 750, tractiveEffortN: 110_000, massKg: 70_000, brakeForceN: 130_000, maxSpeedKph: 120, lengthMetres: 46, passengerCapacity: 120, description: 'Self-contained passenger service for rural unelectrified lines.' },
  { id: 'commuter-emu', displayName: 'E3 Commuter Unit', role: 'commuter', traction: 'electric', purchasePrice: 150_000, runningCostPerTick: 12, powerKw: 2_000, tractiveEffortN: 240_000, massKg: 110_000, brakeForceN: 230_000, maxSpeedKph: 140, lengthMetres: 66, passengerCapacity: 240, description: 'Quick acceleration and high capacity for frequent urban stops.' },
  { id: 'heavy-diesel', displayName: 'D30 Heavy Freight', role: 'heavy-freight', traction: 'diesel', purchasePrice: 145_000, runningCostPerTick: 28, powerKw: 3_000, tractiveEffortN: 410_000, massKg: 126_000, brakeForceN: 210_000, maxSpeedKph: 110, lengthMetres: 22, passengerCapacity: 0, description: 'Heavy freight over steep unelectrified lines; high fuel cost rewards full loads.' },
];
export const UNPOWERED_VEHICLE_FAMILIES: readonly UnpoweredVehicleFamily[] = [
  { id: 'flatbed', displayName: 'General Flatbed', compatibleProductIds: ['logs', 'structural-timber', 'steel', 'building-modules'], payloadKg: 60_000, volumeLitres: 100_000, passengerCapacity: 0, massKg: 20_000, lengthMetres: 20, maxSpeedKph: 120, purchasePrice: 15_000 },
  { id: 'bulk-hopper', displayName: 'Bulk Hopper', compatibleProductIds: ['limestone-aggregate', 'grain', 'scrap'], payloadKg: 70_000, volumeLitres: 100_000, passengerCapacity: 0, massKg: 24_000, lengthMetres: 16, maxSpeedKph: 100, purchasePrice: 18_000 },
  { id: 'covered-hopper', displayName: 'Covered Cement Hopper', compatibleProductIds: ['cement'], payloadKg: 60_000, volumeLitres: 60_000, passengerCapacity: 0, massKg: 22_000, lengthMetres: 16, maxSpeedKph: 100, purchasePrice: 20_000 },
  { id: 'covered-van', displayName: 'Food and Flour Van', compatibleProductIds: ['flour', 'food'], payloadKg: 40_000, volumeLitres: 80_000, passengerCapacity: 0, massKg: 18_000, lengthMetres: 18, maxSpeedKph: 120, purchasePrice: 17_000 },
  { id: 'passenger-coach', displayName: 'Intercity Coach', compatibleProductIds: [], payloadKg: 0, volumeLitres: 0, passengerCapacity: 64, massKg: 38_000, lengthMetres: 23, maxSpeedKph: 200, purchasePrice: 25_000 },
];
export const getPoweredVehicleFamily = (id: string): PoweredVehicleFamily | undefined => POWERED_VEHICLE_FAMILIES.find(f => f.id === id);
export const getUnpoweredVehicleFamily = (id: string): UnpoweredVehicleFamily | undefined => UNPOWERED_VEHICLE_FAMILIES.find(f => f.id === id);
export function physicsForVehicleFamily(id: string, worldUnitsPerMetre = 10): RailVehicleDefinition | undefined {
  const family = getPoweredVehicleFamily(id);
  if (!family) return undefined;
  const bodyLength = family.lengthMetres * worldUnitsPerMetre;
  return { id: family.id, massKg: family.massKg, bodyLength, wheelbase: bodyLength * 0.65, frontCouplerOffset: bodyLength / 2, rearCouplerOffset: bodyLength / 2, maxTractiveEffortN: family.tractiveEffortN, maxBrakeForceN: family.brakeForceN };
}
export function availableTractiveEffortN(family: PoweredVehicleFamily, speedMps: number): number {
  return Math.min(family.tractiveEffortN, family.powerKw * 1_000 / Math.max(0.5, Math.abs(speedMps)));
}
export function vehicleFamilyRouteBlocker(family: PoweredVehicleFamily, route: { electrified: boolean; shortestPlatformMetres?: number; passengerService: boolean }): string | null {
  if (family.traction === 'electric' && !route.electrified) return 'This electric train needs wires along its entire route.';
  if (route.passengerService && family.passengerCapacity <= 0) return 'This train needs passenger coaches to carry passengers.';
  if (route.passengerService && route.shortestPlatformMetres !== undefined && family.lengthMetres > route.shortestPlatformMetres) return 'Extend the shortest platform or choose a shorter train.';
  return null;
}

export interface ConsistSpecification {
  poweredFamily: PoweredVehicleFamily;
  totalLengthMetres: number;
  massKg: number;
  passengerCapacity: number;
  poweredLengthMetres: number;
  wagonFamilyId: string | null;
  wagonLengthMetres: number;
  couplerGapMetres: number;
  poweredUnits: number;
}

/** The initial fleet models one freight wagon, or the complete DMU/EMU unit. */
export function consistSpecification(train: Pick<TrainDef, 'vehicleFamilyId' | 'freightSetId' | 'cargo'>): ConsistSpecification {
  const family = getPoweredVehicleFamily(train.vehicleFamilyId ?? 'mixed-diesel') ?? getPoweredVehicleFamily('mixed-diesel')!;
  const set = getFreightSet(train.freightSetId);
  const wagonId = family.passengerCapacity > 0 ? null
    : set?.cargoClass === 'bulk' ? 'bulk-hopper'
      : set?.cargoClass === 'covered' ? set.compatibleProductIds.some((id) => id === 'flour' || id === 'food') ? 'covered-van' : 'covered-hopper'
        : 'flatbed';
  const wagon = wagonId ? getUnpoweredVehicleFamily(wagonId) : null;
  const gap = wagon ? 0.8 : 0;
  const payload = train.cargo ? train.cargo.units * (getProduct(train.cargo.productId)?.unitMassKg ?? 0) : 0;
  return { poweredFamily: family, totalLengthMetres: family.lengthMetres + (wagon?.lengthMetres ?? 0) + gap,
    massKg: family.massKg + (wagon?.massKg ?? 0) + payload, passengerCapacity: family.passengerCapacity,
    poweredLengthMetres: family.lengthMetres, wagonFamilyId: wagonId, wagonLengthMetres: wagon?.lengthMetres ?? 0,
    couplerGapMetres: gap, poweredUnits: family.id === 'regional-dmu' ? 2 : family.id === 'commuter-emu' ? 3 : 1 };
}
export const combinedConsistSpecification = consistSpecification;
