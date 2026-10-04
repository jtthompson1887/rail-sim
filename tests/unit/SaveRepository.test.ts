import { createEmptyWorld, type WorldData } from '../../src/config/WorldData';
import { TrackArcLengthIndex } from '../../src/physics/TrackArcLengthIndex';
import { SaveRepository, saveChecksum, worldStoragePrefix } from '../../src/persistence/SaveRepository';
import { MemoryStorage } from '../../src/persistence/StoragePort';
import { migrateWorldData } from '../../src/persistence/WorldMigration';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';

function world(id = 'durable-world'): WorldData {
  const value = createEmptyWorld('Durable railway', 'save-tests', 'temperate', makeStarterOpportunity('save-tests'));
  value.id = id;
  value.tracks.push({
    geometryVersion: 1, uuid: 'rail', p0: { x: 0, y: 0 }, p1: { x: 100, y: 100 },
    p2: { x: 200, y: -100 }, p3: { x: 300, y: 0 }, paidBuildCost: 1200,
    verticalProfile: { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
    structures: [{ type: 'surface', startT: 0, endT: 1, startElevation: 0, endElevation: 0 }],
  });
  value.trains.push({
    id: 'freight', freightSetId: 'flatbed-freight-set', trackUUID: 'rail', trackT: 0.4, facing: -1,
    cargo: null,
    operations: { currentTripRevenue: 0, currentTripRunningCost: 0, lastTripRevenue: 0,
      lastTripRunningCost: 0, lifetimeDeliveredUnits: 0, lifetimeRevenue: 0, lifetimeRunningCost: 0 },
    dynamics: { mode: 'on-rail', trackUUID: 'rail', distance: 100, direction: -1,
      speedMps: 0, consistId: 'consist-freight', consistOrder: 0 },
  });
  return value;
}

function envelope(raw: any, sequence: number, formatVersion = 1): string {
  const payload = JSON.stringify(raw);
  return JSON.stringify({ formatVersion, worldId: raw.id, sequence, writtenAt: 0, payload, checksum: saveChecksum(payload) });
}

describe('SaveRepository durable generations', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'fixture-generated-id' });
  });

  it('checksums Unicode and detects a one-character change', () => {
    expect(saveChecksum('🚂 Côte')).toBe(saveChecksum('🚂 Côte'));
    expect(saveChecksum('🚂 Côte')).not.toBe(saveChecksum('🚂 Cote'));
  });

  it('serializes queued writes and captures immutable submission snapshots', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    const saves = [];
    for (let index = 0; index < 20; index++) {
      source.name = `Generation ${index}`;
      saves.push(repository.save(source));
    }
    source.name = 'Changed after enqueue';
    await repository.flush();
    await Promise.all(saves);
    expect((await repository.load(source.id)).world.name).toBe('Generation 19');
    expect(await storage.list(worldStoragePrefix(source.id))).toHaveLength(4);
  });

  it('recovers the previous valid generation after checksum corruption', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    await repository.save(source);
    source.name = 'Newest';
    await repository.save(source);
    const key = `${worldStoragePrefix(source.id)}slot-a`;
    storage.files.set(key, storage.files.get(key).replace('Newest', 'Damaged'));
    const recovered = await repository.load(source.id);
    expect(recovered.world.name).toBe('Durable railway');
    expect(recovered.recovered).toBe(true);
    expect(recovered.warnings).toHaveLength(1);
  });

  it('falls back to a bounded backup when both slots are truncated', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    for (let index = 0; index < 4; index++) { source.name = `World ${index}`; await repository.save(source); }
    storage.files.set(`${worldStoragePrefix(source.id)}slot-a`, '{');
    storage.files.set(`${worldStoragePrefix(source.id)}slot-b`, '{');
    const recovered = await repository.load(source.id);
    expect(recovered.world.name).toBe('World 2');
    expect(recovered.recovered).toBe(true);
    expect(Object.keys(await repository.loadAllRaw())).toEqual([source.id]);
  });

  it('keeps a damaged save discoverable when every recovery file is unreadable', async () => {
    const storage = new MemoryStorage();
    const source = world();
    storage.files.set(`${worldStoragePrefix(source.id)}slot-b`, '{interrupted');
    const repository = new SaveRepository(storage);
    expect((await repository.load(source.id)).world).toBeNull();
    expect((await repository.loadAllRaw())[source.id]).toHaveProperty('name', 'Damaged save');
  });

  it('retains a valid copy when the device fails in the middle of a write', async () => {
    const storage = new MemoryStorage();
    const failure = jest.fn();
    const repository = new SaveRepository(storage, failure);
    const source = world();
    await repository.save(source);
    const originalWrite = storage.write.bind(storage);
    storage.write = async (key, value) => {
      if (key.endsWith('slot-a')) { storage.files.set(key, value.slice(0, 80)); throw new Error('device suspended'); }
      await originalWrite(key, value);
    };
    source.name = 'Interrupted';
    await expect(repository.save(source)).rejects.toThrow('device suspended');
    await expect(repository.flush()).rejects.toThrow('device suspended');
    expect(failure).toHaveBeenCalledTimes(1);
    expect((await repository.load(source.id)).world.name).toBe('Durable railway');
    storage.write = originalWrite;
    await repository.save(source);
    await expect(repository.flush()).resolves.toBeUndefined();
    expect((await repository.load(source.id)).world.name).toBe('Interrupted');
  });

  it('rejects silent storage loss through post-write verification', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    await repository.save(source);
    storage.write = async () => undefined;
    await expect(repository.save(source)).rejects.toThrow('verification failed');
    expect((await repository.load(source.id)).world).not.toBeNull();
  });

  it('can retry a failed write even when the error presentation callback throws', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage, () => { throw new Error('Inspector already destroyed'); });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = world();
    const write = storage.write.bind(storage);
    storage.write = async () => { throw new Error('disk full'); };
    try {
      await expect(repository.save(source)).rejects.toThrow('disk full');
      await expect(repository.flush()).rejects.toThrow('disk full');
      storage.write = write;
      await repository.save(source);
      await expect(repository.flush()).resolves.toBeUndefined();
      expect((await repository.load(source.id)).world.id).toBe(source.id);
    } finally { log.mockRestore(); }
  });

  it('refuses to overwrite unknown newer schemas and container formats', async () => {
    for (const format of ['schema', 'container']) {
      const storage = new MemoryStorage();
      const source = world();
      const repository = new SaveRepository(storage);
      await repository.save(source);
      const future = JSON.parse(JSON.stringify(source));
      if (format === 'schema') future.schemaVersion = 12;
      const key = `${worldStoragePrefix(source.id)}slot-a`;
      const original = envelope(future, 2, format === 'container' ? 2 : 1);
      storage.files.set(key, original);
      expect((await repository.load(source.id)).world).not.toBeNull();
      await expect(repository.save(source)).rejects.toThrow('newer save format');
      expect(storage.files.get(key)).toBe(original);
    }
  });

  it('imports collisions under a fresh id and preserves the imported original', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    await repository.save(source);
    const imported = await repository.import(repository.export(source));
    expect(imported.id).not.toBe(source.id);
    expect(await storage.read(`${worldStoragePrefix(imported.id)}original-import`)).toBe(repository.export(source));
    expect((await repository.load(source.id)).world.id).toBe(source.id);
    expect((await repository.load(imported.id)).world.name).toBe(source.name);
    await expect(repository.import('bad-json')).rejects.toThrow();
  });

  it('serializes concurrent imports even when the id generator repeats', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    const json = repository.export(source);
    const imported = await Promise.all([repository.import(json), repository.import(json), repository.import(json)]);
    expect(new Set(imported.map(({ id }) => id)).size).toBe(3);
    expect(Object.keys(await repository.loadAllRaw())).toHaveLength(3);
  });

  it('keeps imported world ids that match JavaScript prototype keys as ordinary saves', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    for (const id of ['__proto__', 'constructor', 'toString']) await repository.save(world(id));
    const recovered = await repository.loadAllRaw();
    expect(Object.getPrototypeOf(recovered)).toBeNull();
    expect(Object.keys(recovered).sort()).toEqual(['__proto__', 'constructor', 'toString'].sort());
    expect((recovered.__proto__ as WorldData).id).toBe('__proto__');
    const duplicate = await repository.import(repository.export(world('__proto__')));
    expect(duplicate.id).not.toBe('__proto__');
    expect((await repository.load('__proto__')).world.id).toBe('__proto__');
  });

  it('deletes generations with a durable tombstone and permits explicit restoration', async () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    const source = world();
    await repository.save(source);
    await repository.remove(source.id);
    expect(await repository.isDeleted(source.id)).toBe(true);
    expect((await repository.load(source.id)).raw).toBeNull();
    expect(await repository.loadAllRaw()).toEqual({});
    await repository.save(source);
    expect(await repository.isDeleted(source.id)).toBe(false);
    expect((await repository.load(source.id)).world).not.toBeNull();
  });

  it('migrates schema 10 with arc length, facing and zero speed while preserving finances and the source', async () => {
    const original = JSON.parse(JSON.stringify(world()));
    original.schemaVersion = 10;
    delete original.trains[0].dynamics;
    const originalJson = JSON.stringify(original);
    const migrated = migrateWorldData(original);
    expect(migrated.compatible).toBe(true);
    if (migrated.compatible === false) throw new Error(migrated.message);
    const train = migrated.world.trains[0];
    expect(train.dynamics).toMatchObject({ mode: 'on-rail', direction: -1, speedMps: 0, consistId: 'consist-freight' });
    expect((train.dynamics as any).distance).toBeCloseTo(new TrackArcLengthIndex(original.tracks[0], 4).distanceAtParameter(0.4));
    expect(migrated.world.company).toEqual(original.company);
    expect(migrated.world.economy).toEqual(original.economy);
    expect(JSON.stringify(original)).toBe(originalJson);
    const storage = new MemoryStorage();
    storage.files.set(`${worldStoragePrefix(original.id)}slot-b`, envelope(original, 1));
    const repository = new SaveRepository(storage);
    await repository.save(migrated.world);
    expect(await storage.read(`${worldStoragePrefix(original.id)}original-schema10`)).toBe(originalJson);
  });

  it.each([
    { schemaVersion: 10, tracks: [], trains: {} },
    { schemaVersion: 11, trains: {} },
    { schemaVersion: 12 },
    null,
  ])('rejects malformed/unsupported input without throwing (%p)', (raw) => {
    expect(migrateWorldData(raw).compatible).toBe(false);
  });
});
