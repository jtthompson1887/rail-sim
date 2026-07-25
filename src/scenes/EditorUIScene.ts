import Phaser from 'phaser';
import { EditorToolbar } from '../ui/EditorToolbar';
import type { CreateTool } from '../ui/EditorToolbar';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import type { DeleteTracksIntent } from '../ui/PropertiesPanel';
import { ContextMenu } from '../ui/ContextMenu';
import type { MenuItem } from '../ui/ContextMenu';
import { ValidationHint } from '../ui/ValidationHint';
import { EventBus } from '../services/EventBus';
import type TrackManager from '../managers/TrackManager';
import type { SelectionManager } from '../systems/SelectionManager';
import type { VehicleType } from '../config/VehicleTypes';
import { ConstructionInspector } from '../ui/ConstructionInspector';
import { CompanyHud } from '../ui/CompanyHud';
import { MinimapRenderer } from '../ui/MinimapRenderer';

/**
 * EditorUIScene
 *
 * A parallel overlay scene that owns all editor UI (toolbar, properties panel,
 * context menu).  Because this scene has its own camera (zoom always = 1,
 * scroll always = 0,0), the UI is never affected by WorldScene's camera zoom
 * or scroll.
 *
 * Communicates with WorldScene via EventBus:
 *   WorldScene → EditorUIScene:
 *     'ui:toolbar-undo-state'   – update undo/redo button states
 *     'ui:toolbar-save-state'   – update save indicator
 *     'ui:toolbar-visible'      – show/hide the toolbar (create vs play mode)
 *     'ui:toolbar-select-tool'  – programmatically activate a tool button
 *   EditorUIScene → WorldScene:
 *     'editor:delete-tracks'    – delete the selected tracks
 *     (all existing toolbar EventBus emissions are unchanged)
 */
export default class EditorUIScene extends Phaser.Scene {
  private toolbar!: EditorToolbar;
  private propertiesPanel!: PropertiesPanel;
  private contextMenu!: ContextMenu;
  private validationHint!: ValidationHint;
  private constructionInspector!: ConstructionInspector;
  private companyHud!: CompanyHud;
  private minimapRenderer!: MinimapRenderer;
  private minimapVisible = true;
  private initialVisible = true;
  private initialCash = 0;
  private initialSaveState: 'saved' | 'unsaved' | 'saving' = 'saved';
  private initialSaveErrorMessage: string | null = null;

  // Passed from WorldScene via scene.launch data
  private trackManager!: TrackManager;
  private selectionManager!: SelectionManager;

  // EventBus handler references held for clean-up
  private readonly undoStateHandler = ({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) => {
    this.toolbar.setUndoEnabled(canUndo);
    this.toolbar.setRedoEnabled(canRedo);
  };

  private readonly saveStateHandler = ({ state }: { state: 'saved' | 'unsaved' | 'saving' }) => {
    this.toolbar.setSaveIndicator(state);
  };

  private readonly visibleHandler = ({ visible }: { visible: boolean }) => {
    this.toolbar.setVisible(visible);
    this.propertiesPanel.setVisible(visible);
    this.constructionInspector.setVisible(visible);
    this.companyHud.setVisible(visible);
    this.validationHint.setVisible(visible);
    this.minimapVisible = visible;
    if (!visible) {
      this.constructionInspector.clear();
      this.validationHint.clear();
      this.minimapRenderer?.clear();
    }
  };

  private readonly selectToolHandler = ({ tool }: { tool: string }) => {
    this.toolbar.selectTool(tool as CreateTool);
  };

  constructor() {
    super({ key: 'EditorUIScene' });
  }

  init(data: {
    trackManager: TrackManager;
    selectionManager: SelectionManager;
    visible?: boolean;
    companyCash?: number;
    saveState?: 'saved' | 'unsaved' | 'saving';
    saveErrorMessage?: string;
  }): void {
    this.trackManager = data.trackManager;
    this.selectionManager = data.selectionManager;
    this.initialVisible = data.visible ?? true;
    this.initialCash = data.companyCash ?? 0;
    this.initialSaveState = data.saveState ?? 'saved';
    this.initialSaveErrorMessage = data.saveErrorMessage ?? null;
  }

  create(): void {
    this.toolbar = new EditorToolbar(this);
    this.toolbar.setSaveIndicator(this.initialSaveState);
    this.propertiesPanel = new PropertiesPanel(
      this,
      this.trackManager,
      this.selectionManager,
      (intent: DeleteTracksIntent) => EventBus.emit('editor:delete-tracks', intent),
    );
    this.contextMenu = new ContextMenu(this);
    this.validationHint = new ValidationHint(this);
    this.constructionInspector = new ConstructionInspector();
    this.companyHud = new CompanyHud();
    this.minimapRenderer = new MinimapRenderer(
      this,
      this.trackManager,
      this.selectionManager,
    );
    this.companyHud.setState({
      cash: this.initialCash,
      saveState: this.initialSaveState,
    });
    this.visibleHandler({ visible: this.initialVisible });

    // Subscribe to WorldScene → EditorUIScene events
    EventBus.on('ui:toolbar-undo-state', this.undoStateHandler);
    EventBus.on('ui:toolbar-save-state', this.saveStateHandler);
    EventBus.on('ui:toolbar-visible',    this.visibleHandler);
    EventBus.on('ui:toolbar-select-tool', this.selectToolHandler);

    const startupSaveError = this.initialSaveErrorMessage;
    this.initialSaveErrorMessage = null;
    if (startupSaveError) {
      EventBus.emit('ui:toast', {
        message: startupSaveError,
        type: 'error',
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('ui:toolbar-undo-state',  this.undoStateHandler);
      EventBus.off('ui:toolbar-save-state',  this.saveStateHandler);
      EventBus.off('ui:toolbar-visible',     this.visibleHandler);
      EventBus.off('ui:toolbar-select-tool', this.selectToolHandler);
      this.toolbar.destroy();
      this.propertiesPanel.destroy();
      this.contextMenu.destroy();
      this.validationHint.destroy();
      this.constructionInspector.destroy();
      this.companyHud.destroy();
      this.minimapRenderer.destroy();
    });
  }

  update(): void {
    if (this.minimapVisible) this.minimapRenderer.draw();
  }

  /**
   * Called by WorldScene to display the context menu at the given screen
   * coordinates.  Items are built in WorldScene so their callbacks can
   * reference WorldScene state directly.
   */
  showContextMenu(screenX: number, screenY: number, items: MenuItem[]): void {
    this.contextMenu.show(screenX, screenY, items);
  }

  /** Returns the currently selected vehicle type from the properties panel. */
  getVehicleType(): VehicleType {
    return this.propertiesPanel.getVehicleType();
  }

  /** Shared screen-space input gate for every visible editor overlay. */
  containsScreenPoint(x: number, y: number): boolean {
    const toolbar = this.toolbar.screenBounds;
    return (
      x >= toolbar.left && x <= toolbar.right
      && y >= toolbar.top && y <= toolbar.bottom
    )
      || this.propertiesPanel.containsScreenPoint(x, y)
      || this.constructionInspector.containsScreenPoint(x, y)
      || this.companyHud.containsScreenPoint(x, y);
  }
}
