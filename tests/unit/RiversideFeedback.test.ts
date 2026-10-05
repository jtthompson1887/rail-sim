import { RiversideFeedback } from '../../src/presentation/RiversideFeedback';
import { createRiversideRegion } from '../../src/region/RiversideRegion';
import { freezeSimulationData } from '../../src/simulation/SimulationSession';

afterEach(() => document.body.replaceChildren());

it('announces committed housing once, links to its map location, and never changes the world', () => {
  const world = createRiversideRegion(), visit = jest.fn();
  const notice = new RiversideFeedback(world, visit);
  const element = document.querySelector<HTMLElement>('.riverside-news')!;
  notice.observe(world); expect(element.hidden).toBe(true);
  world.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 505;
  freezeSimulationData(world);
  const before = JSON.stringify(world);
  notice.observe(world);
  expect(element.hidden).toBe(false);
  expect(element.querySelector('[role="status"]')!.textContent).toContain('passenger demand +25%');
  expect(element.querySelector('[role="status"]')!.textContent).toContain('£30,000 grant awarded');
  element.querySelector<HTMLButtonElement>('button')!.click();
  expect(visit).toHaveBeenCalledTimes(1); expect(element.hidden).toBe(true);
  notice.observe(world); expect(element.hidden).toBe(true);
  expect(JSON.stringify(world)).toBe(before);
  notice.destroy(); expect(element.isConnected).toBe(false);
});

it('does not replay completed development on reload and keeps dismissal available without visiting', () => {
  const world = createRiversideRegion();
  world.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 505;
  const loaded = new RiversideFeedback(world, jest.fn());
  loaded.observe(world); expect(document.querySelector<HTMLElement>('.riverside-news')!.hidden).toBe(true);
  loaded.destroy();
  const next = createRiversideRegion(), visit = jest.fn(), notice = new RiversideFeedback(next, visit);
  next.region!.projects.find(p => p.definitionId === 'housing')!.completedAtTick = 510;
  notice.observe(next);
  const element = document.querySelector<HTMLElement>('.riverside-news')!;
  element.querySelectorAll<HTMLButtonElement>('button')[1].click();
  expect(element.hidden).toBe(true); expect(visit).not.toHaveBeenCalled();
  notice.destroy();
});
