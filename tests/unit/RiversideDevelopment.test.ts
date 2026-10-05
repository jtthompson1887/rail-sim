import { riversideHousingSite } from '../../src/presentation/RiversideDevelopment';
import { createRiversideRegion, riversideHeight } from '../../src/region/RiversideRegion';
import { footprintIsClear } from '../../src/region/RegionalProjects';
import { clonePlainData } from '../../src/utils/PlainData';

it('places earned homes beyond the existing town and connects them without covering track or water', () => {
  const world = createRiversideRegion();
  expect(riversideHousingSite(world, [], riversideHeight)).toBeNull();
  world.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 505;
  const before = JSON.stringify(world), site = riversideHousingSite(world, [], riversideHeight)!;
  expect(site).toMatchObject({x:6400,y:1940,buildingCount:9});
  expect(site.x - site.radius).toBeGreaterThan(6000); // Easternmost authored road.
  expect(footprintIsClear(site, world.tracks)).toBe(true);
  expect(riversideHeight(site.x, site.y + site.radius)).toBeGreaterThan(0);
  expect(JSON.stringify(world)).toBe(before);
});

it('respects both reserved drafts and built railway, and rejects submerged sites', () => {
  const world = createRiversideRegion();
  world.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 505;
  const reserved = clonePlainData(world.tracks[0]);reserved.uuid='reserved-housing-track';
  reserved.p0={x:6380,y:1820};reserved.p1={x:6390,y:1820};reserved.p2={x:6410,y:1820};reserved.p3={x:6420,y:1820};
  expect(riversideHousingSite(world,[reserved],riversideHeight)?.x).toBe(6780);
  world.tracks.push(reserved);
  expect(riversideHousingSite(world,[],riversideHeight)?.x).toBe(6780);
  expect(riversideHousingSite(world,[],()=>-18)).toBeNull();
});

it('protects the illustrated parcel corners as well as its centre', () => {
  const world = createRiversideRegion();
  world.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 505;
  const corner = clonePlainData(world.tracks[0]);corner.uuid='corner-track';
  corner.p0={x:6550,y:2096};corner.p1={x:6551,y:2096};corner.p2={x:6553,y:2096};corner.p3={x:6554,y:2096};
  expect(riversideHousingSite(world,[corner],riversideHeight)?.x).toBe(6780);
});
