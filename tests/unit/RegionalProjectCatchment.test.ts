import type { TrackDef, WorldData } from '../../src/config/WorldData';
import { clonePlainData } from '../../src/utils/PlainData';
import { acceptProject, applyRegionEvent, connectProjectStation, createRegionState,
  isProjectStationEligible, projectStationPoint, REGIONAL_PROJECT_CATCHMENT_RADIUS } from '../../src/region/RegionalProjects';

const track: TrackDef = {
  uuid: 'platform-rail', geometryVersion: 1,
  p0: { x: 0, y: 0 }, p1: { x: 800, y: 0 }, p2: { x: 1600, y: 0 }, p3: { x: 2400, y: 0 },
  verticalProfile: { profileVersion: 1, knots: [{ t: 0, elevation: 40 }, { t: 1, elevation: 40 }] },
  structures: [], paidBuildCost: 0,
};
const stationWorld = (): Pick<WorldData, 'tracks' | 'stations'> => ({ tracks: [clonePlainData(track)], stations: [
  { id: 'platform', name: 'Local station', trackUUID: track.uuid, trackT: 0.5, passengerSpawnRate: 8 },
] });
const housingRegion = () => acceptProject(createRegionState({ economy: {
  facilities: [{ id: 'town', definitionId: 'town-construction-market', x: 0, y: 0 }],
} } as Pick<WorldData, 'economy'>), 'housing');

describe('regional project station catchments', () => {
  it('uses the actual curved platform point rather than a track endpoint or platform fraction as distance', () => {
    const world = stationWorld();
    world.tracks[0] = { ...track, p1: { x: 800, y: 1600 }, p2: { x: 1600, y: 1600 } };
    const point = projectStationPoint(world, 'platform')!;
    expect(point.x).toBeCloseTo(1200, 5);
    expect(point.y).toBeCloseTo(1200, 5);
    expect(isProjectStationEligible({ x: 1200, y: 1200 }, world, 'platform')).toBe(true);
    expect(isProjectStationEligible({ x: 0, y: 0 }, world, 'platform')).toBe(false);
  });

  it('includes the catchment boundary and rejects a station just beyond it', () => {
    const world = stationWorld();
    expect(REGIONAL_PROJECT_CATCHMENT_RADIUS).toBe(1200);
    expect(isProjectStationEligible({ x: 0, y: 0 }, world, 'platform')).toBe(true);
    world.stations[0].trackT += 0.00001;
    expect(isProjectStationEligible({ x: 0, y: 0 }, world, 'platform')).toBe(false);
    expect(isProjectStationEligible({ x: NaN, y: 0 }, world, 'platform')).toBe(false);
  });

  it('rejects missing or removed stations and unlocatable platform geometry without throwing', () => {
    const world = stationWorld();
    expect(projectStationPoint(world, 'missing')).toBeNull();
    expect(projectStationPoint({ ...world, stations: [] }, 'platform')).toBeNull();
    expect(projectStationPoint({ ...world, tracks: [] }, 'platform')).toBeNull();
    for (const trackT of [-0.01, 1.01, NaN, Infinity]) {
      expect(projectStationPoint({ ...world, stations: [{ ...world.stations[0], trackT }] }, 'platform')).toBeNull();
    }
    world.tracks[0].p1.x = NaN;
    expect(projectStationPoint(world, 'platform')).toBeNull();
    expect(isProjectStationEligible({ x: 0, y: 0 }, world, 'platform')).toBe(false);
    world.tracks[0] = { ...track, p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    expect(projectStationPoint(world, 'platform')).toBeNull();
  });

  it.each([null, 'platform'])('requires finite local arrival coordinates with binding %s', (binding) => {
    const region = connectProjectStation(housingRegion(), 'housing', binding);
    const event = { id: 'arrivals', kind: 'passenger-arrival' as const, tick: 3, stationId: 'platform', passengers: 60 };
    for (const coordinates of [{}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 1200.01, y: 0 }]) {
      const result = applyRegionEvent(region, { ...event, ...coordinates });
      expect(result.state.projects[0].progress.residents).toBe(0);
      expect(result.outcomes).toEqual([]);
    }
    const local = applyRegionEvent(region, { ...event, x: 1200, y: 0 });
    expect(local.state.projects[0].progress.residents).toBe(60);
    expect(region.projects[0].progress.residents).toBe(0);
    if (binding) expect(applyRegionEvent(region, { ...event, stationId: 'other-local-station', x: 0, y: 0 }).state.projects[0].progress.residents).toBe(0);
  });
});
