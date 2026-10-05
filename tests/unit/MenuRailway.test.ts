import { createRiversideRegion } from '../../src/region/RiversideRegion';
import { createMenuRailwaySession } from '../../src/presentation/MenuRailway';

describe('Detached title railway', () => {
  it('runs real services without changing the supplied world', () => {
    const world = createRiversideRegion();
    const original = JSON.stringify(world);
    const session = createMenuRailwaySession(world);
    const before = session.getTrainSnapshots();
    for (let i = 0; i < 10; i++) session.advance(1000);
    expect(session.clockSeconds).toBeCloseTo(100);
    expect(session.getTrainSnapshots().some((train, i) => Math.hypot(train.x - before[i].x, train.y - before[i].y) > 10)).toBe(true);
    expect(session.getTrainSnapshots().every(train => !train.derailed)).toBe(true);
    expect(JSON.stringify(world)).toBe(original);
    expect(world.management.speed).toBe(0);
  });
});
