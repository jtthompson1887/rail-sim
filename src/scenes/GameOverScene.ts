import Phaser from 'phaser';
import { LEVELS } from '../config/LevelData';
import { SaveService } from '../services/SaveService';

export default class GameOverScene extends Phaser.Scene {
  private levelId: string = 'level_01';

  constructor() {
    super({ key: 'GameOverScene' });
  }

  init(data: { won?: boolean; score?: number; levelId?: string }): void {
    this.registry.set('gameover.won', data.won ?? false);
    this.registry.set('gameover.score', data.score ?? 0);
    this.levelId = data.levelId ?? 'level_01';
  }

  create(): void {
    const won = this.registry.get('gameover.won') as boolean;
    const score = this.registry.get('gameover.score') as number;
    const { width, height } = this.scale;

    if (won) {
      const currentIndex = LEVELS.findIndex((level) => level.id === this.levelId);
      const nextLevel = LEVELS[currentIndex + 1];
      if (nextLevel) {
        SaveService.unlockLevel(nextLevel.id);
      }
    }

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.75);
    this.add.text(width / 2, height * 0.28, won ? 'Route Complete' : 'Game Over', { fontFamily: 'Verdana', fontSize: '60px', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(width / 2, height * 0.38, `Score: ${score}`, { fontFamily: 'Verdana', fontSize: '34px', color: '#ffe9a8' }).setOrigin(0.5);

    const restart = this.makeAction(width / 2, height * 0.52, 'Retry', () => {
      this.scene.stop('GameScene');
      this.scene.stop();
      this.scene.start('GameScene', { levelId: this.levelId });
    });
    const levels = this.makeAction(width / 2, height * 0.62, 'Level Select', () => {
      this.scene.stop('GameScene');
      this.scene.stop();
      this.scene.start('LevelSelectScene');
    });
    const menu = this.makeAction(width / 2, height * 0.72, 'Main Menu', () => {
      this.scene.stop('GameScene');
      this.scene.stop();
      this.scene.start('MenuScene');
    });

    restart.setPadding(12);
    levels.setPadding(12);
    menu.setPadding(12);
  }

  private makeAction(x: number, y: number, label: string, action: () => void): Phaser.GameObjects.Text {
    return this.add.text(x, y, label, { fontFamily: 'Verdana', fontSize: '32px', color: '#ffffff' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
  }
}
