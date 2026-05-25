import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';

export default class HUDScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private trainsText!: Phaser.GameObjects.Text;
  private objectivesText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    this.scoreText = this.add.text(20, 20, '', { fontFamily: 'Verdana', fontSize: '24px', color: '#ffffff', backgroundColor: '#00000088', padding: { x: 10, y: 6 } }).setScrollFactor(0);
    this.timeText = this.add.text(20, 60, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffffff' }).setScrollFactor(0);
    this.trainsText = this.add.text(20, 90, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffffff' }).setScrollFactor(0);
    this.objectivesText = this.add.text(20, 140, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffe9a8', lineSpacing: 8, wordWrap: { width: 600 } }).setScrollFactor(0);
  }

  update(): void {
    this.scoreText.setText(`Score: ${GameStateManager.score}`);
    this.timeText.setText(`Time: ${GameStateManager.elapsedSecs.toFixed(1)}s`);
    this.trainsText.setText(`Active trains: ${GameStateManager.activeTrains}`);
    const objectives = (this.registry.get('hud.objectives') as Array<{ text: string; status: string; progress: number }> | undefined) || [];
    this.objectivesText.setText(objectives.length ? objectives.map((objective) => `${objective.status.toUpperCase()}: ${objective.text}`).join('\n') : 'Objectives loading...');
  }
}
