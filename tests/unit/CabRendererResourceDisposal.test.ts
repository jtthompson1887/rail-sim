import { TrackMeshBuilder } from '../../src/cab3d/renderer/TrackMeshBuilder';
import { TerrainMeshBuilder } from '../../src/cab3d/renderer/TerrainMeshBuilder';
import { SceneryInstanceBuilder } from '../../src/cab3d/renderer/SceneryInstanceBuilder';

describe('cab renderer rebuilding resource disposal', () => {
  it.each([
    ['track', TrackMeshBuilder],
    ['terrain', TerrainMeshBuilder],
    ['scenery', SceneryInstanceBuilder],
  ] as const)('%s builder releases child materials and textures', (
    _name,
    Builder,
  ) => {
    const builder = new Builder({} as never);
    const root = { dispose: jest.fn() };
    (builder as unknown as { root: typeof root }).root = root;

    builder.dispose();

    expect(root.dispose).toHaveBeenCalledWith(false, true);
  });
});
