type EventCallback<T = unknown> = (data: T) => void;
import type { ConstructionPreviewEvent } from '../ui/ConstructionPreviewOverlay';
import type { FacilityInspectionDto } from '../economy/FacilityPresentation';
import type {
  DeleteReviewRequest,
  DeletionReviewDTO,
  DeleteTracksIntent,
} from '../ui/PropertiesPanel';
import type {
  FreightPurchaseQuote,
  FreightPurchaseResult,
} from '../freight/FreightPurchaseService';

interface EventMap {
  'train:selected': { trainId: string };
  'train:deselected': Record<string, never>;
  'train:derailed': { trainId: string };
  'carriage:derailed': { carriageId: string };
  'vehicle:type-changed': { type: 'locomotive' | 'passenger-carriage' };
  'junction:toggled': { junctionId: string; state: 'left' | 'right' };
  'passenger:boarded': { stationId: string; count: number };
  'passenger:delivered': { stationId: string; count: number };
  'objective:completed': { objectiveId: string; score: number };
  'objective:failed': { objectiveId: string };
  'game:paused': Record<string, never>;
  'game:resumed': Record<string, never>;
  'game:over': { won: boolean; score: number };
  'level:complete': { levelId: string; score: number };
  'audio:play-sfx': { key: string };
  'audio:play-bgm': { key: string };
  'mobile:throttle': { value: number };
  // World / mode events
  'world:saved': { worldId: string };
  'world:loaded': { worldId: string };
  'mode:changed': { mode: 'create' | 'play' };
  'tool:changed': { tool: 'generator' | 'junction' | 'completer' | 'select' | 'terrain-view' | 'pan' | 'eraser' | 'place-track' | 'place-vehicle' | 'none' };
  'track:placed': { trackUUID: string };
  'track:removed': { trackUUID: string };
  'junction:created': { junctionUUID: string };
  'completer:success': { trackUUIDs: string[] };
  'completer:failed': { reason: 'curvature' | 'collision' | 'budget' };
  'ui:toast': { message: string; type: 'info' | 'error' | 'success' | 'warning' };
  'world:undo': Record<string, never>;
  'create:station-placed': { stationId: string };
  'create:train-placed': { trainId: string };
  // Editor framework events
  'editor:undo': Record<string, never>;
  'editor:redo': Record<string, never>;
  'editor:save': Record<string, never>;
  'editor:mode-toggle': Record<string, never>;
  'selection:changed': { uuids: string[] };
  'facility:selected': { facilityId: string };
  'facility:inspection': FacilityInspectionDto;
  'facility:deselected': { facilityId: string };
  'snap:toggled': { gridEnabled: boolean; endpointEnabled: boolean };
  'grid:toggled': { enabled: boolean };
  'generator:run': Record<string, never>;
  // Editor UI cross-scene events
  'ui:toolbar-undo-state': { canUndo: boolean; canRedo: boolean };
  'ui:toolbar-save-state': { state: 'saved' | 'unsaved' | 'saving' };
  'ui:toolbar-visible': { visible: boolean };
  'ui:toolbar-select-tool': { tool: string };
  'editor:delete-tracks': DeleteTracksIntent;
  'ui:delete-request': DeleteReviewRequest;
  'ui:deletion-review': DeletionReviewDTO;
  /** Emitted by editor tools during track placement / reshaping to show live validation feedback. */
  'ui:validation-hint': { state: 'ok' | 'warning' | 'error'; message: string };
  'construction:preview': ConstructionPreviewEvent;
  'construction:intent': { action: 'confirm' | 'backstep' | 'cancel' };
  'ui:company-state': {
    cash: number;
    saveState: 'saved' | 'unsaved' | 'saving';
    economyTick: number;
    constructionIndexBps: number;
  };
  'freight:purchase-mode-requested': {
    freightSetId: 'timber-freight-set';
  };
  'ui:freight-purchase-state': {
    quote: FreightPurchaseQuote | null;
    cash: number;
    message: string;
  };
  'freight:purchase-confirmed': {
    quote: FreightPurchaseQuote;
  };
  'freight:purchase-result': FreightPurchaseResult;
}

class EventBusClass {
  private listeners: { [K in keyof EventMap]?: Array<EventCallback<EventMap[K]>> } = {};

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    (this.listeners[event] as Array<EventCallback<EventMap[K]>>).push(callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    const list = this.listeners[event] as Array<EventCallback<EventMap[K]>> | undefined;
    if (!list) return;
    (this.listeners as any)[event] = list.filter((cb) => cb !== callback);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const list = this.listeners[event] as Array<EventCallback<EventMap[K]>> | undefined;
    if (!list) return;
    list.forEach((cb) => cb(data));
  }
}

export const EventBus = new EventBusClass();
