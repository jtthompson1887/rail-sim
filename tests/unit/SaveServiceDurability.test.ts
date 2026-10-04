import { GameConfig } from '../../src/config/GameConfig';
import { createEmptyWorld } from '../../src/config/WorldData';
import { SaveRepository, worldStoragePrefix } from '../../src/persistence/SaveRepository';
import { MemoryStorage } from '../../src/persistence/StoragePort';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import type { SaveService as SaveServiceType } from '../../src/services/SaveService';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';
import { emptyBlueprint, quoteBlueprint, applyBlueprintPurchase } from '../../src/management/BlueprintService';
import { createFleetProposal, createPlatformProposal } from '../../src/management/RailwayPurchases';
import { createManagementState } from '../../src/simulation/SimulationTypes';
import { clonePlainData } from '../../src/utils/PlainData';

const makeWorld = () => createEmptyWorld('Native railway', 'durable-facade', 'temperate', makeStarterOpportunity('durable-facade'));

describe('SaveService synchronous cache and durable acknowledgement', () => {
  let service: typeof SaveServiceType;
  beforeEach(() => {
    jest.resetModules();
    service = require('../../src/services/SaveService').SaveService;
    localStorage.clear();
    let sequence = 0;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `durable-facade-world-${sequence++}` });
  });

  it('cannot select legacy fixture persistence outside a test-controls build', () => {
    expect(() => service.useLegacyPersistenceForAcceptanceTests()).toThrow('disabled in production');
  });

  it('hydrates and migrates prototype worlds while keeping original storage byte-for-byte', async () => {
    const legacy = JSON.parse(JSON.stringify(makeWorld()));
    legacy.schemaVersion = 10;
    const original = JSON.stringify({ [legacy.id]: legacy });
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, original);
    const storage = new MemoryStorage();
    await service.initialize(storage);
    expect(service.loadWorld(legacy.id).schemaVersion).toBe(11);
    expect(service.getStorageKind()).toBe('memory');
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toBe(original);
    expect(await storage.read(`${worldStoragePrefix(legacy.id)}original-schema10`)).toBe(JSON.stringify(legacy));
    expect((await new SaveRepository(storage).load(legacy.id)).world.schemaVersion).toBe(11);
  });

  it('keeps original worlds accessible after native initialization fails without acknowledging fallback writes', async () => {
    const legacy = JSON.parse(JSON.stringify(makeWorld()));
    legacy.schemaVersion = 10;
    const original = JSON.stringify({ [legacy.id]: legacy });
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, original);
    const storage = new MemoryStorage();
    const list = storage.list.bind(storage);
    storage.list = async () => { throw new Error('native storage unavailable'); };
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(service.initialize(storage)).rejects.toThrow('native storage unavailable');
      const source = service.loadWorld(legacy.id)!;
      expect(source.schemaVersion).toBe(11);
      source.name = 'Unsaved recovery copy';
      expect(service.saveWorld(source)).toBe(false);
      await expect(service.flush()).rejects.toThrow('native storage unavailable');
      expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toBe(original);
      storage.list = list;
      await service.initialize(storage);
      expect(service.saveWorld(source)).toBe(true);
      await expect(service.flush()).resolves.toBeUndefined();
      expect((await new SaveRepository(storage).load(source.id)).world!.name).toBe(source.name);
      expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toBe(original);
    } finally { log.mockRestore(); }
  });

  it('publishes asynchronous quota failures, preserves the last durable copy, and allows retry', async () => {
    const storage = new MemoryStorage();
    await service.initialize(storage);
    const source = makeWorld();
    expect(service.saveWorld(source)).toBe(true);
    await service.flush();
    const changes: Array<string | null> = [];
    const unsubscribe = service.onPersistenceError((message) => changes.push(message));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const write = storage.write.bind(storage);
    storage.write = async () => { throw new Error('storage full'); };
    source.name = 'Accepted but not yet durable';
    expect(service.saveWorld(source)).toBe(true);
    await expect(service.flush()).rejects.toThrow('storage full');
    expect(service.getPersistenceError()).toBe('storage full');
    expect(changes).toContain('storage full');
    expect((await new SaveRepository(storage).load(source.id)).world.name).toBe('Native railway');
    storage.write = write;
    expect(service.saveWorld(source)).toBe(true);
    await service.flush();
    expect(service.getPersistenceError()).toBeNull();
    expect(changes[changes.length - 1]).toBeNull();
    unsubscribe(); log.mockRestore();
  });

  it('does not resurrect deleted worlds from retained prototype originals after restarting', async () => {
    const source = makeWorld();
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify({ [source.id]: source }));
    const storage = new MemoryStorage();
    await service.initialize(storage);
    service.deleteWorld(source.id);
    await service.flush();
    await service.initialize(storage);
    expect(service.loadWorld(source.id)).toBeNull();
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toContain(source.id);
  });

  it('keeps durable acknowledgements independent of failing interface listeners', async () => {
    const storage = new MemoryStorage();
    await service.initialize(storage);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const remove = service.onPersistenceError(() => { throw new Error('Panel is no longer mounted'); });
    const source = makeWorld();
    const write = storage.write.bind(storage);
    try {
      expect(service.saveWorld(source)).toBe(true);
      await expect(service.flush()).resolves.toBeUndefined();
      expect(service.getPersistenceError()).toBeNull();
      storage.write = async () => { throw new Error('disk full'); };
      expect(service.saveWorld(source)).toBe(true);
      await expect(service.flush()).rejects.toThrow('disk full');
      expect(service.getPersistenceError()).toBe('disk full');
      storage.write = write;
      expect(service.saveWorld(source)).toBe(true);
      await expect(service.flush()).resolves.toBeUndefined();
      expect(service.getPersistenceError()).toBeNull();
    } finally { remove(); log.mockRestore(); }
  });

  it('keeps incompatible worlds visible and duplicate imports preserve the existing world', async () => {
    const source = makeWorld();
    const unsupported = { ...source, id: 'future', schemaVersion: 12 };
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify({ future: unsupported }));
    await service.initialize(new MemoryStorage());
    expect(service.listWorldResults()[0].compatible).toBe(false);
    expect(service.saveWorld(source)).toBe(true);
    const duplicate = service.importWorld(service.exportWorld(source));
    expect(duplicate.id).not.toBe(source.id);
    expect(service.loadWorld(source.id)).not.toBeNull();
    await service.flush();
  });

  it('rebases only owned saved alternatives on duplicate import and builds them after normal revalidation', async () => {
    const storage=new MemoryStorage();await service.initialize(storage);
    const source=makeFirstFreightRouteWorld();source.management=createManagementState();source.management.speed=0;
    const owned=emptyBlueprint(source,'Owned extension'),track=clonePlainData(source.tracks[0]);
    track.uuid='planned-extension';track.p0={x:500,y:0};track.p1={x:800,y:0};track.p2={x:1100,y:0};track.p3={x:1400,y:0};
    owned.tracks.push(track);
    const proposed=clonePlainData(source);proposed.tracks.push(track);
    const train=createFleetProposal(proposed,'diesel-shunter','flatbed-freight-set',track.uuid,.5).train;
    owned.trains.push(train);owned.stations.push(createPlatformProposal(proposed,'Extension platform',track.uuid,.5,30).station);
    owned.services.push({id:'planned-freight',name:'Extension shuttle',trainId:train.id,kind:'freight',enabled:true,
      stops:[{targetKind:'facility',targetId:'managed-forest',loadRule:'available',maxWaitSeconds:30},
        {targetKind:'facility',targetId:'sawmill',loadRule:'unload',maxWaitSeconds:30}],
      frequencySeconds:0,departureOffsetSeconds:0,priority:1});
    const foreign=clonePlainData(owned);foreign.id='foreign-alternative';foreign.name='Foreign extension';foreign.sourceWorldId='another-region';
    source.blueprints=[owned,foreign];
    expect(service.saveWorld(source)).toBe(true);await service.flush();
    const json=service.exportWorld(source),original=clonePlainData(source),originalStored=clonePlainData(service.loadWorld(source.id));
    const imported=service.importWorld(json)!;expect(imported).not.toBeNull();expect(imported.id).not.toBe(source.id);
    const importedOwned=imported.blueprints![0],importedForeign=imported.blueprints![1];
    expect(importedOwned).toEqual({...owned,sourceWorldId:imported.id});expect(importedForeign).toEqual(foreign);
    expect(imported.revision).toBe(source.revision);expect(imported.constructionRevision).toBe(source.constructionRevision);
    expect(imported.operationsRevision).toBe(source.operationsRevision);expect(imported.schemaVersion).toBe(source.schemaVersion);
    expect(imported.tracks).toEqual(source.tracks);expect(imported.trains).toEqual(source.trains);expect(imported.company).toEqual(source.company);
    await service.flush();
    expect(await storage.read(`${worldStoragePrefix(imported.id)}original-import`)).toBe(json);
    const durable=await new SaveRepository(storage).load(imported.id);expect(durable.world!.blueprints).toEqual(imported.blueprints);
    expect(quoteBlueprint(imported,importedForeign,{getHeightAt:()=>0}).errors).toContain('This sketch belongs to another region.');
    const quote=quoteBlueprint(imported,importedOwned,{getHeightAt:()=>0});expect(quote.errors).toEqual([]);
    expect(applyBlueprintPurchase(imported,quote)).toBe(true);
    expect(imported.tracks.find(t=>t.uuid===track.uuid)).toMatchObject({p0:track.p0,p1:track.p1,p2:track.p2,p3:track.p3});
    expect(imported.trains.find(t=>t.id===train.id)?.trackUUID).toBe(track.uuid);
    expect(imported.stations.find(s=>s.id===owned.stations[0].id)?.trackUUID).toBe(track.uuid);
    expect(imported.management!.services.find(s=>s.id==='planned-freight')).toEqual(owned.services[0]);
    expect(source).toEqual(original);expect(service.loadWorld(source.id)).toEqual(originalStored);expect(service.exportWorld(source)).toBe(json);
  });

  it('preserves a schema-10 original when the legacy synchronous caller saves its migrated world', () => {
    const legacy = JSON.parse(JSON.stringify(makeWorld()));
    legacy.schemaVersion = 10;
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify({ [legacy.id]: legacy }));
    const migrated = service.loadWorld(legacy.id);
    expect(service.saveWorld(migrated)).toBe(true);
    expect(localStorage.getItem(`${GameConfig.WORLD.WORLDS_SAVE_KEY}:original-schema10:${legacy.id}`)).toBe(JSON.stringify(legacy));
  });

  it('does not replace a future-format original through the synchronous facade', () => {
    const source = makeWorld();
    const original = JSON.stringify({ [source.id]: { ...source, schemaVersion: 12 } });
    localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, original);
    expect(service.saveWorld(source)).toBe(false);
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toBe(original);
  });
});
