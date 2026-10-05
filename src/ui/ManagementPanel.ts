import type { WorldData } from '../config/WorldData';
import type { BlueprintDraft, RehearsalResult, ServiceDefinition, SimulationSpeed } from '../simulation/SimulationTypes';
import { LAUNCH_FREIGHT_SETS } from '../freight/FreightSetCatalog';
import { POWERED_VEHICLE_FAMILIES } from '../region/VehicleRoster';
import { REGIONAL_PROJECTS, isProjectStationEligible, REGIONAL_PROJECT_CATCHMENT_RADIUS } from '../region/RegionalProjects';
import { getFacilityDefinition } from '../economy/ProductCatalog';
import { copyBlueprint, validateBlueprintDraft } from '../management/BlueprintFormat';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { isRiverside } from '../region/RiversideRegion';
import { RIVERSIDE_INTERFACE_CLASS, RIVERSIDE_INTERFACE_STYLES } from '../presentation/RiversideInterface';

export interface RailwayPanelActions {
  world(): WorldData | null;
  enable(): string;
  speed(speed: SimulationSpeed): void;
  service(service: ServiceDefinition): string;
  removeService(id: string): void;
  acceptProject(id: string, stationId: string | null): string;
  buyTrain(familyId: string, setId: string, trackId: string, trackT: number): string;
  station(name: string, trackId: string, trackT: number, length: number): string;
  electrify(trackId: string): string;
  captureDraft(): BlueprintDraft | null;
  sketch(from: string, to: string, bend: number): BlueprintDraft | null;
  passingLoop(from: string, to: string, side: 1|-1): BlueprintDraft | null;
  draftStation(draft: BlueprintDraft, name: string, trackId: string, trackT: number, length: number): BlueprintDraft;
  draftTrain(draft: BlueprintDraft, familyId: string, setId: string, trackId: string, trackT: number): BlueprintDraft;
  draftService(draft: BlueprintDraft, service: ServiceDefinition): BlueprintDraft;
  transform(draft: BlueprintDraft, angle: number, x: number, y: number): BlueprintDraft;
  quote(draft: BlueprintDraft): { cost: number; errors: string[]; details: string };
  saveDraft(draft: BlueprintDraft): string;
  commit(draft: BlueprintDraft): string;
  rehearse(draft?: BlueprintDraft): Promise<RehearsalResult>;
  cancelRehearsal(): void;
  showDraft(draft: BlueprintDraft | null): void;
  focus(id: string): void;
  save(): Promise<boolean>;
  exportWorld(): Promise<string>;
  importWorld(text: string): Promise<string>;
  style(name: string, colour: string): void;
  returnToMenu?(): Promise<boolean>;
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money = (value: number) => '£' + Math.round(value).toLocaleString('en-GB');
const option = (id: string, name: string,selected=false) => `<option value="${escape(id)}"${selected?' selected':''}>${escape(name)}</option>`;
type Tab = 'services' | 'projects' | 'plans' | 'fleet' | 'stations' | 'company';

/** Mouse and touch use the same controls; every action has a visible label and a 44px target. */
export class ManagementPanel {
  private readonly root = document.createElement('section');
  private readonly content = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly summary = document.createElement('span');
  private readonly head = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private tab: Tab = 'services';
  private open = false;
  private riverside = false;
  private draft: BlueprintDraft | null = null;
  private readonly undoDrafts: Array<BlueprintDraft|null> = [];
  private readonly redoDrafts: Array<BlueprintDraft|null> = [];
  private readonly results = new Map<string, RehearsalResult>();
  private pending = false;
  private lastRefresh = 0;
  private fileInput = document.createElement('input');
  private importKind: 'world' | 'blueprint' = 'world';
  private layoutObserver: ResizeObserver | null = null;
  private hudPresenceObserver: MutationObserver | null = null;
  private observedHud: HTMLElement | null = null;
  private layoutFrame: number | null = null;
  private destroyed = false;
  private readonly resizeHandler = () => this.scheduleLayout();

