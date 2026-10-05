import Phaser from 'phaser';
import { WorldManager } from '../managers/WorldManager';
import type { TrainManager } from '../managers/TrainManager';
import type { WorldContentLoader } from '../services/WorldContentLoader';
import type { TerrainGenerator } from '../systems/TerrainGenerator';
import { SimulationSession } from '../simulation/SimulationSession';
import { createManagementState, type BlueprintDraft, type ServiceDefinition, type SimulationSpeed } from '../simulation/SimulationTypes';
import type { TrainRuntimeSnapshot } from '../freight/TrainRuntime';
import type { WorldData } from '../config/WorldData';
import type { ConstructionPreviewModel } from '../ui/ConstructionPreviewOverlay';
import { ManagementPanel } from '../ui/ManagementPanel';
import { emptyBlueprint, sketchConnection, sketchPassingLoop, transformBlueprint, quoteBlueprint, applyBlueprintPurchase } from './BlueprintService';
import { createFleetProposal, createPlatformProposal, debitPurchase } from './RailwayPurchases';
import { RehearsalClient } from './RehearsalClient';
import { createRegionState, acceptProject, connectProjectStation, resolveTransformationFootprints, projectStationPoint, isProjectStationEligible, REGIONAL_PROJECT_CATCHMENT_RADIUS, type RegionalProjectKind } from '../region/RegionalProjects';
import { generateSecondaryFacilities } from '../region/SecondaryFacilities';
import { LAUNCH_PRODUCTS } from '../economy/InitialEconomyContent';
import { SaveService } from '../services/SaveService';
import { installAppLifecycle } from '../platform/AppLifecycle';
import { clonePlainData } from '../utils/PlainData';
import { EventBus } from '../services/EventBus';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { FleetPresentation } from './FleetPresentation';
import { isRiverside, createRiversideReliefDraft } from '../region/RiversideRegion';
import { drawNeighbourhood } from '../presentation/NeighbourhoodArt';

export interface RailwayScenePort {
  scene: Phaser.Scene;
  terrain: TerrainGenerator;
  trains: TrainManager;
  content: WorldContentLoader;
  preview(): ConstructionPreviewModel | null;
  save(): Promise<boolean>;
  refreshFacilities(): void;
}

/** Presentation bridge: domain changes install through a revision-checked WorldManager transaction. */
export class RailwayController {
  private session: SimulationSession | null = null;
  private appliedRevision = -1;
  private readonly client = new RehearsalClient();
  readonly panel: ManagementPanel;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly fleet: FleetPresentation;
  private draft: BlueprintDraft | null = null;
  private ghost: Awaited<ReturnType<RehearsalClient['run']>> | null = null;
  private ghostTime = 0;
  private visualKey = '';
  private removeLifecycle: (()=>void) | null = null;
  private destroyed = false;
  private readonly legacyFixture = typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
    && __RAIL_SIM_TEST_CONTROLS__
    && new URL(window.location.href).searchParams.get('legacyAcceptanceFixture') === '1';
  private readonly closeHandler=()=>this.speed(0);
  private readonly pausePanelHandler=({visible}:{visible:boolean})=>this.setVisible(!visible);

