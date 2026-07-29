import type { TrainDef } from '../config/WorldData';
import type { TrainRuntimeSnapshot } from '../freight/TrainRuntime';
import { clonePlainData } from './PlainData';

export class TrainSerializer {
  static mergeRuntime(
    authoritative: TrainDef,
    runtime: TrainRuntimeSnapshot,
  ): TrainDef | null {
    if (runtime.trainId !== authoritative.id
      || runtime.derailed
      || runtime.trackUUID === null
      || runtime.trackT === null
      || !Number.isFinite(runtime.trackT)
      || runtime.trackT < 0
      || runtime.trackT > 1) {
      return null;
    }

    return {
      ...authoritative,
      trackUUID: runtime.trackUUID,
      trackT: runtime.trackT,
      facing: runtime.facing,
      cargo: clonePlainData(authoritative.cargo),
      operations: clonePlainData(authoritative.operations),
    };
  }
}