  constructor(private readonly actions: RailwayPanelActions) {
    this.riverside = isRiverside(this.actions.world());
    this.open = this.riverside && window.innerWidth > 1100;
    this.root.className = 'railway-panel';
    this.root.setAttribute('aria-label', 'Railway management');
    const style = document.createElement('style');
    style.textContent = `.railway-panel{position:fixed;right:12px;top:70px;z-index:80;color:#e8efe8;font:14px/1.45 system-ui,sans-serif;max-width:calc(100vw - 95px);width:370px;pointer-events:auto}.railway-panel *{box-sizing:border-box}.railway-panel button,.railway-panel input,.railway-panel select{font:inherit;min-height:44px;border:1px solid #53706a;border-radius:7px;background:#193b37;color:#f1f4e9;padding:8px;max-width:100%}.railway-panel button{cursor:pointer}.railway-panel button:focus-visible,.railway-panel input:focus-visible,.railway-panel select:focus-visible{outline:3px solid #eccd78;outline-offset:2px}.railway-panel button:disabled{opacity:.45;cursor:default}.railway-panel .rp-head{display:flex;align-items:center;gap:8px;background:#122e2af0;padding:8px;border-radius:12px;box-shadow:0 3px 16px #0005}.railway-panel .rp-head span{flex:1;font-size:12px}.railway-panel .rp-body{background:#122e2af7;border:1px solid #53706a;border-radius:12px;margin-top:6px;padding:12px;max-height:calc(100vh - 148px);overflow:auto;overscroll-behavior:contain;box-shadow:0 10px 26px #0005}.railway-panel nav{display:flex;gap:4px;overflow-x:auto;margin-bottom:12px}.railway-panel nav button{white-space:nowrap;font-size:12px}.railway-panel nav button[aria-selected=true]{background:#d7bd75;color:#162d28;border-color:#e5d49c}.railway-panel h2{font-size:19px;margin:6px 0}.railway-panel h3{font-size:15px;margin:0 0 5px}.railway-panel p{margin:6px 0 10px}.railway-panel .rp-muted{color:#aac3b9;font-size:12px}.railway-panel .rp-card{border:1px solid #41645b;background:#204239;border-radius:9px;padding:11px;margin:10px 0}.railway-panel label{display:block;font-size:12px;margin:10px 0 5px}.railway-panel label select,.railway-panel label input{display:block;width:100%;margin-top:4px}.railway-panel .rp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}.railway-panel .rp-row>*{flex:1}.railway-panel progress{width:100%;height:8px;accent-color:#d7bd75}.railway-panel .rp-primary{background:#d7bd75;color:#162d28;border-color:#e5d49c;font-weight:650}.railway-panel .rp-status{padding-top:8px;border-top:1px solid #41645b;color:#ecd899;white-space:pre-line}.railway-panel .rp-stops select{width:100%;margin:3px 0}.railway-panel [hidden]{display:none!important}@media(max-width:900px){.railway-panel{top:56px;right:6px;width:320px;font-size:13px}.railway-panel .rp-body{max-height:calc(100vh - 123px)}.railway-panel .rp-head{padding:5px}.railway-panel nav button{padding:6px}}@media(prefers-reduced-motion:reduce){.railway-panel *{scroll-behavior:auto}}`;
    style.textContent += RIVERSIDE_INTERFACE_STYLES;
    this.root.append(style);
    const head = this.head; head.className = 'rp-head';
    const toggle = this.toggle; toggle.className = 'rp-toggle'; toggle.textContent = 'Railway'; toggle.setAttribute('aria-expanded',String(this.open));
    toggle.onclick = () => { this.open = !this.open; toggle.setAttribute('aria-expanded',String(this.open)); this.render(); };
    head.append(toggle, this.summary);
    for (const speed of [0,1,2,4] as SimulationSpeed[]) {
      const b = document.createElement('button'); b.textContent = speed === 0 ? 'Ⅱ' : speed + '×'; b.title = speed === 0 ? 'Pause railway' : speed + '× simulation speed';
      b.dataset.speed=String(speed);
      b.setAttribute('aria-label',b.title); b.onclick = () => { this.actions.speed(speed); this.refresh(0, true); }; head.append(b);
    }
    this.content.className = 'rp-body'; this.status.className = 'rp-status'; this.status.setAttribute('role','status');
    this.root.append(head,this.content);
    this.fileInput.type='file'; this.fileInput.accept='.json,.railblueprint,.railworld'; this.fileInput.hidden=true;
    this.fileInput.onchange=async () => {
      const file=this.fileInput.files?.[0]; if(!file)return;
      try {
        if(file.size>25_000_000)throw new Error('Choose a file smaller than 25 MB.');
        const text=await file.text();
        if(this.importKind==='world')this.message(await this.actions.importWorld(text));
        else { const raw=JSON.parse(text); if(!validateBlueprintDraft(raw))throw new Error('Choose a complete version 1 railway blueprint.');
          const copied=copyBlueprint(raw,this.actions.world()!);this.actions.quote(copied);
          this.changeDraft(copied); this.render(); this.message('Imported as a detached sketch. Review the quote before building.'); }
      }catch(error){this.message(error instanceof Error?error.message:'Unable to import this file.');}
      this.fileInput.value='';
    };
    this.root.append(this.fileInput); document.body.append(this.root);
    for(const event of ['pointerdown','pointerup','pointermove','wheel','keydown','keyup'])this.root.addEventListener(event,e=>e.stopPropagation());
    this.root.addEventListener('click',event=>{ const b=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]'); if(b)void this.perform(b.dataset.action!,b.dataset.id); });
    window.addEventListener('resize',this.resizeHandler);
    window.visualViewport?.addEventListener('resize',this.resizeHandler);
    if(typeof ResizeObserver!=='undefined'){
      this.layoutObserver=new ResizeObserver(this.resizeHandler);
      this.layoutObserver.observe(this.head);
    }
    // HUD scenes can mount after this panel, or replace their DOM when the world changes.
    if(typeof MutationObserver!=='undefined'){
      this.hudPresenceObserver=new MutationObserver(this.resizeHandler);
      this.hudPresenceObserver.observe(document.body,{childList:true});
    }
    this.refresh(0,true);this.render();
  }

  destroy(): void {
    this.destroyed=true;this.actions.cancelRehearsal();
    window.removeEventListener('resize',this.resizeHandler);window.visualViewport?.removeEventListener('resize',this.resizeHandler);
    this.layoutObserver?.disconnect();this.hudPresenceObserver?.disconnect();
    if(this.layoutFrame!==null)window.cancelAnimationFrame(this.layoutFrame);
    if(this.riverside)document.body.classList.remove(RIVERSIDE_INTERFACE_CLASS);
    this.observedHud?.removeAttribute('data-riverside-company-name');
    this.root.remove();
  }
  setVisible(visible: boolean): void { this.root.hidden=!visible;if(visible)this.scheduleLayout(); }
  showCompany():void { this.open=true;this.tab='company';this.render(); }
  contains(x: number,y: number): boolean { const r=this.root.getBoundingClientRect();return !this.root.hidden&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom; }
  refresh(time: number, force=false): void {
    if(!force&&time-this.lastRefresh<700)return;this.lastRefresh=time;
    const w=this.actions.world();if(!w)return;
    this.syncPresentation(w);
    this.summary.textContent=this.riverside?(w.management?.speed===0?'Paused':Math.floor((w.management?.clockSeconds??0)/60)+' min'):money(w.company.cash)+(w.management?' · '+Math.floor(w.management.clockSeconds/60)+' min':' · regional play');
    this.scheduleLayout();
    this.root.querySelectorAll<HTMLButtonElement>('.rp-head button[data-speed]').forEach(b=>{
      const speed=Number(b.dataset.speed),start=this.riverside&&w.management?.speed===0&&speed===1;
      b.setAttribute('aria-pressed',String(speed===w.management?.speed));
      b.classList.toggle('rp-start',start);b.textContent=start?'Start':speed===0?'Ⅱ':speed+'×';
      b.title=start?'Start railway':speed===0?'Pause railway':speed+'× simulation speed';b.setAttribute('aria-label',b.title);
    });
    if(this.open&&w.management&&(force||w.management.speed>0)&&!this.content.contains(document.activeElement)&&!this.pending&&(this.tab==='services'||this.tab==='projects'))this.render();
  }
  private message(text: string): void { this.status.textContent=text; }
  private value(name: string): string { return (this.content.querySelector(`[name="${name}"]`) as HTMLInputElement|HTMLSelectElement|null)?.value??''; }
  private button(action: string,label: string,id?: string,primary=false): string { return `<button data-action="${action}"${id?` data-id="${escape(id)}"`:''}${primary?' class="rp-primary"':''}>${label}</button>`; }
  private facilityName(world: WorldData,id:string):string { const f=world.economy.facilities.find(f=>f.id===id);return f?(isRiverside(world)?f.name:getFacilityDefinition(f.definitionId)?.displayName??f.definitionId):id; }
  private targetOptions(world: WorldData): string { return world.economy.facilities.map(f=>option('facility:'+f.id,this.facilityName(world,f.id))).join('')+world.stations.map(s=>option('station:'+s.id,s.name)).join(''); }
  private facilityOptions(world:WorldData,second=false):string{return world.economy.facilities.map((f,i)=>option(f.id,this.facilityName(world,f.id),this.riverside&&second&&i===1)).join('');}
  private syncPresentation(world:WorldData):void{
    const riverside=isRiverside(world);
    if(riverside!==this.riverside){this.riverside=riverside;this.open=riverside&&window.innerWidth>1100;this.tab='services';}
    document.body.classList.toggle(RIVERSIDE_INTERFACE_CLASS,riverside);this.root.classList.toggle('rp-riverside',riverside);
    this.toggle.textContent=riverside?'Railway '+(this.open?'▾':'▸'):'Railway';this.toggle.setAttribute('aria-expanded',String(this.open));
    if(riverside)this.toggle.setAttribute('aria-label',this.open?'Collapse railway inspector':'Open railway inspector');else this.toggle.removeAttribute('aria-label');
    const hud=document.querySelector<HTMLElement>('[data-testid="company-hud"]');
    if(hud){if(riverside)hud.dataset.riversideCompanyName=world.companyStyle?.name??'Brookford Railway';else hud.removeAttribute('data-riverside-company-name');}
  }
  private objective(world:WorldData):string{
    const project=world.region?.projects.find(p=>p.definitionId==='housing');
    const modules=project?.progress.modules??0,arrivals=project?.progress.residents??0,complete=project?.completedAtTick!==null&&project?.completedAtTick!==undefined;
    return `<article class="rp-objective" aria-label="Brookford objective"><p class="rp-eyebrow">${complete?'A growing town':'Your first chapter'}</p><h2>Homes by the railway</h2><p>Two services share a single track. Carry building modules to Brookford Goods Yard and bring residents into town.</p><div class="rp-goals"><div class="rp-goal"><strong>${modules} / 16</strong>Building modules<progress aria-label="Building modules delivered" value="${modules}" max="16"></progress></div><div class="rp-goal"><strong>${arrivals} / 60</strong>Passenger arrivals<progress aria-label="Passenger arrivals" value="${arrivals}" max="60"></progress></div></div><p class="rp-muted">${complete?'Neighbourhood complete · passenger demand +25%.':'Complete the neighbourhood to increase passenger demand by 25%.'}</p>${world.management?.speed===0?this.button('start-railway','Start railway',undefined,true):''}</article>`;
  }
  private trackOptions(world: WorldData): string { return world.tracks.map((t,i)=>option(t.uuid,`Track ${i+1}${t.electrified?' · electric':''}`)).join(''); }
  private scheduleLayout():void{
    if(this.destroyed||this.layoutFrame!==null)return;
    if(typeof window.requestAnimationFrame!=='function'){this.applyLayout();return;}
    this.layoutFrame=window.requestAnimationFrame(()=>{this.layoutFrame=null;if(!this.destroyed)this.applyLayout();});
  }
  private applyLayout():void{
    const hud=document.querySelector<HTMLElement>('[data-testid="company-hud"]');
    if(hud!==this.observedHud){
      if(this.observedHud){this.layoutObserver?.unobserve(this.observedHud);this.observedHud.removeAttribute('data-riverside-company-name');}
      this.observedHud=hud;if(hud)this.layoutObserver?.observe(hud);
    }
    const world=this.actions.world();if(world&&hud&&this.riverside)hud.dataset.riversideCompanyName=world.companyStyle?.name??'Brookford Railway';
    const hudBounds=hud?.getBoundingClientRect();
    const visible=!!hudBounds&&hudBounds.height>0&&getComputedStyle(hud!).visibility!=='hidden'&&getComputedStyle(hud!).display!=='none';
    const top=Math.max(window.innerWidth<=900?56:70,visible?Math.ceil(hudBounds!.bottom)+8:0);
    const viewportBottom=window.visualViewport?window.visualViewport.offsetTop+window.visualViewport.height:window.innerHeight;
    this.root.style.top=`${top}px`;
    const headHeight=this.head.getBoundingClientRect().height;
    this.content.style.maxHeight=`${Math.max(0,Math.floor(viewportBottom-top-headHeight-6-8))}px`;
  }
  private render(): void {
    this.scheduleLayout();
    const w=this.actions.world();if(!w)return;
    this.syncPresentation(w);this.content.hidden=!this.open;if(!this.open)return;
    if(!w.management){this.content.innerHTML=`<h2>Your regional railway</h2><p>Build a line, buy a train, and select its stops. Rehearse the service before committing to your next improvement.</p><p class="rp-muted">Your existing railway and money carry into regional play. The simulation can run while you build; use Ⅱ to pause freely.</p>${this.button('enable','Start regional play',undefined,true)}`;this.content.append(this.status);return;}
    const tabs:Tab[]=this.riverside?['services','projects','plans','company']:['services','projects','plans','fleet','stations','company'];
    let html=`<nav aria-label="Railway panels">${tabs.map(t=>`<button data-action="tab" data-id="${t}" aria-selected="${this.tab===t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</nav>`;
    if(this.tab==='services'){
      html+=this.riverside?this.objective(w)+`<p class="rp-eyebrow">Your services</p>`:`<h2>Run your railway</h2><p class="rp-muted">Select stops in order. Trains repeat the list, reverse automatically, and reserve clear track. Pause or edit a service to resolve a conflict.</p>`;
      for(const s of w.management.services){const state=w.management.serviceStates[s.id],reason=state?.stoppedReason;
        if(this.riverside){
          const route=s.stops.map(stop=>stop.targetKind==='facility'?this.facilityName(w,stop.targetId):w.stations.find(station=>station.id===stop.targetId)?.name??stop.targetId).map(escape).join(' ↔ ');
          const description=!s.enabled?'Service paused':reason?.message??(w.management.speed===0?'Ready for departure':'Travelling to the next stop');
          html+=`<div class="rp-card"><div class="rp-service-heading"><h3>${escape(s.name)}</h3><span class="rp-service-kind">${s.kind}</span></div><p class="rp-service-route">${route}</p><p class="rp-service-state">${escape(description)}</p>${reason?`<p class="rp-muted">${escape(reason.remedy)}</p>`:''}<p class="rp-muted">${state?.completedCycles??0} return trips · ${Math.round(state?.delaySeconds??0)}s waiting</p><div class="rp-row rp-service-tools">${this.button('focus','Find train',s.trainId)}${this.button('toggle-service',s.enabled?'Pause service':'Resume service',s.id)}</div></div>`;
          continue;
        }
        html+=`<div class="rp-card"><h3>${escape(s.name)}</h3><p>${escape(reason?.message??'Running to the next stop')}<br><span class="rp-muted">${escape(reason?.remedy??'Automatic routing and safe braking are active.')}</span></p><p class="rp-muted">${state?.completedCycles??0} cycles · ${Math.round(state?.delaySeconds??0)} seconds waiting</p><div class="rp-row">${this.button('focus','Find train',s.trainId)}${this.button('toggle-service',s.enabled?'Pause service':'Resume service',s.id)}${this.button('remove-service','Remove service',s.id)}</div></div>`;
      }
      if(!this.riverside)html+=`<details${w.management.services.length?'':' open'}><summary>New service</summary><label>Name<input name="service-name" value="Regional service" maxlength="80"></label><label>Train<select name="train">${w.trains.filter(t=>!w.management!.services.some(s=>s.trainId===t.id)).map((t,i)=>option(t.id,`${getFreightName(t.vehicleFamilyId,t.freightSetId)} · ${t.id.slice(0,6)}`)).join('')}</select></label><label>Service type<select name="kind"><option value="freight">Freight</option><option value="passenger">Passenger</option></select></label><div class="rp-stops"><label>Stops in order (at least two)</label>${[0,1,2,3].map((i)=>`<select name="stop-${i}" aria-label="Stop ${i+1}">${i>1?option('','No additional stop'):''}${this.targetOptions(w)}</select>`).join('')}</div><label>Loading rule<select name="loading"><option value="available">Load available goods</option><option value="full">Wait for full load</option></select></label><div class="rp-row"><label>Max wait (s)<input name="wait" type="number" min="0" max="3600" value="30"></label><label>Interval (s)<input name="frequency" type="number" min="0" value="0"></label></div><div class="rp-row"><label>Offset (s)<input name="offset" type="number" min="0" value="0"></label><label>Priority<input name="priority" type="number" min="0" max="10" value="1"></label></div>${this.button('create-service','Start service',undefined,true)}</details>`;
    }else if(this.tab==='projects'){
      html+=this.riverside?`<p class="rp-eyebrow">Brookford grows with you</p><h2>A new neighbourhood</h2><p class="rp-muted">The goods train brings building modules; the local brings future residents. Your deliveries and arrivals build the homes beside Brookford station.</p>`:`<h2>Transform the region</h2><p class="rp-muted">Choose what to develop. Completed projects bring new buildings and heavier traffic. Deliveries count after you accept a project.</p>`;
      for(const p of (w.region?.projects??[]).filter(p=>!this.riverside||p.definitionId==='housing')){const d=REGIONAL_PROJECTS.find(d=>d.id===p.definitionId)!;
        const localStations=w.stations.filter(s=>isProjectStationEligible(p,w,s.id));
        const selectedStation=localStations.some(s=>s.id===p.stationId)?p.stationId:'';
        const stationOptions=[{id:'',name:'Nearby arrivals'},...localStations.map(s=>({id:s.id,name:s.name}))].map(s=>`<option value="${escape(s.id)}"${s.id===selectedStation?' selected':''}>${escape(s.name)}</option>`).join('');
        html+=`<div class="rp-card"><h3>${escape(d.title)}${p.completedAtTick!==null?' · Complete':''}</h3><p>${escape(d.description)}</p>${d.requirements.map(r=>{const target=r.kind==='freight-delivery'?r.units:r.passengers;return `<label>${escape(r.kind==='freight-delivery'?(this.riverside&&r.productId==='building-modules'?'Building modules':r.productId):'Passenger arrivals')} · ${p.progress[r.id]??0} / ${target}<progress value="${p.progress[r.id]??0}" max="${target}"></progress></label>`;}).join('')}<p class="rp-muted">Grant ${money(d.reward.grant)} · passenger demand +${Math.round(d.reward.passengerDemandBonusBps/100)}%${d.reward.production.map(v=>' · production +'+v.bonusBps/100+'%').join('')}</p><label>Passenger station<select name="project-${p.definitionId}">${stationOptions}</select></label><p class="rp-muted">Only stations within ${Math.round(REGIONAL_PROJECT_CATCHMENT_RADIUS/TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre).toLocaleString('en-GB')} metres of the project site contribute passenger arrivals.</p><div class="rp-row">${this.button('focus','Visit site',p.anchorFacilityId??'')}${this.button('project',p.accepted?'Update station':'Accept project',p.definitionId,!p.accepted)}</div></div>`;
      }
    }else if(this.tab==='fleet'){
      html+=`<h2>Fleet depot</h2><p class="rp-muted">Choose a train for the gradients, traffic and platforms on your railway. Electric trains require continuous wires.</p><label>Powered family<select name="family">${POWERED_VEHICLE_FAMILIES.map(f=>option(f.id,`${f.displayName} · ${money(f.purchasePrice)}`)).join('')}</select></label>${POWERED_VEHICLE_FAMILIES.map(f=>`<details><summary>${escape(f.displayName)}</summary><p>${escape(f.description)}</p><p class="rp-muted">${f.maxSpeedKph} km/h · ${f.lengthMetres} m · ${f.powerKw} kW · ${f.passengerCapacity} seats</p></details>`).join('')}<label>Freight wagons (passenger units ignore this)<select name="set">${LAUNCH_FREIGHT_SETS.map(s=>option(s.id,s.displayName)).join('')}</select></label><label>Depot track<select name="fleet-track">${this.trackOptions(w)}</select></label><label>Position along track (%)<input name="fleet-t" type="range" min="5" max="95" value="20"></label><p class="rp-muted">Freight consists include a wagon allowance. Leave space around the train before buying.</p>${this.button('buy','Buy and place train',undefined,true)}`;
    }else if(this.tab==='stations'){
      html+=`<h2>Passenger stations</h2><p class="rp-muted">Place a modular platform on a track. Destinations generate groups of passengers; connected services carry them and support transfers.</p>${w.stations.map(s=>`<div class="rp-card"><h3>${escape(s.name)}</h3><p>${s.platformLengthMetres??120} m platform · ${s.passengerSpawnRate} passengers/min</p>${this.button('focus','Visit station',s.id)}</div>`).join('')}<label>Station name<input name="station-name" value="Regional station" maxlength="80"></label><label>Track<select name="station-track">${this.trackOptions(w)}</select></label><label>Position (%)<input name="station-t" type="range" min="5" max="95" value="50"></label><label>Platform length (m)<input name="length" type="number" min="30" max="300" step="10" value="120"></label>${this.button('station','Build platform',undefined,true)}<p class="rp-muted">Platforms cost £5,000 plus £100/metre. Track electrification costs £30/metre.</p><label>Electrify track<select name="wire-track">${this.trackOptions(w)}</select></label>${this.button('wire','Install overhead wires')}`;
    }else if(this.tab==='plans'){
      html+=`<h2>Design and rehearse</h2><p class="rp-muted">${this.riverside?'Sketch another route between the mill and goods yard. Compare it in a rehearsal before building. Drafts cost nothing.':'Draw with the track tool, then capture its preview here. Or sketch between two industry access points. Drafts cost nothing until you build.'}</p>${this.riverside?'':`<div class="rp-row">${this.button('capture','Capture track preview')}${this.button('import-blueprint','Import blueprint')}</div>`}<label>From<select name="from">${this.facilityOptions(w)}</select></label><label>To<select name="to">${this.facilityOptions(w,true)}</select></label>${this.riverside?'<label>Curve shape<select name="bend"><option value="0">Straight</option><option value="300">Broad curve</option><option value="-300">Opposite curve</option></select></label>':'<label>Curve offset (world units)<input name="bend" type="number" value="0" step="50"></label>'}<div class="rp-row">${this.button('sketch','Preview connection')}${this.button('loop',this.riverside?'Preview northern relief line':'Fit passing loop')}</div>`;
      if(this.draft){const q=this.actions.quote(this.draft);html+=`<div class="rp-card"><label>Draft name<input name="draft-name" value="${escape(this.draft.name)}" maxlength="80"></label><p>${money(q.cost)} · ${escape(q.details)}</p><p class="rp-muted">${escape(q.errors[0]??'Engineering checks passed. The final quote is rechecked when you build.')}</p><div class="rp-row">${this.button('save-draft','Save alternative')}${this.button('export-blueprint','Export')}</div><div class="rp-row">${this.button('rehearse-draft',this.pending?'Rehearsing…':'Rehearse draft')}${this.button('commit','Build draft',undefined,true)}${this.button('clear-draft','Clear')}</div></div>`;}
      if(this.draft){const planned={...w,tracks:[...w.tracks,...this.draft.tracks],stations:[...w.stations,...this.draft.stations],trains:[...w.trains,...this.draft.trains]};
        html+=`<div class="rp-row">${this.button('draft-undo','Undo sketch')}${this.button('draft-redo','Redo sketch')}${this.button('rotate-draft','Rotate 90°')}</div><details><summary>Plan a platform</summary><label>Planned station name<input name="plan-station-name" value="New station"></label><label>Platform track<select name="plan-station-track">${this.trackOptions(planned)}</select></label><div class="rp-row"><label>Position (%)<input name="plan-station-t" type="number" min="5" max="95" value="50"></label><label>Length (m)<input name="plan-station-length" type="number" min="30" max="300" value="120"></label></div>${this.button('draft-station','Add platform to draft')}</details><details><summary>Plan a train</summary><label>Planned train family<select name="plan-family">${POWERED_VEHICLE_FAMILIES.map(f=>option(f.id,f.displayName)).join('')}</select></label><label>Planned wagons<select name="plan-set">${LAUNCH_FREIGHT_SETS.map(s=>option(s.id,s.displayName)).join('')}</select></label><label>Planned depot track<select name="plan-fleet-track">${this.trackOptions(planned)}</select></label><label>Depot position (%)<input name="plan-fleet-t" type="number" min="5" max="95" value="20"></label>${this.button('draft-train','Add train to draft')}</details><details><summary>Plan a service</summary><label>Planned service name<input name="plan-service-name" value="Proposed shuttle"></label><label>Planned service train<select name="plan-train">${planned.trains.filter(t=>!w.management!.services.some(s=>s.trainId===t.id)).map(t=>option(t.id,getFreightName(t.vehicleFamilyId,t.freightSetId)+' · '+t.id.slice(0,6))).join('')}</select></label><label>Planned service type<select name="plan-kind"><option value="freight">Freight</option><option value="passenger">Passenger</option></select></label><label>First stop<select name="plan-stop-0">${this.targetOptions(planned)}</select></label><label>Second stop<select name="plan-stop-1">${this.targetOptions(planned)}</select></label><label>Departure interval (s)<input name="plan-frequency" type="number" min="0" value="0"></label>${this.button('draft-service','Add service to draft')}</details><p class="rp-muted">Draft contains ${this.draft.stations.length} platforms, ${this.draft.trains.length} trains and ${this.draft.services.length} services. These commit together with the railway.</p>`;
      }
      html+=`<div class="rp-row">${this.button('rehearse-current','Rehearse current railway')}${this.button('cancel-rehearsal','Cancel')}</div>`;
      for(const b of (w.blueprints??[]).slice(-2))html+=`<div class="rp-card"><h3>${escape(b.name)}</h3><p>${b.tracks.length} tracks · ${money(b.constructionCost)}</p><div class="rp-row">${this.button('load-draft','Open alternative',b.id)}${this.button('rehearse-saved','Rehearse',b.id)}</div></div>`;
      for(const [name,r]of this.results)html+=`<div class="rp-card"><h3>${escape(name)}</h3><p>Engineering · ${Math.round(r.elapsedSeconds)} s simulated · ${r.engineering.completedCycles} cycles · ${r.engineering.deliveredUnits} goods · ${r.engineering.passengersDelivered} passengers</p><p>${money(r.engineering.revenue-r.engineering.runningCosts)} operating balance · ${Math.round(r.engineering.waitingSeconds)} s waiting</p><p class="rp-muted">${escape(r.engineering.blockers[0]?.reason.message??'No operational blockers observed in the rehearsal horizon.')} ${escape(r.engineering.blockers[0]?.reason.remedy??'')}</p><p class="rp-muted">Demand forecast · illustrative ${r.forecast.demandRange.map(n=>Math.round(n*100)+'%').join('–')} of baseline. ${escape(r.forecast.assumptions.join(' '))}</p></div>`;
    }else{
      html+=`<h2>Your railway company</h2><label>Name<input name="company-name" value="${escape(w.companyStyle?.name??w.name)}" maxlength="80"></label><label>Livery colour<input name="colour" type="color" value="${w.companyStyle?.colour??'#dfb75c'}"></label>${this.button('style','Apply company style')}<div class="rp-row">${this.button('save','Save world')}${this.button('export-world','Export world')}${this.button('import-world','Import world')}</div><p class="rp-muted">Exported saves and blueprints are local files. Imported worlds receive a fresh identity so your current region remains available.</p><p>${this.riverside?(w.region?.projects.find(p=>p.definitionId==='housing')?.completedAtTick!=null?'Brookford’s new neighbourhood is complete. Keep shaping your railway.':'Brookford’s new neighbourhood is waiting for your railway.'):`Regional completion: ${w.region?.projects.filter(p=>p.completedAtTick!==null).length??0}/5 projects. Continue building after completion.`}</p>`;
    }
    if(this.riverside&&this.tab==='company')html+=this.button('main-menu','Save and return to menu');
    this.content.innerHTML=html;this.content.append(this.status);
    if(this.riverside){
      this.content.querySelector('[name="plan-family"]')?.closest('details')?.remove();
      this.content.querySelector('[name="plan-train"]')?.closest('details')?.remove();
    }
  }

  private async perform(action:string,id?:string):Promise<void>{
    const w=this.actions.world();if(!w)return;
    try{
      if(action==='tab'){if(this.riverside&&(id==='fleet'||id==='stations'))return;this.tab=id as Tab;this.render();return;}
      if(action==='enable'){this.message(this.actions.enable());this.render();return;}
      if(action==='start-railway'){this.actions.speed(1);}
      else if(action==='create-service'){
        const stops=[0,1,2,3].map(i=>this.value('stop-'+i)).filter(Boolean).map((v,i)=>{const split=v.indexOf(':');return{targetKind:v.slice(0,split) as 'facility'|'station',targetId:v.slice(split+1),loadRule:this.value('kind')==='passenger'?'none' as const:i===0?this.value('loading') as 'full'|'available':'unload' as const,maxWaitSeconds:Number(this.value('wait'))};});
        this.message(this.actions.service({id:crypto.randomUUID(),name:this.value('service-name'),trainId:this.value('train'),kind:this.value('kind') as 'freight'|'passenger',stops,frequencySeconds:Number(this.value('frequency')),departureOffsetSeconds:Number(this.value('offset')),priority:Number(this.value('priority')),enabled:true}));
      }else if(action==='remove-service'){this.actions.removeService(id!);this.message('Service removed. Its train is stopped and available for reassignment.');}
      else if(action==='toggle-service'){const s=w.management!.services.find(s=>s.id===id)!;this.message(this.actions.service({...s,enabled:!s.enabled}));}
      else if(action==='focus')this.actions.focus(id!);
      else if(action==='project')this.message(this.actions.acceptProject(id!,this.value('project-'+id)||null));
      else if(action==='buy')this.message(this.actions.buyTrain(this.value('family'),this.value('set'),this.value('fleet-track'),Number(this.value('fleet-t'))/100));
      else if(action==='station')this.message(this.actions.station(this.value('station-name'),this.value('station-track'),Number(this.value('station-t'))/100,Number(this.value('length'))));
      else if(action==='wire')this.message(this.actions.electrify(this.value('wire-track')));
      else if(action==='capture'){this.changeDraft(this.actions.captureDraft());this.message(this.draft?'Track preview captured.':'Draw a track preview first, or use the connection controls.');}
      else if(action==='sketch')this.changeDraft(this.actions.sketch(this.value('from'),this.value('to'),Number(this.value('bend'))));
      else if(action==='loop')this.changeDraft(this.actions.passingLoop(this.value('from'),this.value('to'),Number(this.value('bend'))<0?-1:1));
      else if(action==='draft-station'&&this.draft)this.changeDraft(this.actions.draftStation(this.draft,this.value('plan-station-name'),this.value('plan-station-track'),Number(this.value('plan-station-t'))/100,Number(this.value('plan-station-length'))));
      else if(action==='draft-train'&&this.draft)this.changeDraft(this.actions.draftTrain(this.draft,this.value('plan-family'),this.value('plan-set'),this.value('plan-fleet-track'),Number(this.value('plan-fleet-t'))/100));
      else if(action==='draft-service'&&this.draft){const stops=[0,1].map(i=>{const v=this.value('plan-stop-'+i),split=v.indexOf(':');return{targetKind:v.slice(0,split) as 'facility'|'station',targetId:v.slice(split+1),loadRule:this.value('plan-kind')==='passenger'?'none' as const:i===0?'available' as const:'unload' as const,maxWaitSeconds:30};});this.changeDraft(this.actions.draftService(this.draft,{id:crypto.randomUUID(),name:this.value('plan-service-name'),trainId:this.value('plan-train'),kind:this.value('plan-kind') as 'freight'|'passenger',stops,frequencySeconds:Number(this.value('plan-frequency')),departureOffsetSeconds:0,priority:1,enabled:true}));}
      else if(action==='rotate-draft'&&this.draft)this.changeDraft(this.actions.transform(this.draft,Math.PI/2,0,0));
      else if(action==='draft-undo'&&this.undoDrafts.length){this.redoDrafts.push(this.draft?structuredClone(this.draft):null);this.draft=this.undoDrafts.pop()!;this.actions.showDraft(this.draft);}
      else if(action==='draft-redo'&&this.redoDrafts.length){this.undoDrafts.push(this.draft?structuredClone(this.draft):null);this.draft=this.redoDrafts.pop()!;this.actions.showDraft(this.draft);}
      else if(action==='save-draft'){if(this.draft){this.draft.name=this.value('draft-name');this.message(this.actions.saveDraft(this.draft));}}
      else if(action==='load-draft')this.changeDraft(structuredClone(w.blueprints!.find(b=>b.id===id)!));
      else if(action==='clear-draft')this.changeDraft(null);
      else if(action==='commit'){if(this.draft){const result=this.actions.commit(this.draft);this.message(result);if(result.startsWith('Built')){this.draft=null;this.actions.showDraft(null);}}}
      else if(action.startsWith('rehearse-')){
        if(this.pending)return;const draft=action==='rehearse-current'?undefined:action==='rehearse-saved'?w.blueprints!.find(b=>b.id===id):this.draft??undefined;
        this.pending=true;this.message('Rehearsing a detached copy of the railway…');this.render();
        try{const r=await this.actions.rehearse(draft);if(r.status==='complete'){this.results.set(draft?.name??'Current railway',r);this.message('Rehearsal complete. Engineering uses the same rules as live services.');}else this.message(r.errors.join('\n')||'Rehearsal cancelled.');}finally{this.pending=false;}
      }else if(action==='cancel-rehearsal'){this.actions.cancelRehearsal();this.message('Cancellation requested.');}
      else if(action==='style'){this.actions.style(this.value('company-name'),this.value('colour'));this.message('Company style applied.');}
      else if(action==='save')this.message(await this.actions.save()?'World saved.':'Save failed. Export the world to keep a recovery copy.');
      else if(action==='main-menu'){if(!await this.actions.returnToMenu?.())this.message('Could not save. Stay here and export the world before leaving.');return;}
      else if(action==='export-world')this.download(await this.actions.exportWorld(),w.name+'.railworld');
      else if(action==='export-blueprint'&&this.draft)this.download(JSON.stringify(this.draft),this.draft.name+'.railblueprint');
      else if(action==='import-world'||action==='import-blueprint'){this.importKind=action==='import-world'?'world':'blueprint';this.fileInput.click();}
      this.render();this.refresh(0,true);
    }catch(e){this.pending=false;this.message(e instanceof Error?e.message:'Unable to complete this action.');}
  }
  private changeDraft(draft:BlueprintDraft|null):void{this.undoDrafts.push(this.draft?structuredClone(this.draft):null);if(this.undoDrafts.length>50)this.undoDrafts.shift();this.redoDrafts.length=0;this.draft=draft;this.actions.showDraft(draft);}
  private download(text:string,name:string):void{const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name.replace(/[<>:"/\\|?*]/g,'-');link.click();setTimeout(()=>URL.revokeObjectURL(url),500);this.message('Local export created.');}
}
function getFreightName(familyId:string|undefined,setId:string):string{return POWERED_VEHICLE_FAMILIES.find(f=>f.id===familyId)?.displayName??LAUNCH_FREIGHT_SETS.find(s=>s.id===setId)?.displayName??'Train';}
