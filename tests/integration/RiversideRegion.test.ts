import { createRiversideRegion, createRiversideReliefDraft, riversideHeight, riverCentre } from '../../src/region/RiversideRegion';
import { validateWorldData } from '../../src/config/WorldData';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import { SaveRepository } from '../../src/persistence/SaveRepository';
import { MemoryStorage } from '../../src/persistence/StoragePort';
import { quoteBlueprint, applyBlueprintPurchase } from '../../src/management/BlueprintService';

describe('authored Brookford region',()=>{
  it('runs both real services, exposes shared-track pressure and persists earned development',async()=>{
    const world=createRiversideRegion();
    expect(validateWorldData(world).compatible).toBe(true);
    const session=new SimulationSession(world);
    session.setSpeed(1);
    let observedSharedTrackWait=false;
    for(let step=0;step<12000;step++){
      session.advance(50);
      if(step%20===0)observedSharedTrackWait ||=session.rehearsalProgress().some(state=>state.stoppedReason?.code==='track-occupied');
    }
    const deliveries=session.drainEvents().filter(event=>event.type==='freight-delivery'||event.type==='passenger-delivery');
    const after=session.snapshot();
    const states=Object.values(after.management.serviceStates);
    const revenueByTrain=Object.fromEntries(after.trains.map(train=>[train.id,
      deliveries.reduce((sum,event)=>sum+((event.type==='freight-delivery'||event.type==='passenger-delivery')&&event.trainId===train.id?event.revenue:0),0)]));
    const housing=after.region.projects.find(project=>project.definitionId==='housing')!;
    if(Object.values(revenueByTrain).some(revenue=>revenue<=0)||states.some(state=>state.completedCycles<=0)||!observedSharedTrackWait||housing.completedAtTick===null||housing.completedAtTick>600){
      console.info('Brookford service diagnostics',JSON.stringify({clockSeconds:after.management.clockSeconds,
        revenueByTrain,observedSharedTrackWait,serviceStates:after.management.serviceStates,trains:session.getTrainSnapshots(),
        passengerState:after.management.passengers,housing,deliveries},null,2));
    }
    for(const service of after.management.services){
      expect(revenueByTrain[service.trainId]).toBeGreaterThan(0);
      expect(after.management.serviceStates[service.id].completedCycles).toBeGreaterThan(0);
    }
    // Passenger fares belong to the passenger state and company ledger, while freight updates train operations.
    expect(after.management.passengers.revenue).toBe(revenueByTrain['brookford-passenger']);
    expect(after.company.ledger.filter(entry=>entry.category==='delivery-revenue'&&entry.referenceId.startsWith('passengers:valley-local:'))
      .reduce((sum,entry)=>sum+entry.amount,0)).toBe(revenueByTrain['brookford-passenger']);
    expect(after.trains.find(train=>train.id==='brookford-freight')!.operations.lifetimeRevenue).toBe(revenueByTrain['brookford-freight']);
    expect(observedSharedTrackWait).toBe(true);
    expect(states.some(s=>s.delaySeconds>0)).toBe(true);
    expect(housing.completedAtTick).not.toBeNull();
    expect(housing.completedAtTick).toBeLessThanOrEqual(600);
    expect(after.region.passengerDemandBonusBps).toBe(2500);
    expect(validateWorldData(after).compatible).toBe(true);
    const storage=new MemoryStorage(),repository=new SaveRepository(storage);
    await repository.save(after);await repository.flush();
    expect((await new SaveRepository(storage).load(after.id)).world).toEqual(after);
  });
  it('uses real water and a flat buildable railway corridor',()=>{
    for(const x of [500,2000,3800,5700]){
      expect(riversideHeight(x,riverCentre(x))).toBeLessThan(0);
      expect(riversideHeight(x,2000)).toBe(18);
    }
  });
  it('purchases a northern relief line once and reduces real service waiting',()=>{
    const world=createRiversideRegion(),draft=createRiversideReliefDraft(world),before=JSON.stringify(world);
    const quote=quoteBlueprint(world,draft,{getHeightAt:riversideHeight});
    expect(quote.errors).toEqual([]);
    expect(quote.valid).toBe(true);
    expect(JSON.stringify(world)).toBe(before);
    expect(quote.totalCost).toBeGreaterThan(0);
    const cashBefore=world.company.cash;
    expect(applyBlueprintPurchase(world,quote)).toBe(true);
    expect(world.company.cash).toBe(cashBefore-quote.totalCost);
    expect(world.company.ledger.at(-1)).toMatchObject({category:'construction-capex',amount:-quote.totalCost,referenceId:`blueprint:${draft.id}`});
    const purchased=JSON.stringify(world);
    expect(applyBlueprintPurchase(world,quote)).toBe(false);
    expect(JSON.stringify(world)).toBe(purchased);
    expect(validateWorldData(world).compatible).toBe(true);
    const reliefIds=new Set(draft.tracks.map(track=>track.uuid));
    const simulate=(initial:ReturnType<typeof createRiversideRegion>)=>{
      const session=new SimulationSession(initial);session.setSpeed(1);
      const usedReliefBy=new Set<string>(),usedMainBy=new Set<string>();let simultaneousMovement=false;
      for(let step=0;step<12000;step++){
        const result=session.advance(50);
        for(const train of result.trains){
          if(reliefIds.has(train.trackUUID))usedReliefBy.add(train.trainId);
          if(train.trackUUID==='river-single')usedMainBy.add(train.trainId);
        }
        if(result.trains.every(train=>train.speedMps>1))simultaneousMovement=true;
      }
      const after=session.snapshot();
      return {after,usedReliefBy,usedMainBy,simultaneousMovement,waiting: Object.values(after.management.serviceStates).reduce((sum,state)=>sum+state.delaySeconds,0)};
    };
    const base=simulate(createRiversideRegion()),relieved=simulate(world);
    if(relieved.waiting>=base.waiting||!relieved.usedReliefBy.has('brookford-passenger')){
      console.info('Brookford relief comparison',JSON.stringify({baseWaiting:base.waiting,relievedWaiting:relieved.waiting,
        usedReliefBy:[...relieved.usedReliefBy],serviceStates:relieved.after.management.serviceStates},null,2));
    }
    expect(relieved.usedReliefBy.has('brookford-passenger')).toBe(true);
    expect(relieved.usedMainBy.has('brookford-freight')).toBe(true);
    expect(relieved.simultaneousMovement).toBe(true);
    expect(relieved.waiting).toBeLessThan(base.waiting);
    for(const service of relieved.after.management.services){
      expect(relieved.after.management.serviceStates[service.id].completedCycles).toBeGreaterThan(0);
      expect(relieved.after.management.serviceStates[service.id].delaySeconds).toBeLessThan(base.after.management.serviceStates[service.id].delaySeconds);
    }
    expect(relieved.after.trains.find(train=>train.id==='brookford-freight')!.operations.lifetimeRevenue).toBeGreaterThan(0);
    expect(relieved.after.management.passengers.revenue).toBeGreaterThan(0);
    expect(relieved.after.region.projects.find(project=>project.definitionId==='housing')!.completedAtTick).not.toBeNull();
    expect(relieved.after.region.projects.find(project=>project.definitionId==='housing')!.completedAtTick).toBeLessThanOrEqual(600);
  });
});
