import type { WorldData } from '../config/WorldData';
import { migrateWorldData } from './WorldMigration';
import type { StoragePort } from './StoragePort';

interface SaveEnvelope {
  formatVersion: 1;
  worldId: string;
  sequence: number;
  writtenAt: number;
  payload: string;
  checksum: string;
}
interface Candidate { key: string; envelope: SaveEnvelope; raw: unknown }
export interface SaveRecovery {
  world: WorldData | null;
  raw: unknown | null;
  recovered: boolean;
  warnings: string[];
}

/** Portable corruption detection; intentionally not an authenticity/security signature. */
export function saveChecksum(payload: string): string {
  let crc = 0xffffffff;
  for (let index = 0; index < payload.length; index++) {
    const code = payload.charCodeAt(index);
    for (const byte of [code & 255, code >>> 8]) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return `crc32-utf16:${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')}`;
}

export function worldStoragePrefix(id: string): string {
  let encoded = '';
  for (let index = 0; index < id.length; index++) encoded += id.charCodeAt(index).toString(16).padStart(4, '0');
  return `world-${encoded}.`;
}

function idFromStorageKey(key: string): string | null {
  const match = /^world-((?:[0-9a-f]{4})+)\.(?:slot-[ab]|backup-[01])$/.exec(key);
  if (!match) return null;
  return match[1].match(/.{4}/g).map((part) => String.fromCharCode(parseInt(part, 16))).join('');
}

/** Four recovery files per world, serialized writes, originals retained once. */
export class SaveRepository {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, Error>();
  private importQueue: Promise<void> = Promise.resolve();
  constructor(readonly storage: StoragePort, private readonly onFailure?: (error: Error) => void) {}

  async load(id: string): Promise<SaveRecovery> {
    await this.queues.get(id);
    return this.readRecovery(id);
  }

  async loadAllRaw(): Promise<Record<string, unknown>> {
    const all: Record<string, unknown> = Object.create(null);
    const ids = new Set<string>();
    for (const key of await this.storage.list('world-')) {
      if (!/\.(slot-[ab]|backup-[01])$/.test(key)) continue;
      const id = idFromStorageKey(key);
      if (id !== null) ids.add(id);
    }
    for (const id of ids) {
      const recovered = await this.load(id);
      if (recovered.raw !== null) all[id] = recovered.world ?? recovered.raw;
      else if (recovered.warnings.length) {
        // Keep damaged saves visible, and prevent migration from resurrecting an older original.
        all[id] = { id, name: 'Damaged save', schemaVersion: 11, metadata: { updatedAt: 0 } };
      }
    }
    return all;
  }

  save(world: WorldData, original?: { json: string; label: 'schema10' | 'import' }): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(world)) as WorldData;
    return this.enqueue(world.id, async () => {
      if (original) await this.preserveOriginal(snapshot.id, original.json, original.label);
      await this.writeSnapshot(snapshot);
    });
  }

  /** Import never replaces a currently stored world with the same id. */
  import(json: string): Promise<WorldData> {
    const result = this.importQueue.then(() => this.importSnapshot(json));
    this.importQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async importSnapshot(json: string): Promise<WorldData> {
    const raw = JSON.parse(json);
    const validation = migrateWorldData(raw);
    if (validation.compatible === false) throw new Error(validation.message);
    const world = JSON.parse(JSON.stringify(validation.world)) as WorldData;
    if ((await this.load(world.id)).raw !== null) {
      const freshId = createImportedWorldId();
      world.id = freshId;
      let suffix = 1;
      while ((await this.load(world.id)).raw !== null) world.id = `${freshId}-${suffix++}`;
    }
    await this.save(world, { json, label: 'import' });
    return world;
  }

  export(world: WorldData): string { return JSON.stringify(world, null, 2); }

  async preserveOriginal(id: string, json: string, label: 'schema10' | 'import'): Promise<void> {
    const key = `${worldStoragePrefix(id)}original-${label}`;
    if (await this.storage.read(key) === null) await this.storage.write(key, json);
  }

  remove(id: string): Promise<void> {
    return this.enqueue(id, async () => {
      const tombstone = `${worldStoragePrefix(id)}deleted`;
      await this.storage.write(tombstone, 'deleted');
      for (const key of await this.storage.list(worldStoragePrefix(id))) {
        if (key !== tombstone) await this.storage.remove(key);
      }
    });
  }

  async isDeleted(id: string): Promise<boolean> {
    return await this.storage.read(`${worldStoragePrefix(id)}deleted`) !== null;
  }

  async flush(): Promise<void> {
    // A save can arrive while an earlier save is completing.
    let imports: Promise<void>;
    do {
      imports = this.importQueue;
      await imports;
      while (this.queues.size) await Promise.all([...this.queues.values()]);
    } while (imports !== this.importQueue);
    const failure = this.failures.values().next().value;
    if (failure) throw failure;
  }

  private enqueue(id: string, operation: () => Promise<void>): Promise<void> {
    const prior = this.queues.get(id) ?? Promise.resolve();
    const result = prior.then(operation);
    const continued = result.then(() => {
      this.failures.delete(id);
    }, (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.failures.set(id, error);
      // Presentation failures must never strand the authoritative write queue.
      try { this.onFailure?.(error); }
      catch (callbackError) { console.error('Save failure callback failed', callbackError); }
    }).then(() => {
      if (this.queues.get(id) === continued) this.queues.delete(id);
    });
    this.queues.set(id, continued);
    return result;
  }

  private async candidates(id: string): Promise<{ candidates: Candidate[]; warnings: string[]; futureFormat: boolean }> {
    const candidates: Candidate[] = [];
    const warnings: string[] = [];
    let futureFormat = false;
    for (const suffix of ['slot-a', 'slot-b', 'backup-0', 'backup-1']) {
      const key = `${worldStoragePrefix(id)}${suffix}`;
      const text = await this.storage.read(key);
      if (text === null) continue;
      try {
        const envelope = JSON.parse(text) as SaveEnvelope;
        if ((envelope.formatVersion as number) > 1) {
          futureFormat = true;
          throw new Error('Newer save container format');
        }
        if (envelope.formatVersion !== 1 || envelope.worldId !== id
          || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1
          || typeof envelope.payload !== 'string' || envelope.checksum !== saveChecksum(envelope.payload)) {
          throw new Error('Invalid save envelope or checksum');
        }
        const raw = JSON.parse(envelope.payload);
        if (!raw || raw.id !== id) throw new Error('Save id mismatch');
        candidates.push({ key, envelope, raw });
      } catch { warnings.push(`Damaged recovery file: ${suffix}`); }
    }
    candidates.sort((left, right) => right.envelope.sequence - left.envelope.sequence);
    return { candidates, warnings, futureFormat };
  }

  private async readRecovery(id: string): Promise<SaveRecovery> {
    if (await this.isDeleted(id)) return { world: null, raw: null, recovered: false, warnings: [] };
    const { candidates, warnings } = await this.candidates(id);
    for (const [index, candidate] of candidates.entries()) {
      const result = migrateWorldData(candidate.raw);
      if (result.compatible) {
        return { world: result.world, raw: candidate.raw,
          recovered: warnings.length > 0 || index > 0 || candidate.key.includes('backup-'), warnings };
      }
      if (result.compatible === false) warnings.push(result.message);
    }
    return { world: null, raw: candidates[0]?.raw ?? null, recovered: false, warnings };
  }

  private async writeSnapshot(world: WorldData): Promise<void> {
    const validation = migrateWorldData(world);
    if (validation.compatible === false) throw new Error(validation.message);
    const { candidates, futureFormat } = await this.candidates(world.id);
    if (futureFormat || candidates.some(({ raw }) => (raw as any).schemaVersion > 11)) {
      throw new Error('A newer save format exists. Export the recovered world instead of overwriting it.');
    }
    const sequence = (candidates[0]?.envelope.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('Save sequence exhausted');
    const previous = candidates.find(({ raw }) => migrateWorldData(raw).compatible);
    if (previous) {
      if ((previous.raw as any).schemaVersion === 10) {
        await this.preserveOriginal(world.id, previous.envelope.payload, 'schema10');
      }
      await this.storage.write(`${worldStoragePrefix(world.id)}backup-${sequence % 2}`, JSON.stringify(previous.envelope));
    }
    const payload = JSON.stringify(world);
    const envelope: SaveEnvelope = {
      formatVersion: 1, worldId: world.id, sequence, writtenAt: Date.now(), payload, checksum: saveChecksum(payload),
    };
    const key = `${worldStoragePrefix(world.id)}slot-${sequence % 2 === 0 ? 'a' : 'b'}`;
    await this.storage.write(key, JSON.stringify(envelope));
    const written = await this.storage.read(key);
    if (written !== JSON.stringify(envelope)) throw new Error('Save verification failed; previous generation retained.');
    await this.storage.remove(`${worldStoragePrefix(world.id)}deleted`);
  }
}

export function createImportedWorldId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
