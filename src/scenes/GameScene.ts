import Phaser from 'phaser';
import Background from '../entities/Background';
import { Station } from '../entities/Station';
import TrackManager from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import TrackGenerator from '../systems/TrackGenerator';
import { LEVELS, type LevelDef } from '../config/LevelData';
import { GameConfig } from '../config/GameConfig';
import { GameStateManager } from '../managers/GameStateManager';
import { ScheduleSystem } from '../systems/ScheduleSystem';
import { EventBus } from '../services/EventBus';
import { AudioManager } from '../managers/AudioManager';
import type Train from '../entities/Train';
import type RailTrack from '../entities/RailTrack';

export default class GameScene extends Phaser.Scene {
  private trackManager!: TrackManager;
  private cameraController!: CameraController;
  private trainManager!: TrainManager;
  private inputManager!: InputManager;
  private scheduleSystem!: ScheduleSystem;
  private audioManager!: AudioManager;
  private stations: Station[] = [];
  private levelDef!: LevelDef;
  private stationInteractionState: Map<string, { stationId: string; at: number }> = new Map();
  private readonly gameOverHandler = ({ won, score }: { won: boolean; score: number }) => {
    if (!this.scene.isActive('GameOverScene')) {
      this.scene.stop('HUDScene');
      this.scene.stop('PauseScene');
      this.scene.stop('DebugOverlayScene');
      this.scene.launch('GameOverScene', { won, score, levelId: this.levelDef.id });
      this.scene.pause();
    }
  };

  constructor() {
    super('GameScene');
  }

  init(data: { levelId?: string }): void {
    const levelId = data.levelId ?? LEVELS[0].id;
    this.levelDef = LEVELS.find((level) => level.id === levelId) ?? LEVELS[0];
  }

  create(): void {
    new Background(this, 20, 20).setDepth(-20);
    GameStateManager.startLevel(this.levelDef.id);
    this.audioManager = new AudioManager(this);
    this.trackManager = new TrackManager(this);
    this.cameraController = new CameraController(this);
    this.trainManager = new TrainManager(this, this.trackManager, this.cameraController);
    this.inputManager = new InputManager(this);
    this.inputManager.setupClickHandling(this.trainManager);

    const train = this.trainManager.createInitialTrain();
    const generator = new TrackGenerator(this, this.trackManager, this.levelDef.seed);
    const mainTracks = generator.generateTracks({
      startPoint: new Phaser.Math.Vector2(train.x, train.y),
      startAngle: Phaser.Math.DegToRad(90),
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
      smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
    });

    const firstTrack = mainTracks[0];
    const startPoint = firstTrack.getCurvePath().getPoint(0);
    train.getMatterBody().setPosition(startPoint.x, startPoint.y);
    train.currentTrack = firstTrack;
    train.getMatterBody().setAngle(firstTrack.getTrackAngle(train.getMatterBody()));

    const junction = this.trackManager.createJunction(mainTracks[mainTracks.length - 1].getUUID(), 1.0);
    const allTracks: RailTrack[] = [...mainTracks];
    if (junction) {
      const branchParams = {
        minLength: GameConfig.GENERATION.BRANCH.MIN_LENGTH,
        maxLength: GameConfig.GENERATION.BRANCH.MAX_LENGTH,
        curveProbability: GameConfig.GENERATION.BRANCH.CURVE_PROB,
        minCurveAngle: GameConfig.GENERATION.BRANCH.MIN_ANGLE,
        maxCurveAngle: GameConfig.GENERATION.BRANCH.MAX_ANGLE,
        smoothness: GameConfig.GENERATION.BRANCH.SMOOTHNESS,
      };
      allTracks.push(...generator.continueFromTrack(junction.getLeftTrack(), GameConfig.GENERATION.BRANCH.SECTIONS, branchParams));
      allTracks.push(...generator.continueFromTrack(junction.getRightTrack(), GameConfig.GENERATION.BRANCH.SECTIONS, branchParams));
    }

    this.stations = this.levelDef.stations.map((stationDef, index) => {
      const track = allTracks[Math.min(stationDef.trackSectionIndex, allTracks.length - 1)] ?? firstTrack;
      const station = new Station(this, stationDef, track);
      station.x += index * 20;
      station.y += index * 12;
      return station;
    });

    this.scheduleSystem = new ScheduleSystem(this.levelDef.objectives);
    this.cameras.main.scrollX = -400;
    this.cameras.main.scrollY = 600;
    this.cameras.main.zoom = 0.5;

    this.scene.launch('HUDScene');
    this.scene.launch('DebugOverlayScene');
    EventBus.on('game:over', this.gameOverHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('game:over', this.gameOverHandler);
    });

    this.input.keyboard.on('keydown-ESC', () => {
      if (GameStateManager.state === 'playing') {
        GameStateManager.pause();
        this.scene.launch('PauseScene');
        this.scene.pause();
      }
    });
  }

  update(time: number, delta: number): void {
    if (GameStateManager.state !== 'playing') {
      return;
    }

    this.inputManager.handleTrainMovement(this.trainManager.selectedTrain);
    this.trainManager.update(time, delta);
    this.cameraController.update(time, delta);
    this.stations.forEach((station) => station.update(delta));
    this.handleStationInteractions();
    this.scheduleSystem.update(delta / 1000);
    GameStateManager.tick(delta / 1000);
    this.publishHUDState();
    this.publishDebugState();
  }

  private handleStationInteractions(): void {
    for (const train of this.trainManager.trains) {
      const trainBody = train.getMatterBody();
      for (const station of this.stations) {
        if (train.currentTrack !== station.getTrack()) continue;
        const distance = Phaser.Math.Distance.Between(trainBody.x, trainBody.y, station.x, station.y);
        if (distance > 60) continue;
        const state = this.stationInteractionState.get(train.getUUID());
        const now = this.time.now;
        if (state && state.stationId === station.stationId && now - state.at < 1500) {
          continue;
        }
        const delivered = train.unloadPassengers();
        station.deliverPassengers(delivered);
        const boarded = station.boardPassengers(train.passengerCapacity - train.getPassengerCount());
        train.boardPassengers(boarded);
        this.stationInteractionState.set(train.getUUID(), { stationId: station.stationId, at: now });
      }
    }
  }

  private publishHUDState(): void {
    this.registry.set('hud.objectives', this.scheduleSystem.getObjectives().map((objective) => ({
      text: objective.def.description,
      status: objective.status,
      progress: objective.progress,
    })));
  }

  private publishDebugState(): void {
    const selectedTrain = this.trainManager.selectedTrain || this.trainManager.trains[0];
    const mainCam = this.cameras.main;
    const mouseWorldX = this.input.mousePointer.x / mainCam.zoom + mainCam.scrollX;
    const mouseWorldY = this.input.mousePointer.y / mainCam.zoom + mainCam.scrollY;
    const trainBody = selectedTrain?.getMatterBody();
    this.registry.set('debug.overlay', {
      cameraX: Math.floor(mainCam.scrollX),
      cameraY: Math.floor(mainCam.scrollY),
      zoom: mainCam.zoom.toFixed(2),
      mouseX: Math.floor(mouseWorldX),
      mouseY: Math.floor(mouseWorldY),
      trainX: Math.floor(trainBody?.x ?? 0),
      trainY: Math.floor(trainBody?.y ?? 0),
      enginePower: selectedTrain?.enginePower.toFixed(2) ?? '0.00',
      trackId: selectedTrain?.currentTrack?.getUUID() ?? 'none',
    });
  }
}
