import { createEmptyWorld, type TrackDef, type TrainDef } from '../../src/config/WorldData';
import { FleetPresentation, fleetVisualSpecification, interpolateFleetPartPose, liveryColour, POWERED_SILHOUETTES, sampleFleetPartPose, sampleFleetPose, stationWaitingCounts } from '../../src/management/FleetPresentation';
import { consistSpecification, POWERED_VEHICLE_FAMILIES } from '../../src/region/VehicleRoster';
import { capacityForProduct, getFreightSet } from '../../src/freight/FreightSetCatalog';
import { getProduct } from '../../src/economy/ProductCatalog';
import { RailGraph } from '../../src/simulation/RailGraph';
import { fitPassingLoop } from '../../src/management/RailwayTemplates';
import { createManagementState, createServiceRuntimeState } from '../../src/simulation/SimulationTypes';
import { generatePassengerDemand, boardPassengers } from '../../src/region/PassengerSystem';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';

const track = (uuid = 'track', start = 0, end = 2_000): TrackDef => ({ uuid, geometryVersion: 1,
  p0: { x: start, y: 0 }, p1: { x: start + (end - start) / 3, y: 0 }, p2: { x: start + 2 * (end - start) / 3, y: 0 }, p3: { x: end, y: 0 },
  verticalProfile: { profileVersion: 1, knots: [{ t: 0, elevation: 40 }, { t: 1, elevation: 40 }] }, structures: [], paidBuildCost: 0 });
const train = (vehicleFamilyId = 'mixed-diesel'): TrainDef => ({ id: 'train', vehicleFamilyId, freightSetId: 'flatbed-freight-set', trackUUID: 'track', trackT: 0.3, facing: 1, cargo: null,
  dynamics: { mode: 'on-rail', trackUUID: 'track', distance: 600, direction: 1, speedMps: 0, consistId: 'consist', consistOrder: 0 },
  operations: { currentTripRevenue: 0, currentTripRunningCost: 0, lastTripRevenue: 0, lastTripRunningCost: 0, lifetimeDeliveredUnits: 0, lifetimeRevenue: 0, lifetimeRunningCost: 0 } });
const freezeDeep = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); } return value; };