  constructor(private readonly port: RailwayScenePort) {
    this.graphics=port.scene.add.graphics().setDepth(15);
    this.fleet=new FleetPresentation(port.scene,port.trains);
    this.panel=new ManagementPanel({
      world:()=>WorldManager.world,enable:()=>this.enable(),speed:s=>this.speed(s),service:s=>this.service(s),removeService:id=>this.removeService(id),
      acceptProject:(id,station)=>this.project(id,station),buyTrain:(family,set,track,t)=>this.buy(family,set,track,t),station:(name,track,t,len)=>this.station(name,track,t,len),
      electrify:id=>this.electrify(id),captureDraft:()=>this.captureDraft(),sketch:(a,b,bend)=>this.sketch(a,b,bend),
      passingLoop:(a,b,side)=>{const w=WorldManager.world!;if(isRiverside(w))return createRiversideReliefDraft(w);const from=w.economy.facilities.find(f=>f.id===a),to=w.economy.facilities.find(f=>f.id===b);if(!from||!to||a===b)throw new Error('Choose two different access points.');const fit=sketchPassingLoop(w,port.terrain,from.railAccess,to.railAccess,side);if(fit.ok===false)throw new Error(fit.message);return fit.draft;},
      draftStation:(d,name,track,t,len)=>{const proposed=this.draftWorld(d);const added=createPlatformProposal(proposed,name,track,t,len);const next=clonePlainData(d);next.stations.push(added.station);return next;},
      draftTrain:(d,family,set,track,t)=>{const added=createFleetProposal(this.draftWorld(d),family,set,track,t);const next=clonePlainData(d);next.trains.push(added.train);return next;},
      draftService:(d,service)=>{const proposed=this.draftWorld(d),session=new SimulationSession(proposed);for(const existing of d.services)session.upsertService(existing);const added=session.upsertService(service);if(!added.ok)throw new Error(added.errors[0]);const next=clonePlainData(d);next.services.push(service);return next;},
      transform:(d,a,x,y)=>transformBlueprint(d,a,x,y),
      quote:d=>{const q=quoteBlueprint(WorldManager.world!,d,port.terrain);return{cost:q.totalCost,errors:q.errors,details:`${d.tracks.length} tracks · ${d.stations.length} platforms · ${d.trains.length} trains · ${q.draft.tracks.flatMap(t=>t.structures).filter(s=>s.type==='bridge').length} bridge spans`};},
      saveDraft:d=>this.saveDraft(d),commit:d=>this.commit(d),rehearse:d=>this.rehearse(d),cancelRehearsal:()=>this.client.cancel(),showDraft:d=>{this.draft=d;this.visualKey='';},focus:id=>this.focus(id),save:()=>port.save(),
      exportWorld:async()=>{await port.save();return SaveService.exportWorld(WorldManager.world!);},
      importWorld:async text=>{const imported=SaveService.importWorld(text);if(!imported)return 'Import failed. The current world is unchanged.';await SaveService.flush();return 'Imported '+imported.name+'. Open it from the world picker.';},
      style:(name,colour)=>{this.mutate(w=>{w.companyStyle={name:name.trim().slice(0,80)||w.name,colour};w.trains.forEach(t=>t.livery=colour);return true;});},
      returnToMenu:async()=>{this.speed(0);if(!await port.save())return false;port.scene.scene.stop('HUDScene');port.scene.scene.stop('DebugOverlayScene');port.scene.scene.start('MenuScene');return true;},
    });
    if(this.legacyFixture)this.panel.setVisible(false);
    void installAppLifecycle({onBackground:async()=>{this.speed(0);await port.save();},onForeground:()=>{this.panel.refresh(0,true);}}).then(remove=>{if(this.destroyed)remove();else this.removeLifecycle=remove;});
    this.refreshSession();
    EventBus.on('app:prepare-close',this.closeHandler);EventBus.on('ui:pause-visible',this.pausePanelHandler);
  }
  get active(): boolean { return !!WorldManager.world?.management; }
  showCompany():void { this.speed(0);this.panel.showCompany(); }
  controlledTrainIds(): ReadonlySet<string> { return new Set(this.active ? WorldManager.world!.trains.map(t=>t.id) : []); }
  /** Bounded deterministic stepping for the short playable smoke; absent from ordinary player controls. */
  advanceForAcceptance(seconds:number):void {
    if(typeof __RAIL_SIM_TEST_CONTROLS__==='undefined'||!__RAIL_SIM_TEST_CONTROLS__)throw new Error('Acceptance controls are disabled.');
    this.refreshSession();if(!this.session)return;
    const world=WorldManager.world!,previousSpeed=world.management!.speed;
    this.session.setSpeed(1);
    for(let i=0;i<seconds*20;i++)this.session.advance(50);
    this.session.setSpeed(previousSpeed);
    if(!WorldManager.applySimulationSnapshot(world.revision,this.session.snapshot()))throw new Error('Acceptance snapshot failed validation.');
    this.appliedRevision=WorldManager.world!.revision;
    this.port.trains.applyManagedSnapshots(this.session.getTrainSnapshots());this.session.drainEvents();
    this.panel.refresh(0,true);this.fleet.update(WorldManager.world!,0,this.session.presentationRoutes());this.visualKey='';this.draw(0);
  }
  setVisible(visible:boolean):void{this.panel.setVisible(visible&&!this.legacyFixture);}
  destroy():void{this.destroyed=true;EventBus.off('app:prepare-close',this.closeHandler);EventBus.off('ui:pause-visible',this.pausePanelHandler);this.removeLifecycle?.();this.client.cancel();this.panel.destroy();this.fleet.destroy();this.graphics.destroy();}
  update(time:number,delta:number,runtime:readonly TrainRuntimeSnapshot[]):boolean{
    this.panel.refresh(time);this.refreshSession();
    if(!this.session)return false;
    const world=WorldManager.world!;
    this.session.setExternalRuntime(runtime);
    const advanced=this.session.advance(delta);
    if(advanced.changed){const snapshot=this.session.snapshot();
      if(!WorldManager.applySimulationSnapshot(world.revision,snapshot))throw new Error('A railway simulation snapshot failed validation.');
      this.appliedRevision=snapshot.revision;
      this.port.trains.setManagedTrainIds(this.controlledTrainIds());this.port.trains.applyManagedSnapshots(advanced.trains);
      for(const event of this.session.drainEvents())if(event.type==='freight-delivery'){EventBus.emit('ui:cash-pulse',{amount:event.revenue});}
    }
    this.fleet.update(WorldManager.world!,time,this.session.presentationRoutes());this.draw(delta);return true;
  }
  private refreshSession():void{const w=WorldManager.world;if(!w?.management){this.session=null;return;}
    for(const station of this.port.content.stations)station.setManagedPresentation(true);
    if(!this.session)this.session=new SimulationSession(w);else if(w.revision!==this.appliedRevision)this.session.replaceWorld(w);
    this.appliedRevision=w.revision;this.port.trains.setManagedTrainIds(this.controlledTrainIds());
  }
  private mutate(fn:(world:WorldData)=>boolean,construction=false):boolean{const w=WorldManager.world;if(!w)return false;
    const changed=WorldManager.applyManagementChange(w.revision,fn,construction?'construction':'operations');
    if(changed){this.refreshSession();void this.port.save();this.visualKey='';}return changed;
  }
  private enable():string{if(this.active)return 'Regional play is already active.';
    const ok=this.mutate(w=>{w.economy.facilities.push(...generateSecondaryFacilities(w,this.port.terrain));
      for(const product of LAUNCH_PRODUCTS)w.economy.market.regionalDemandBpsByProduct[product.id]??=10_000;
      w.management=createManagementState();w.management.speed=0;w.region=createRegionState(w);w.blueprints=[];
      w.trains.forEach(t=>{if(t.dynamics.mode==='on-rail')t.dynamics.speedMps=0;});return true;});
    if(ok){this.port.refreshFacilities();EventBus.emit('railway:enabled',{});}return ok?'Regional play is ready. Build a line, buy a train, then choose two stops.':'Could not prepare regional play. Your original world is unchanged.';
  }
  private speed(speed:SimulationSpeed):void{if(!this.active)return;this.refreshSession();const w=WorldManager.world!;this.session!.setSpeed(speed);WorldManager.applySimulationSnapshot(w.revision,this.session!.snapshot());this.appliedRevision=WorldManager.world!.revision;}
  private service(service:ServiceDefinition):string{this.refreshSession();if(!this.session)return 'Start regional play first.';
    const added=this.session.upsertService(service);if(!added.ok)return added.errors[0];
    const w=WorldManager.world!;if(!WorldManager.applySimulationSnapshot(w.revision,this.session.snapshot()))return 'Service could not be saved. Review its stops.';
    this.appliedRevision=WorldManager.world!.revision;void this.port.save();return service.enabled?'Service started. Automatic routing and safe reservations are active.':'Service paused.';
  }
  private removeService(id:string):void{this.refreshSession();if(!this.session?.removeService(id))return;WorldManager.applySimulationSnapshot(WorldManager.world!.revision,this.session.snapshot());this.appliedRevision=WorldManager.world!.revision;void this.port.save();}
  private project(id:string,station:string|null):string{
    const world=WorldManager.world,project=world?.region?.projects.find(p=>p.definitionId===id);
    if(!world||!project)return 'Project is unavailable.';
    if(station){
      if(!world.stations.some(s=>s.id===station))return 'Choose an existing passenger station.';
      if(!projectStationPoint(world,station))return 'This station cannot be located on valid railway track. Reconnect its track or choose another station.';
      if(!isProjectStationEligible(project,world,station))return `Choose a passenger station within ${Math.round(REGIONAL_PROJECT_CATCHMENT_RADIUS/TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre).toLocaleString('en-GB')} metres of the project site, or use Nearby arrivals.`;
    }
    const ok=this.mutate(w=>{if(!w.region)return false;w.region=connectProjectStation(acceptProject(w.region,id),id as RegionalProjectKind,station);return true;});return ok?'Project accepted. Future deliveries and arrivals contribute to its progress.':'Project is unavailable.';
  }
  private buy(family:string,set:string,track:string,t:number):string{const proposal=createFleetProposal(WorldManager.world!,family,set,track,t);
    const ok=this.mutate(w=>{if(!debitPurchase(w,'vehicle-capex',proposal.price,'vehicle:'+proposal.train.id))return false;w.trains.push(proposal.train);return true;});
    if(!ok)return 'Not enough cash for this train. Choose a cheaper family.';this.port.content.restoreVehicle(proposal.train);return 'Train purchased and placed. Assign its stops in Services.';
  }
  private station(name:string,track:string,t:number,length:number):string{const proposal=createPlatformProposal(WorldManager.world!,name,track,t,length);
    const ok=this.mutate(w=>{if(!debitPurchase(w,'construction-capex',proposal.price,'station:'+proposal.station.id))return false;w.stations.push(proposal.station);return true;},true);
    if(!ok)return 'Not enough cash for this platform.';this.port.content.restoreStation(proposal.station);return 'Platform built. Create a passenger service linking it to another station.';
  }
  private electrify(id:string):string{const track=WorldManager.world!.tracks.find(t=>t.uuid===id);if(!track)return 'Choose an existing track.';if(track.electrified)return 'This track already has overhead wires.';
    const price=Math.ceil(new TrackArcLengthIndex(track,TRAIN_PHYSICS_CONFIG.arcSampleSpacing).length/TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre*30);
    const ok=this.mutate(w=>{if(!debitPurchase(w,'construction-capex',price,'wires:'+id))return false;w.tracks.find(t=>t.uuid===id)!.electrified=true;return true;},true);return ok?'Overhead wires installed. Electric services may now use this track.':'Not enough cash for electrification.';
  }
  private captureDraft():BlueprintDraft|null{const w=WorldManager.world,preview=this.port.preview();if(!w||!preview?.proposal)return null;
    const d=emptyBlueprint(w);d.tracks=[{uuid:crypto.randomUUID(),...clonePlainData(preview.proposal.geometry),verticalProfile:clonePlainData(preview.proposal.verticalProfile),structures:clonePlainData(preview.proposal.structures),paidBuildCost:preview.proposal.costs.total}];return d;
  }
  private sketch(a:string,b:string,bend:number):BlueprintDraft|null{const w=WorldManager.world!,from=w.economy.facilities.find(f=>f.id===a),to=w.economy.facilities.find(f=>f.id===b);if(!from||!to||a===b)throw new Error('Choose two different industry access points.');return sketchConnection(w,this.port.terrain,from.railAccess,to.railAccess,bend);}
  private draftWorld(d:BlueprintDraft):WorldData{const w=clonePlainData(WorldManager.world!);w.tracks.push(...clonePlainData(d.tracks));w.junctions.push(...clonePlainData(d.junctions));w.stations.push(...clonePlainData(d.stations));w.trains.push(...clonePlainData(d.trains));return w;}
  private saveDraft(d:BlueprintDraft):string{const q=quoteBlueprint(WorldManager.world!,d,this.port.terrain);if(q.errors.length)return q.errors[0];
    const ok=this.mutate(w=>{w.blueprints=[...(w.blueprints??[]).filter(b=>b.id!==d.id).slice(-1),clonePlainData(q.draft)];return true;});return ok?'Alternative saved. Keep two designs for comparison.':'Could not save the alternative.';
  }
  private commit(d:BlueprintDraft):string{const w=WorldManager.world!,q=quoteBlueprint(w,d,this.port.terrain);if(!q.valid)return q.errors[0];
    const ok=this.mutate(candidate=>applyBlueprintPurchase(candidate,q),true);if(!ok)return 'The railway changed. Refresh this draft and try again.';
    q.draft.tracks.forEach(t=>this.port.content.restoreTrack(t));q.draft.stations.forEach(s=>this.port.content.restoreStation(s));q.draft.trains.forEach(t=>this.port.content.restoreVehicle(t));return 'Built '+q.draft.tracks.length+' tracks, '+q.draft.stations.length+' platforms and '+q.draft.trains.length+' trains for £'+q.totalCost.toLocaleString('en-GB')+'.';
  }
  private async rehearse(d?:BlueprintDraft){const w=clonePlainData(WorldManager.world!);let draft:BlueprintDraft|undefined;
    if(d){const q=quoteBlueprint(w,d,this.port.terrain);if(!q.valid)throw new Error(q.errors[0]);draft=q.draft;}
    const result=await this.client.run({requestId:crypto.randomUUID(),world:w,draft,horizonSeconds:600,sampleIntervalSeconds:2});
    if(result.status==='complete'){this.ghost=result;this.ghostTime=0;this.visualKey='';}return result;
  }
  private focus(id:string):void{const w=WorldManager.world!,facility=w.economy.facilities.find(f=>f.id===id),station=w.stations.find(s=>s.id===id),train=w.trains.find(t=>t.id===id);
    let point=facility?{x:facility.x,y:facility.y}:null;
    const located=station??train;if(located){const track=w.tracks.find(t=>t.uuid===located.trackUUID);if(track)point=new TrackArcLengthIndex(track,TRAIN_PHYSICS_CONFIG.arcSampleSpacing).poseAtDistance(new TrackArcLengthIndex(track,TRAIN_PHYSICS_CONFIG.arcSampleSpacing).distanceAtParameter(located.trackT)).point;}
    if(point){this.port.scene.cameras.main.stopFollow();this.port.scene.cameras.main.centerOn(point.x,point.y);}
  }
  private draw(delta:number):void{const w=WorldManager.world!;this.ghostTime+=delta/1000*4;const samples=this.ghost?.samples;
    const sample=samples?.length?samples[Math.floor(this.ghostTime/2)%samples.length]:undefined;
    const key=w.constructionRevision+':'+(w.region?.transformations.length??0)+':'+(this.draft?.id??'')+':'+(sample?.clockSeconds??'');if(key===this.visualKey)return;this.visualKey=key;
    this.graphics.clear();
    for(const track of this.draft?.tracks??[]){this.graphics.lineStyle(12,0x81dfd1,.65);this.graphics.beginPath();for(let i=0;i<=48;i++){const t=i/48,s=1-t,x=s**3*track.p0.x+3*s*s*t*track.p1.x+3*s*t*t*track.p2.x+t**3*track.p3.x,y=s**3*track.p0.y+3*s*s*t*track.p1.y+3*s*t*t*track.p2.y+t**3*track.p3.y;if(i===0)this.graphics.moveTo(x,y);else this.graphics.lineTo(x,y);}this.graphics.strokePath();}
    if(w.region)for(const f of resolveTransformationFootprints(w.region,w.tracks,[...(this.draft?.tracks??[]),...(w.blueprints??[]).flatMap(d=>d.tracks)],f=>[[0,0],[f.radius,0],[-f.radius,0],[0,f.radius],[0,-f.radius]].every(([x,y])=>this.port.terrain.getHeightAt(f.x+x,f.y+y)>=0))){drawNeighbourhood(this.graphics,f);}
    if(sample)for(const t of sample.trains){this.graphics.fillStyle(0x92eee1,.7);this.graphics.fillCircle(t.x,t.y,28);this.graphics.lineStyle(4,0xebfffa,.8);this.graphics.lineBetween(t.x,t.y,t.x+Math.cos(t.angleRad)*60,t.y+Math.sin(t.angleRad)*60);}
  }
}
