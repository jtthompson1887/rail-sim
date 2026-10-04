import { createRehearsal } from './Rehearsal';
import type { RehearsalRequest } from './SimulationTypes';

type WorkerMessage = { type: 'run'; request: RehearsalRequest } | { type: 'cancel'; requestId: string };
const active = new Map<string, ReturnType<typeof createRehearsal>>();
const worker = self as unknown as { onmessage: (event: MessageEvent<WorkerMessage>) => void; postMessage: (message: unknown) => void };
worker.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') { active.get(message.requestId)?.cancel(); return; }
  if (message.type !== 'run') return;
  const request = message.request;
  try {
    const rehearsal = createRehearsal(request);
    active.set(request.requestId, rehearsal);
    const work = () => {
      try {
        if (rehearsal.step(2)) {
          worker.postMessage({ type: 'result', result: rehearsal.result() });
          active.delete(request.requestId);
        } else setTimeout(work, 0);
      } catch (error) {
        active.delete(request.requestId);
        worker.postMessage({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
      }
    };
    work();
  } catch (error) {
    worker.postMessage({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