describe('snapshot fleet presentation', () => {
  it('gives all six powered families distinctive silhouettes inside their physical consist extent', () => {
    expect(new Set(Object.values(POWERED_SILHOUETTES)).size).toBe(6);
    for (const family of POWERED_VEHICLE_FAMILIES) {
      const source = freezeDeep(train(family.id));
      const visual = fleetVisualSpecification(source);
      const physical = consistSpecification(source);
      expect(visual.parts[0].silhouette).toBe(POWERED_SILHOUETTES[family.id]);
      expect(Math.max(...visual.parts.map(part => part.offset + part.length / 2))).toBeCloseTo(physical.totalLengthMetres * 5);
      expect(Math.min(...visual.parts.map(part => part.offset - part.length / 2))).toBeCloseTo(-physical.totalLengthMetres * 5);
      expect(visual.parts.filter(part => part.kind === 'wagon')).toHaveLength(family.passengerCapacity > 0 ? 0 : 1);
    }
    expect(fleetVisualSpecification(train('regional-dmu')).parts).toHaveLength(2);
    expect(fleetVisualSpecification(train('commuter-emu')).parts).toHaveLength(3);
    const cars = fleetVisualSpecification(train('commuter-emu')).parts;
    expect(cars[0].offset - cars[0].length / 2).toBeGreaterThan(cars[1].offset + cars[1].length / 2);
  });

  it('uses actual freight compatibility and payload for matching wagons and visible loads', () => {
    const cases = [
      ['flatbed-freight-set', 'logs', 'flatbed'], ['aggregate-hopper-set', 'limestone-aggregate', 'bulk-hopper'],
      ['covered-cement-set', 'cement', 'covered-hopper'], ['grain-hopper-set', 'grain', 'bulk-hopper'],
      ['food-van-set', 'food', 'covered-van'], ['scrap-hopper-set', 'scrap', 'bulk-hopper'],
    ];
    for (const [setId, productId, familyId] of cases) {
      const source = train(); source.freightSetId = setId;
      const capacity = capacityForProduct(getFreightSet(setId)!, getProduct(productId)!);
      if (!capacity.ok) throw new Error('Invalid fixture cargo');
      const units = Math.floor(capacity.capacityUnits / 2);
      source.cargo = { productId, units, loadedUnits: units, originFacilityId: 'source' };
      const wagon = fleetVisualSpecification(freezeDeep(source)).parts.find(part => part.kind === 'wagon')!;
      expect(wagon.wagonFamilyId).toBe(familyId);
      expect(wagon.productId).toBe(productId);
      expect(wagon.loadFraction).toBe(units / capacity.capacityUnits);
    }
    expect(fleetVisualSpecification(train()).parts[1].loadFraction).toBe(0);
  });

  it('resolves the train livery, then company colour, then the default', () => {
    expect(liveryColour({ livery: '#aAcC22' }, '#112233')).toBe(0xaacc22);
    expect(liveryColour({ livery: 'bad' }, '#112233')).toBe(0x112233);
    expect(liveryColour({}, 'invalid')).toBe(0x278d9b);
  });

  it('follows arc distance for bogies on curves and joins, preserving facing in reverse', () => {
    const curve = { ...track(), p0: { x: 0, y: 0 }, p1: { x: 600, y: 0 }, p2: { x: 600, y: 600 }, p3: { x: 1_200, y: 600 } };
    const graph = new RailGraph([curve]);
    const source = train();
    const part = fleetVisualSpecification(source).parts[1];
    const pose = sampleFleetPartPose(graph, source, part)!;
    const index = graph.trackByUUID('track')!.index;
    const expectedFront = index.poseAtDistance(600 + part.offset + part.length * 0.32).point;
    const expectedRear = index.poseAtDistance(600 + part.offset - part.length * 0.32).point;
    expect(pose.frontBogie.x).toBeCloseTo(expectedFront.x);
    expect(pose.rearBogie.y).toBeCloseTo(expectedRear.y);
    expect(pose.angle).toBeCloseTo(Math.atan2(expectedFront.y - expectedRear.y, expectedFront.x - expectedRear.x));
    const joined = new RailGraph([track('track', 0, 1_000), track('second', 1_000, 2_000)]);
    if (source.dynamics.mode !== 'on-rail') throw new Error('Fixture');
    source.dynamics.distance = 950;
    expect(sampleFleetPose(joined, source, 100)).toEqual({ x: 1_050, y: 0, angle: 0 });
    source.dynamics.direction = -1;
    expect(sampleFleetPose(joined, source, -100)!.x).toBeCloseTo(1_050);
    expect(Math.abs(sampleFleetPose(joined, source, -100)!.angle)).toBeCloseTo(Math.PI);
  });

  it('does not invent a branch for a consist reaching an ambiguous turnout', () => {
    const fitted = fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 2_400, y: 0 }, idPrefix: 'loop' });
    if (!fitted.ok) throw new Error('Fixture');
    const graph = new RailGraph(fitted.template.tracks.map(geometry => ({ ...track(), ...geometry })), fitted.template.junctions);
    const source = train();
    if (source.dynamics.mode !== 'on-rail') throw new Error('Fixture');
    source.dynamics.trackUUID = fitted.template.tracks[0].uuid; source.dynamics.distance = 320;
    expect(sampleFleetPose(graph, source, 140)).toBeNull();
    expect(sampleFleetPose(graph, source, 140, [fitted.template.tracks[3].uuid])!.y).toBeGreaterThan(0);
    expect(sampleFleetPose(graph, source, 140, [fitted.template.tracks[1].uuid])!.y).toBeCloseTo(0);
  });

  it('interpolates completed poses through the short angular arc without extrapolating', () => {
    const from = { x: 10, y: 20, angle: Math.PI - 0.1, frontBogie: { x: 20, y: 20, angle: Math.PI - 0.1 }, rearBogie: { x: 0, y: 20, angle: Math.PI - 0.1 } };
    const to = { x: 30, y: 40, angle: -Math.PI + 0.1, frontBogie: { x: 40, y: 40, angle: -Math.PI + 0.1 }, rearBogie: { x: 20, y: 40, angle: -Math.PI + 0.1 } };
    const middle = interpolateFleetPartPose(freezeDeep(from), freezeDeep(to), 0.5);
    expect(middle.x).toBe(20); expect(middle.y).toBe(30); expect(middle.angle).toBeCloseTo(Math.PI);
    expect(middle.frontBogie.x).toBe(30); expect(middle.rearBogie.angle).toBeCloseTo(Math.PI);
    expect(interpolateFleetPartPose(from, to, -1).x).toBe(from.x);
    expect(interpolateFleetPartPose(from, to, 2).x).toBe(to.x);
  });

  it('counts waiting cohorts, excluding people already aboard', () => {
    const management = createManagementState();
    management.passengers = generatePassengerDemand(management.passengers, { tick: 1, intervalSeconds: 60,
      stations: [{ id: 'A', x: 0, y: 0, demandPerMinute: 10 }, { id: 'B', x: 1_000, y: 0, demandPerMinute: 0 }], services: [{ id: 'line', stops: ['A', 'B'] }] });
    management.passengers = boardPassengers(management.passengers, { trainId: 'train', stationId: 'A', serviceId: 'line', remainingStops: ['B'], capacity: 6, tick: 1 }).state;
    const stations = ['A', 'B'].map(id => ({ id, name: id, trackUUID: 'track', trackT: 0.5, passengerSpawnRate: 1 }));
    expect(stationWaitingCounts(freezeDeep({ stations, management }))).toEqual({ A: 4, B: 0 });
  });
});

