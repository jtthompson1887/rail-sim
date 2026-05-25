import Phaser from 'phaser';
import { LEVELS } from '../config/LevelData';
import { SaveService } from '../services/SaveService';

export default class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LevelSelectScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x06131f, 1);
    this.add.text(width / 2, 80, 'Select Route', { fontFamily: 'Verdana', fontSize: '52px', color: '#ffffff' }).setOrigin(0.5);

    LEVELS.forEach((level, index) => {
      const unlocked = SaveService.isLevelUnlocked(level.id) || !level.locked;
      const y = 220 + index * 170;
      const fill = unlocked ? 0x114466 : 0x333333;
      const button = this.add.rectangle(width / 2, y, width * 0.7, 120, fill, 0.95)
        .setStrokeStyle(2, 0xffffff, unlocked ? 0.6 : 0.2)
        .setInteractive({ useHandCursor: unlocked });
      this.add.text(button.x - button.width / 2 + 30, y - 35, level.name, { fontFamily: 'Verdana', fontSize: '34px', color: '#ffffff' }).setOrigin(0, 0.5);
      this.add.text(button.x - button.width / 2 + 30, y + 8, level.description, { fontFamily: 'Verdana', fontSize: '22px', color: '#d5e9ff', wordWrap: { width: button.width - 220 } }).setOrigin(0, 0.5);
      this.add.text(button.x + button.width / 2 - 30, y - 10, unlocked ? 'Unlocked' : 'Locked', { fontFamily: 'Verdana', fontSize: '20px', color: unlocked ? '#7dff9b' : '#bbbbbb' }).setOrigin(1, 0.5);
      this.add.text(button.x + button.width / 2 - 30, y + 20, `High Score: ${SaveService.getHighScore(level.id)}`, { fontFamily: 'Verdana', fontSize: '18px', color: '#ffffff' }).setOrigin(1, 0.5);
      if (unlocked) {
        button.on('pointerdown', () => this.scene.start('GameScene', { levelId: level.id }));
      }
    });

    const back = this.add.text(50, height - 70, '← Back', { fontFamily: 'Verdana', fontSize: '28px', color: '#ffffff' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('MenuScene'));
    back.setPadding(10);
  }
}
