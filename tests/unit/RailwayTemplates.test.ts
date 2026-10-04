import { fitPassingLoop } from '../../src/management/RailwayTemplates';
import { applyBlueprintPurchase, quoteBlueprint, sketchPassingLoop } from '../../src/management/BlueprintService';
import { createEmptyWorld } from '../../src/config/WorldData';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { isValidClearanceTurnout, hasConstructionClearance, type ClearanceTrack } from '../../src/systems/TrackClearance';
import { sampleConstructionCurve } from '../../src/systems/ConstructionCurveSampler';
import { RailGraph } from '../../src/simulation/RailGraph';

const terrain = { getHeightAt: () => 40 };
const world = () => createEmptyWorld('Loop test', 'loop', 'temperate', makeStarterOpportunity());
const template = () => {
  const result = fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 2_400, y: 0 }, idPrefix: 'test-loop' });
  if (!result.ok) throw new Error('Expected fitted loop');
  return result.template;
};
const sampled = (tracks: ReturnType<typeof template>['tracks']): ClearanceTrack[] => tracks.map(track => {
  const profile = sampleConstructionCurve(track);
  if (!profile.ok) throw new Error('Expected usable curve');
  return { trackUUID: track.uuid, geometry: track, curveSamples: profile.samples };
});

describe('fitted passing loop', () => {
  it('fits six smooth sections and two real endpoint turnouts with useful standing space', () => {
    const loop = template();
    expect(loop.tracks).toHaveLength(6);
    expect(loop.junctions).toHaveLength(2);
    expect(loop.clearStandingLength).toBe(680);
    for (const track of loop.tracks) expect(new ConstructionAnalyzer(terrain).analyze(track).valid).toBe(true);
    const tracks = sampled(loop.tracks);
    for (const junction of loop.junctions) expect(isValidClearanceTurnout({ junction, tracks })).toBe(true);
  });
  it('fits rotated and mirrored endpoints without relying on screen axes', () => {
    const result = fitPassingLoop({ start: { x: 300, y: -1_000 }, end: { x: 300, y: 1_400 }, tangentAngleRad: Math.PI / 2, side: -1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.tracks[0].p0).toEqual({ x: 300, y: -1_000 });
    expect(result.template.tracks[2].p3).toEqual({ x: 300, y: 1_400 });
    expect(result.template.tracks[4].p0.x).toBeGreaterThan(300);
    expect(fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 500, y: 0 } }).ok).toBe(false);
    expect(fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 2_400, y: 0 }, tangentAngleRad: Math.PI / 2 }).ok).toBe(false);
  });
  it('quotes and commits geometry, junctions and the exact ledger debit atomically', () => {
    const current = world();
    const result = sketchPassingLoop(current, terrain, { x: 0, y: 0 }, { x: 2_400, y: 0 });
    if (!result.ok) throw new Error('Expected sketch');
    const before = JSON.stringify(current);
    const quote = quoteBlueprint(current, result.draft, terrain);
    expect(quote.errors).toEqual([]);
    expect(JSON.stringify(current)).toBe(before);
    expect(quote.totalCost).toBe(quote.draft.tracks.reduce((sum, track) => sum + track.paidBuildCost, 0));
    const cashBefore = current.company.cash;
    expect(applyBlueprintPurchase(current, quote)).toBe(true);
    expect(current.tracks).toHaveLength(6);
    expect(current.junctions).toHaveLength(2);
    expect(cashBefore - current.company.cash).toBe(quote.totalCost);
    expect(applyBlueprintPurchase(current, quote)).toBe(false);
    const graph = new RailGraph(current.tracks, current.junctions);
    const route = graph.shortestRoute({ trackUUID: current.tracks[0].uuid, distance: 0 }, { trackUUID: current.tracks[2].uuid, distance: 300 });
    expect(route).not.toBeNull();
    expect(route!.junctionIds).toEqual(current.junctions.map(junction => junction.uuid));
  });
  it('rejects the same geometry without legitimate turnout declarations', () => {
    const current = world();
    const result = sketchPassingLoop(current, terrain, { x: 0, y: 0 }, { x: 2_400, y: 0 });
    if (!result.ok) throw new Error('Expected sketch');
    result.draft.junctions = [];
    expect(quoteBlueprint(current, result.draft, terrain).valid).toBe(false);
  });
  it('does not use the exemption for unrelated rails or duplicate/overlapping branches', () => {
    const loop = template();
    const tracks = sampled(loop.tracks);
    const turnout = { junction: loop.junctions[0], tracks };
    const candidate = tracks[3];
    const unrelated = { ...tracks[1], trackUUID: 'unrelated' };
    expect(hasConstructionClearance({ ...candidate, geometry: candidate.geometry }, [unrelated], [], [turnout])).toBe(false);
    const duplicate = tracks.map(track => track.trackUUID === turnout.junction.leftTrackUUID ? { ...tracks[1], trackUUID: track.trackUUID } : track);
    expect(isValidClearanceTurnout({ junction: turnout.junction, tracks: duplicate })).toBe(false);
    expect(isValidClearanceTurnout({ junction: { ...turnout.junction, mainTrackUUID: 'missing' }, tracks })).toBe(false);
    expect(isValidClearanceTurnout({ junction: { ...turnout.junction, position: 0.5 }, tracks })).toBe(false);
  });
  it('does not extend turnout permission to later crossings outside the bounded throat', () => {
    const loop = template();
    const returning = { ...loop.tracks[3], p0: { x: 360, y: 0 }, p1: { x: 527, y: 0 }, p2: { x: 693, y: 144 }, p3: { x: 860, y: 0 } };
    const tracks = sampled(loop.tracks.map(track => track.uuid === returning.uuid ? returning : track));
    const turnout = { junction: loop.junctions[0], tracks };
    const candidate = tracks[3];
    expect(isValidClearanceTurnout(turnout)).toBe(true);
    expect(hasConstructionClearance(candidate, [tracks[1]], [], [turnout])).toBe(false);
  });
  it('cannot lend a valid turnout identity to different overlapping geometry', () => {
    const loop = template();
    const tracks = sampled(loop.tracks);
    const candidate = { ...tracks[1], trackUUID: tracks[3].trackUUID };
    expect(hasConstructionClearance(candidate, [tracks[1]], [], [{ junction: loop.junctions[0], tracks }])).toBe(false);
  });
  it('rejects tampered quotes and a changed live railway without charging cash', () => {
    const current = world();
    const result = sketchPassingLoop(current, terrain, { x: 0, y: 0 }, { x: 2_400, y: 0 });
    if (!result.ok) throw new Error('Expected sketch');
    const quote = quoteBlueprint(current, result.draft, terrain);
    quote.draft.junctions[0].leftTrackUUID = 'forged';
    expect(applyBlueprintPurchase(current, quote)).toBe(false);
    expect(current.company.cash).toBe(1_000_000);
    const second = quoteBlueprint(current, result.draft, terrain);
    current.revision++;
    expect(applyBlueprintPurchase(current, second)).toBe(false);
    expect(current.tracks).toEqual([]);
  });
});