describe('fleet renderer lifecycle', () => {
  const fakeScene = () => {
    const objects: any[] = [];
    const makeObject = () => {
      const object: any = { destroy: jest.fn() };
      for (const method of ['setDepth', 'setPosition', 'setRotation', 'setVisible', 'setOrigin', 'setScale', 'setText', 'clear', 'fillStyle', 'lineStyle', 'fillRoundedRect', 'fillRect', 'strokeRoundedRect', 'strokeRect', 'lineBetween', 'fillCircle', 'strokeCircle', 'on']) object[method] = jest.fn(() => object);
      object.setInteractive = jest.fn((config: unknown) => { object.input = config; return object; });
      objects.push(object); return object;
    };
    return { scene: { add: { graphics: makeObject, text: makeObject }, cameras: { main: { zoom: 1 } } } as any, objects };
  };

  it('reads frozen snapshots, preserves cab/physics/interaction state, and restores original bodies on destroy', () => {
    const world = createEmptyWorld('Presentation', 'presentation', 'temperate', makeStarterOpportunity());
    world.tracks = [track()]; world.trains = [train()]; world.management = createManagementState();
    world.stations = [{ id: 'station', name: 'Market', trackUUID: 'track', trackT: 0.8, passengerSpawnRate: 1 }];
    world.management.services = [{ id: 'service', name: 'Service', trainId: 'train', kind: 'passenger', stops: [{ targetId: 'station', targetKind: 'station', loadRule: 'available', maxWaitSeconds: 10 }], frequencySeconds: 0, departureOffsetSeconds: 0, priority: 1, enabled: true }];
    world.management.serviceStates.service = createServiceRuntimeState();
    const body: any = { alpha: 0.8, visible: true, input: { enabled: true }, body: { label: 'train', velocity: { x: 1, y: 0 } } };
    body.setAlpha = jest.fn((alpha: number) => { body.alpha = alpha; return body; });
    const originalPhysics = JSON.stringify(body.body);
    const { scene, objects } = fakeScene();
    const routes = jest.spyOn(RailGraph.prototype, 'shortestRoute');
    const renderer = new FleetPresentation(scene, { trains: [{ getUUID: () => 'train', getMatterBody: () => body, selected: true }] });
    const originalWorld = JSON.stringify(world);
    renderer.update(freezeDeep(world), 0); renderer.update(world, 1_000);
    expect(JSON.stringify(world)).toBe(originalWorld);
    expect(JSON.stringify(body.body)).toBe(originalPhysics);
    expect(body.input.enabled).toBe(true); expect(body.visible).toBe(true); expect(body.alpha).toBe(0.001);
    expect(routes).not.toHaveBeenCalled();
    expect(objects.some(object => object.setText.mock.calls.some((args: unknown[]) => args[0] === '0 waiting'))).toBe(true);
    renderer.destroy(); renderer.destroy();
    expect(body.alpha).toBe(0.8);
    expect(objects.every(object => object.destroy.mock.calls.length === 1)).toBe(true);
    routes.mockRestore();
  });

  it('uses a selected operational detour without running an independent route planner', () => {
    const fitted = fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 2_400, y: 0 }, idPrefix: 'loop' });
    if (!fitted.ok) throw new Error('Fixture');
    const world = createEmptyWorld('Presentation', 'presentation', 'temperate', makeStarterOpportunity());
    world.tracks = fitted.template.tracks.map(geometry => ({ ...track(), ...geometry })); world.junctions = fitted.template.junctions;
    const source = train('diesel-shunter');
    if (source.dynamics.mode !== 'on-rail') throw new Error('Fixture');
    source.dynamics.trackUUID = world.tracks[0].uuid; source.dynamics.distance = 320;
    world.trains = [source];
    const { scene, objects } = fakeScene();
    const renderer = new FleetPresentation(scene, { trains: [] });
    const routes = jest.spyOn(RailGraph.prototype, 'shortestRoute');
    renderer.update(freezeDeep(world), 0, freezeDeep({ train: [world.tracks[0].uuid, world.tracks[3].uuid, world.tracks[4].uuid] }));
    expect(objects.some(object => object.setPosition.mock.calls.some((args: number[]) => args[1] > 0))).toBe(true);
    expect(routes).not.toHaveBeenCalled();
    renderer.destroy(); routes.mockRestore();
  });

  it('forwards wagon selection and smoothly catches up to completed snapshots only', () => {
    const world = createEmptyWorld('Presentation', 'presentation', 'temperate', makeStarterOpportunity());
    world.tracks = [track()]; world.trains = [train()];
    const { scene, objects } = fakeScene();
    const selectTrain = jest.fn();
    const renderer = new FleetPresentation(scene, { trains: [], selectTrain });
    renderer.update(freezeDeep(world), 0);
    const clickable = objects.filter(object => object.on.mock.calls.length > 0);
    expect(clickable).toHaveLength(2);
    const wagon = clickable[1];
    expect(wagon.input.hitAreaCallback(wagon.input.hitArea, 0, 0)).toBe(true);
    expect(wagon.input.hitAreaCallback(wagon.input.hitArea, 5_000, 0)).toBe(false);
    const handler = wagon.on.mock.calls[0][1];
    const event = { stopPropagation: jest.fn() };
    handler({ button: 2 }, 0, 0, event); expect(selectTrain).not.toHaveBeenCalled();
    handler({ button: 0 }, 0, 0, event); expect(selectTrain).toHaveBeenCalledWith('train'); expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    const firstX = clickable[0].setPosition.mock.calls.at(-1)[0];
    const next = JSON.parse(JSON.stringify(world)); next.trains[0].dynamics.distance += 100;
    renderer.update(freezeDeep(next), 50);
    expect(clickable[0].setPosition.mock.calls.at(-1)[0]).toBeCloseTo(firstX);
    renderer.update(next, 75);
    expect(clickable[0].setPosition.mock.calls.at(-1)[0]).toBeCloseTo(firstX + 50);
    renderer.update(next, 150);
    expect(clickable[0].setPosition.mock.calls.at(-1)[0]).toBeCloseTo(firstX + 100);
    renderer.destroy();
  });
});
