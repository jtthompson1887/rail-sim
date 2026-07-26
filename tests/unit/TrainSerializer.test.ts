import { TrainSerializer } from '../../src/utils/TrainSerializer';

describe('TrainSerializer', () => {
  it('does not expose a legacy live-vehicle to authoritative-train serializer', () => {
    expect((TrainSerializer as any).toTrainDef).toBeUndefined();
  });
});
