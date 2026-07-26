import fs from 'fs';
import path from 'path';

describe('construction drag browser harness composition', () => {
  it('uses the production construction stack and an actual Phaser scene', () => {
    const entry = fs.readFileSync(
      path.resolve(__dirname, 'construction-drag-browser-entry.ts'),
      'utf8',
    );
    const runner = fs.readFileSync(
      path.resolve(__dirname, 'run-construction-drag-browser.js'),
      'utf8',
    );

    for (const productionType of [
      'new Phaser.Game',
      'new TrackManager',
      'new SnapSystem',
      'new ConstructionAnalyzer',
      'new ConstructionService',
      'new CommandStack',
      'new PlaceTrackTool',
      'WorldManager.createNew',
    ]) {
      expect(entry).toContain(productionType);
    }
    expect(entry).not.toMatch(/function graphics|const constructionService = \{/);
    expect(entry).toContain("this.input.on('pointermove'");
    expect(entry).not.toContain('as Phaser.Input.Pointer');
    expect(runner).toContain("externals: { phaser: 'Phaser' }");
    expect(runner).toContain("phaser/dist/phaser.js");
    expect(runner).toContain('page.mouse.move');
  });
});
