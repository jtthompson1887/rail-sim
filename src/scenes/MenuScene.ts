import Phaser from 'phaser';
import Background from '../entities/Background';
import RailTrack from '../entities/RailTrack';
import Train from '../entities/Train';
import TrackFlowSolver from '../systems/TrackFlowSolver';
import { CameraController } from '../systems/CameraController';
import { SaveService } from '../services/SaveService';

export default class MenuScene extends Phaser.Scene {
  private railTracks: RailTrack[] = [];
  private trains: Train[] = [];
  private camControl?: CameraController;
  private previewSolvers: TrackFlowSolver[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const bg = new Background(this, 20, 20);
    bg.setDepth(-20);

    // Build a smooth circular track
    const circleCenter = new Phaser.Math.Vector2(width * 0.32, height * 0.52);
    const trackRadius = Math.min(width, height) * 0.32;
    const circleSegments = 16;
    const trackPoints: Phaser.Math.Vector2[] = [];

    for (let i = 0; i < circleSegments; i++) {
      const angle = Phaser.Math.DegToRad((360 / circleSegments) * i);
      trackPoints.push(new Phaser.Math.Vector2(
        circleCenter.x + Math.cos(angle) * trackRadius,
        circleCenter.y + Math.sin(angle) * trackRadius,
      ));
    }

    for (let i = 0; i < circleSegments; i++) {
      const prev = trackPoints[(i - 1 + circleSegments) % circleSegments];
      const current = trackPoints[i];
      const next = trackPoints[(i + 1) % circleSegments];
      const afterNext = trackPoints[(i + 2) % circleSegments];
      const cp1 = new Phaser.Math.Vector2(current.x + (next.x - prev.x) / 6, current.y + (next.y - prev.y) / 6);
      const cp2 = new Phaser.Math.Vector2(next.x - (afterNext.x - current.x) / 6, next.y - (afterNext.y - current.y) / 6);
      this.railTracks.push(new RailTrack(this, current, cp1, cp2, next));
    }

    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(circleCenter.x, circleCenter.y);
    this.camControl = new CameraController(this);
    this.camControl.stopFollow();

    // Train 1 – starts at segment 0
    const firstTrack = this.railTracks[0];
    const startPoint1 = firstTrack.getCurvePath().getPoint(0);
    const train1 = new Train(this, startPoint1.x, startPoint1.y);
    const train1Body = train1.getMatterBody();
    train1Body.setPosition(startPoint1.x, startPoint1.y);
    train1.currentTrack = firstTrack;
    train1Body.setAngle(firstTrack.getTrackAngle(train1Body));
    train1.enginePower = 38;
    this.trains.push(train1);
    this.previewSolvers.push(new TrackFlowSolver(this.railTracks, train1));

    // Train 2 – starts at the opposite side of the circle
    const halfSegment = Math.floor(circleSegments / 2);
    const secondTrack = this.railTracks[halfSegment];
    const startPoint2 = secondTrack.getCurvePath().getPoint(0);
    const train2 = new Train(this, startPoint2.x, startPoint2.y);
    const train2Body = train2.getMatterBody();
    train2Body.setPosition(startPoint2.x, startPoint2.y);
    train2.currentTrack = secondTrack;
    train2Body.setAngle(secondTrack.getTrackAngle(train2Body));
    train2.enginePower = 42;
    this.trains.push(train2);
    this.previewSolvers.push(new TrackFlowSolver(this.railTracks, train2));

    // Right-side menu panel
    const panelWidth = width * 0.42;
    const panelHeight = height * 0.78;
    const panelX = width * 0.72;
    const panelY = height * 0.5;
    this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x031626, 0.88)
      .setStrokeStyle(4, 0xffffff, 0.2).setScrollFactor(0).setDepth(100);
    this.add.rectangle(panelX, panelY - panelHeight * 0.375, panelWidth * 0.6, 6, 0x4ad5ff, 0.45)
      .setScrollFactor(0).setDepth(101);

    let currentY = panelY - panelHeight * 0.39;

    // Title with a gentle pulsing tween
    const title = this.add.text(panelX, currentY, 'Rail Sim', {
      fontFamily: 'Verdana',
      fontSize: '82px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setShadow(0, 6, 'rgba(0,0,0,0.6)', 8).setScrollFactor(0).setDepth(101);

    this.tweens.add({
      targets: title,
      alpha: { from: 1, to: 0.75 },
      duration: 1800,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    currentY += title.height + 16;
    const subtitle = this.add.text(panelX, currentY, 'Keep the rail network flowing smoothly', {
      fontFamily: 'Verdana',
      fontSize: '28px',
      color: '#d2e6ff',
      align: 'center',
      wordWrap: { width: panelWidth * 0.88 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);

    currentY += subtitle.height + 46;

    // Menu buttons: New Game, Continue, Load, Settings
    const buttonWidth = panelWidth * 0.72;
    const buttonHeight = 78;
    const buttonSpacing = 20;
    const hasSave = SaveService.hasSave();

    const menuItems: { label: string; enabled: boolean; action: () => void }[] = [
      { label: 'New Game', enabled: true,     action: () => this.scene.start('LevelSelectScene') },
      { label: 'Continue', enabled: hasSave,  action: () => this.continueGame() },
      { label: 'Load',     enabled: true,     action: () => this.scene.start('LevelSelectScene') },
      { label: 'Settings', enabled: true,     action: () => this.scene.start('SettingsScene') },
    ];

    for (const item of menuItems) {
      const btnY = currentY + buttonHeight / 2;
      const fillAlpha = item.enabled ? 0.14 : 0.06;
      const strokeAlpha = item.enabled ? 0.5 : 0.15;
      const textColor = item.enabled ? '#ffffff' : '#5a7090';

      const btn = this.add.rectangle(panelX, btnY, buttonWidth, buttonHeight, 0xffffff, fillAlpha)
        .setStrokeStyle(2, 0xffffff, strokeAlpha)
        .setScrollFactor(0)
        .setDepth(101);

      if (item.enabled) {
        btn.setInteractive({ useHandCursor: true })
          .on('pointerover', () => btn.setFillStyle(0xffffff, 0.27))
          .on('pointerout',  () => btn.setFillStyle(0xffffff, fillAlpha))
          .on('pointerdown', () => item.action());
      }

      this.add.text(panelX, btnY, item.label, {
        fontFamily: 'Verdana',
        fontSize: '42px',
        fontStyle: 'bold',
        color: textColor,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(102);

      currentY += buttonHeight + buttonSpacing;
    }

    currentY += 12;
    this.add.text(panelX, currentY, 'Press SPACE or ENTER to start', {
      fontFamily: 'Verdana',
      fontSize: '24px',
      color: '#9fc0ff',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);

    this.input.keyboard.once('keydown-SPACE', () => this.scene.start('LevelSelectScene'));
    this.input.keyboard.once('keydown-ENTER', () => this.scene.start('LevelSelectScene'));
  }

  update(time: number, delta: number): void {
    this.camControl?.update(time, delta);
    for (const train of this.trains) {
      train.update(time, delta);
    }
    for (const solver of this.previewSolvers) {
      solver.applyTrackFlowForces();
    }
  }

  private continueGame(): void {
    const levelId = SaveService.getLastPlayedLevelId();
    if (levelId) {
      this.scene.start('GameScene', { levelId });
    } else {
      this.scene.start('LevelSelectScene');
    }
  }
}
