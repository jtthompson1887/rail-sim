import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';
import { SaveService } from '../services/SaveService';

export class AudioManager {
  private scene: Phaser.Scene;
  private bgm: Phaser.Sound.BaseSound | null = null;
  private _muted: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const settings = SaveService.getSettings();
    this.scene.sound.volume = settings.bgmVolume;

    EventBus.on('audio:play-sfx', ({ key }) => this.playSFX(key));
    EventBus.on('audio:play-bgm', ({ key }) => this.playBGM(key));
    EventBus.on('junction:toggled', () => EventBus.emit('audio:play-sfx', { key: 'sfx_click' }));
    EventBus.on('train:derailed', () => EventBus.emit('audio:play-sfx', { key: 'sfx_crash' }));
  }

  playBGM(key: string): void {
    if (this.bgm) {
      this.bgm.stop();
    }
    if (!this.scene.cache.audio.exists(key)) return;
    this.bgm = this.scene.sound.add(key, { loop: true, volume: GameConfig.AUDIO.BGM_VOLUME });
    if (!this._muted) this.bgm.play();
  }

  playSFX(key: string): void {
    if (this._muted) return;
    if (!this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key, { volume: GameConfig.AUDIO.SFX_VOLUME });
  }

  setVolume(volume: number): void {
    this.scene.sound.volume = volume;
    SaveService.updateSettings({ bgmVolume: volume });
  }

  mute(): void {
    this._muted = true;
    this.scene.sound.mute = true;
  }

  unmute(): void {
    this._muted = false;
    this.scene.sound.mute = false;
  }

  get muted(): boolean { return this._muted; }
}
