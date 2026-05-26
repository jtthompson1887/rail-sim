import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';

export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SettingsScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x06131f, 1);

    this.add.text(width / 2, height * 0.1, 'Settings', {
      fontFamily: 'Verdana',
      fontSize: '56px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5);

    const settings = SaveService.getSettings();
    let bgmVolume = settings.bgmVolume;
    let sfxVolume = settings.sfxVolume;

    // Music Volume row
    const bgmY = height * 0.35;
    this.add.text(width / 2, bgmY, 'Music Volume', {
      fontFamily: 'Verdana',
      fontSize: '34px',
      color: '#d2e6ff',
    }).setOrigin(0.5);

    const bgmValueText = this.add.text(width / 2, bgmY + 58, `${Math.round(bgmVolume * 100)}%`, {
      fontFamily: 'Verdana',
      fontSize: '34px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.makeAdjustButtons(
      width / 2,
      bgmY + 58,
      () => { bgmVolume = Math.max(0, Math.round((bgmVolume - 0.1) * 10) / 10); bgmValueText.setText(`${Math.round(bgmVolume * 100)}%`); },
      () => { bgmVolume = Math.min(1, Math.round((bgmVolume + 0.1) * 10) / 10); bgmValueText.setText(`${Math.round(bgmVolume * 100)}%`); },
    );

    // SFX Volume row
    const sfxY = height * 0.58;
    this.add.text(width / 2, sfxY, 'Sound Effects Volume', {
      fontFamily: 'Verdana',
      fontSize: '34px',
      color: '#d2e6ff',
    }).setOrigin(0.5);

    const sfxValueText = this.add.text(width / 2, sfxY + 58, `${Math.round(sfxVolume * 100)}%`, {
      fontFamily: 'Verdana',
      fontSize: '34px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.makeAdjustButtons(
      width / 2,
      sfxY + 58,
      () => { sfxVolume = Math.max(0, Math.round((sfxVolume - 0.1) * 10) / 10); sfxValueText.setText(`${Math.round(sfxVolume * 100)}%`); },
      () => { sfxVolume = Math.min(1, Math.round((sfxVolume + 0.1) * 10) / 10); sfxValueText.setText(`${Math.round(sfxVolume * 100)}%`); },
    );

    // Save & Back button
    const saveBack = this.add.text(width / 2, height * 0.8, 'Save & Back', {
      fontFamily: 'Verdana',
      fontSize: '38px',
      color: '#7dff9b',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    saveBack.setPadding(14);
    saveBack.on('pointerover', () => saveBack.setColor('#ffffff'));
    saveBack.on('pointerout',  () => saveBack.setColor('#7dff9b'));
    saveBack.on('pointerdown', () => this.saveAndBack(bgmVolume, sfxVolume));

    this.input.keyboard.once('keydown-ESC', () => this.saveAndBack(bgmVolume, sfxVolume));
  }

  private makeAdjustButtons(
    centerX: number,
    centerY: number,
    onDecrease: () => void,
    onIncrease: () => void,
  ): void {
    const btnStyle = { fontFamily: 'Verdana', fontSize: '52px', color: '#4ad5ff' };
    const gap = 180;

    const dec = this.add.text(centerX - gap, centerY, '−', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    dec.on('pointerover', () => dec.setColor('#ffffff'));
    dec.on('pointerout',  () => dec.setColor('#4ad5ff'));
    dec.on('pointerdown', onDecrease);

    const inc = this.add.text(centerX + gap, centerY, '+', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    inc.on('pointerover', () => inc.setColor('#ffffff'));
    inc.on('pointerout',  () => inc.setColor('#4ad5ff'));
    inc.on('pointerdown', onIncrease);
  }

  private saveAndBack(bgmVolume: number, sfxVolume: number): void {
    SaveService.updateSettings({ bgmVolume, sfxVolume });
    this.scene.start('MenuScene');
  }
}
