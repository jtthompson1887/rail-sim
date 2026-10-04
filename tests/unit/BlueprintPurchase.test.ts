import { createEmptyWorld, validateWorldData } from '../../src/config/WorldData';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import { emptyBlueprint, quoteBlueprint, applyBlueprintPurchase, sketchConnection } from '../../src/management/BlueprintService';
import { createFleetProposal, createPlatformProposal } from '../../src/management/RailwayPurchases';
import { createManagementState } from '../../src/simulation/SimulationTypes';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import { clonePlainData } from '../../src/utils/PlainData';

const terrain={getHeightAt:()=>20};
const base=()=>{const w=createEmptyWorld('Plans','blueprint-tests','temperate',makeStarterOpportunity());w.company=createCompanyState(1_000_000);w.management=createManagementState();w.management.speed=0;return w;};
describe('reviewed mixed railway blueprints',()=>{
  it('prices proposed electrification rather than granting imported wires for free',()=>{
    const world=base(),draft=sketchConnection(world,terrain,{x:0,y:0},{x:3000,y:0});
    const plain=quoteBlueprint(world,draft,terrain);draft.tracks[0].electrified=true;
    const wired=quoteBlueprint(world,draft,terrain);
    expect(wired.errors).toEqual([]);expect(wired.totalCost-plain.totalCost).toBe(9_000);
    expect(applyBlueprintPurchase(world,wired)).toBe(true);
    expect(world.tracks[0].electrified).toBe(true);
    expect(world.company.cash).toBe(1_000_000-wired.totalCost);
  });
  it('quotes track, platforms, a passenger unit and service together; commit debits once in traceable categories',()=>{
    const world=base(),source=clonePlainData(world),draft=sketchConnection(world,terrain,{x:0,y:0},{x:6000,y:0});
    const proposed=clonePlainData(world);proposed.tracks.push(...draft.tracks);
    const a=createPlatformProposal(proposed,'West',draft.tracks[0].uuid,.3,120),b=createPlatformProposal(proposed,'East',draft.tracks[0].uuid,.7,120);
    proposed.stations.push(a.station,b.station);draft.stations.push(a.station,b.station);
    const fleet=createFleetProposal(proposed,'regional-dmu','flatbed-freight-set',draft.tracks[0].uuid,.5);draft.trains.push(fleet.train);
    draft.services.push({id:'commuter',name:'Commuter',trainId:fleet.train.id,kind:'passenger',stops:[a.station,b.station].map(s=>({targetId:s.id,targetKind:'station',loadRule:'none',maxWaitSeconds:15})),frequencySeconds:0,departureOffsetSeconds:0,priority:1,enabled:true});
    const q=quoteBlueprint(world,draft,terrain);expect(q.errors).toEqual([]);expect(world).toEqual(source);
    expect(q.totalCost).toBe(q.draft.tracks[0].paidBuildCost+a.price+b.price+fleet.price);
    expect(applyBlueprintPurchase(world,q)).toBe(true);expect(validateWorldData(world).compatible).toBe(true);
    expect(world.company.cash).toBe(source.company.cash-q.totalCost);expect(world.company.ledger.slice(1).map(e=>e.category)).toEqual(['construction-capex','vehicle-capex']);
    expect(world.management.services[0].id).toBe('commuter');expect(applyBlueprintPurchase(world,q)).toBe(false);
    const session=new SimulationSession(world);session.setSpeed(4);for(let i=0;i<400;i++)session.advance(250);
    expect(session.snapshot().management.serviceStates.commuter.completedCycles).toBeGreaterThan(0);expect(validateWorldData(session.snapshot()).compatible).toBe(true);
  });
  it('rejects a changed world or changed quote before changing money or infrastructure',()=>{
    const w=base(),d=sketchConnection(w,terrain,{x:0,y:0},{x:3000,y:0}),q=quoteBlueprint(w,d,terrain);w.revision++;w.operationsRevision++;
    const before=clonePlainData(w);expect(applyBlueprintPurchase(w,q)).toBe(false);expect(w).toEqual(before);
    const fresh=quoteBlueprint(w,d,terrain);fresh.totalCost=0;expect(applyBlueprintPurchase(w,fresh)).toBe(false);expect(w).toEqual(before);
  });
  it('keeps invalid electrical compatibility and train/platform placement out of a quote',()=>{
    const w=base(),d=sketchConnection(w,terrain,{x:0,y:0},{x:3000,y:0}),p={...w,tracks:d.tracks};
    expect(()=>createFleetProposal(p,'electric-freight','flatbed-freight-set',d.tracks[0].uuid,.5)).toThrow('Electrify');
    expect(()=>createPlatformProposal(p,'Too close',d.tracks[0].uuid,.01,120)).toThrow('track ends');
    expect(()=>createFleetProposal(p,'regional-dmu','flatbed-freight-set',d.tracks[0].uuid,.01)).toThrow('whole consist');
    const invalid=emptyBlueprint(w);invalid.removedTrackIds=['occupied'];expect(quoteBlueprint(w,invalid,terrain).valid).toBe(false);
  });
});
