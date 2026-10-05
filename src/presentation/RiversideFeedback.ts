import type { WorldData } from '../config/WorldData';
import { isRiverside } from '../region/RiversideRegion';
import { REGIONAL_PROJECTS } from '../region/RegionalProjects';

/** Observes committed development. This notice never awards grants or changes the world. */
export class RiversideFeedback {
  private readonly root = document.createElement('aside');
  private completed: boolean;

  constructor(world: WorldData | null, visitHomes: () => void) {
    this.completed = this.hasHomes(world);
    this.root.className = 'riverside-news';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Regional development');
    const style = document.createElement('style');
    style.textContent = `
      .riverside-news{position:fixed;bottom:22px;left:78px;width:330px;max-width:calc(100vw - 104px);z-index:85;
        box-sizing:border-box;padding:18px;background:#f7f1e3;border:1px solid #b5bba1;border-top:4px solid #3e795e;
        border-radius:10px;box-shadow:0 6px 24px #203f3029;color:#294e42;font:13px/1.5 system-ui,sans-serif}
      .riverside-news[hidden]{display:none!important}.riverside-news p{margin:0 0 9px}
      .riverside-news .rn-eyebrow{text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:#64785d}
      .riverside-news h2{font:600 24px/1.2 Georgia,serif;margin:0 0 10px}.riverside-news .rn-reward{font-size:12px;color:#64785d}
      .riverside-news .rn-actions{display:flex;gap:8px;margin-top:13px}.riverside-news button{font:inherit;min-height:44px;
        padding:8px 12px;border:1px solid #b8c0a8;border-radius:7px;cursor:pointer;color:#294e42;background:#faf7ed}
      .riverside-news button:first-child{background:#265e58;color:#fff9e9;border-color:#265e58;flex:1}
      .riverside-news button:focus-visible{outline:3px solid #b59851;outline-offset:2px}
      @media(max-width:720px){.riverside-news{left:58px;bottom:10px;max-width:calc(100vw - 78px);padding:12px}}
      @media(max-height:500px){.riverside-news{bottom:10px;padding:12px}.riverside-news h2{font-size:20px}.riverside-news p{margin-bottom:5px}}
    `;
    const message = document.createElement('div');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    message.setAttribute('aria-atomic', 'true');
    message.className = 'rn-message';
    const actions = document.createElement('div');
    actions.className = 'rn-actions';
    const visit = document.createElement('button');
    visit.textContent = 'See the new homes';
    visit.onclick = () => { visitHomes(); this.root.hidden = true; };
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.onclick = () => { this.root.hidden = true; };
    actions.append(visit, dismiss);
    this.root.append(style, message, actions);
    for (const name of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown', 'keyup']) {
      this.root.addEventListener(name, event => event.stopPropagation());
    }
    document.body.append(this.root);
  }

  observe(world: WorldData): void {
    if (!isRiverside(world) || this.completed || !this.hasHomes(world)) return;
    this.completed = true;
    const definition = REGIONAL_PROJECTS.find(project => project.id === 'housing')!;
    const grant = '£' + definition.reward.grant.toLocaleString('en-GB');
    this.root.querySelector('.rn-message')!.innerHTML = `<p class="rn-eyebrow">Neighbourhood complete</p>
      <h2>You helped Brookford grow</h2><p>Your trains brought the materials and residents. New homes now stand beside the railway.</p>
      <p class="rn-reward">${grant} grant awarded · passenger demand +${definition.reward.passengerDemandBonusBps / 100}%</p>`;
    this.root.hidden = false;
  }

  setVisible(visible: boolean): void { this.root.style.display = visible ? '' : 'none'; }
  destroy(): void { this.root.remove(); }
  private hasHomes(world: WorldData | null): boolean {
    return world?.region?.projects.some(project => project.definitionId === 'housing' && project.completedAtTick !== null) ?? false;
  }
}
