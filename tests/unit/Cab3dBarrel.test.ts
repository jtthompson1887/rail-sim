import {
  CabViewHost,
  CabConfig,
  PhaserCabSnapshotSource,
} from '../../src/cab3d';

describe('cab3d public barrel', () => {
  it('exports the host, config, and snapshot source', () => {
    expect(CabViewHost).toBeInstanceOf(Function);
    expect(CabConfig).toBeDefined();
    expect(PhaserCabSnapshotSource).toBeInstanceOf(Function);
  });
});
