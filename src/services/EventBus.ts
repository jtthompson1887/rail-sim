type EventCallback<T = unknown> = (data: T) => void;

interface EventMap {
  'train:selected': { trainId: string };
  'train:deselected': Record<string, never>;
  'train:derailed': { trainId: string };
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
  'tool:changed': { tool: 'generator' | 'junction' | 'completer' | 'select' | 'terrain-view' | 'none' };
  'track:placed': { trackUUID: string };
  'track:removed': { trackUUID: string };
  'junction:created': { junctionUUID: string };
  'completer:success': { trackUUIDs: string[] };
  'completer:failed': { reason: 'curvature' | 'collision' | 'budget' };
  'ui:toast': { message: string; type: 'info' | 'error' | 'success' };
  'world:undo': Record<string, never>;
  'create:station-placed': { stationId: string };
  'create:train-placed': { trainId: string };
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
