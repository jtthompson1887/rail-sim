import { validateWorldData, type WorldValidationResult, type TrackDef } from '../config/WorldData';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';

/** Only schema 10 is migrated. Validation still rejects malformed and newer worlds. */
export function migrateWorldData(raw: unknown): WorldValidationResult {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return validateWorldData(raw);
    const record = raw as Record<string, any>;
    if (record.schemaVersion !== 10) return validateWorldData(raw);
    const migrated = JSON.parse(JSON.stringify(record));
    if (!Array.isArray(migrated.tracks) || !Array.isArray(migrated.trains)) {
      return invalid(raw, 'the schema-10 world has invalid track or train data.');
    }
    const tracks = new Map<string, TrackDef>(migrated.tracks.map((track: TrackDef) => [track.uuid, track]));
    for (const train of migrated.trains) {
      // Schema 10 had no dynamics. Do not silently replace suspicious extra state.
      if ('dynamics' in train || !Number.isFinite(train.trackT) || train.trackT < 0 || train.trackT > 1
        || (train.facing !== 1 && train.facing !== -1)) {
        return invalid(raw, 'the schema-10 train position is invalid.');
      }
      const track = tracks.get(train.trackUUID);
      if (!track) return invalid(raw, 'the schema-10 train references a missing track.');
      const index = new TrackArcLengthIndex(track, TRAIN_PHYSICS_CONFIG.arcSampleSpacing);
      train.dynamics = {
        mode: 'on-rail', trackUUID: train.trackUUID,
        distance: index.distanceAtParameter(train.trackT), direction: train.facing,
        speedMps: 0, consistId: `consist-${train.id}`, consistOrder: 0,
      };
    }
    migrated.schemaVersion = 11;
    return validateWorldData(migrated);
  } catch {
    return invalid(raw, 'malformed saved data.');
  }
}

function invalid(raw: unknown, reason: string): WorldValidationResult {
  const record = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  return {
    compatible: false, id: typeof record.id === 'string' ? record.id : null,
    storageId: null, name: typeof record.name === 'string' ? record.name : 'Incompatible save',
    updatedAt: Number.isFinite(record.metadata?.updatedAt) ? record.metadata.updatedAt : 0,
    message: `This save is incompatible: ${reason}`, action: 'Start a new world.',
  };
}
