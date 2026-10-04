import type { RehearsalRequest, RehearsalResult } from '../simulation/SimulationTypes';

/** A separate packaged worker owns rehearsal. A cancellable async fallback supports test hosts. */
export class RehearsalClient {
  private worker: Worker | null = null;
  private requestId: string | null = null;
  private cancelFallback: (()=>void) | null = null;
  async run(request: RehearsalRequest): Promise<RehearsalResult> {
    this.cancel();this.requestId=request.requestId;
    if(typeof Worker!=='undefined'){
      const worker=new Worker(new URL('rehearsal-worker.js',document.baseURI));this.worker=worker;
      return new Promise((resolve,reject)=>{
        worker.onmessage=(event:MessageEvent)=>{if(event.data.requestId!==request.requestId&&event.data.result?.requestId!==request.requestId)return;
          worker.terminate();if(this.worker===worker){this.worker=null;this.requestId=null;}
          if(event.data.type==='result')resolve(event.data.result);else reject(new Error(event.data.message??'Rehearsal failed.'));};
        worker.onerror=()=>{worker.terminate();this.worker=null;this.requestId=null;reject(new Error('The rehearsal worker could not start.'));};
        worker.postMessage({type:'run',request});
      });
    }
    const {createRehearsal}=await import('../simulation/Rehearsal');const rehearsal=createRehearsal(request);this.cancelFallback=()=>rehearsal.cancel();
    return new Promise(resolve=>{const tick=()=>{if(rehearsal.step(1)){this.cancelFallback=null;resolve(rehearsal.result());}else setTimeout(tick,0);};tick();});
  }
  cancel():void{if(this.worker&&this.requestId)this.worker.postMessage({type:'cancel',requestId:this.requestId});this.cancelFallback?.();}
}
