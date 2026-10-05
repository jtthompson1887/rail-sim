import type { WorldData, TrackDef } from '../config/WorldData';
import { footprintIsClear, REGIONAL_PROJECTS, type RegionalFootprint } from '../region/RegionalProjects';

/** Authored extension east of the village, beyond its streets, gardens and woodland. */
export function riversideHousingSite(world: WorldData, reserved: readonly TrackDef[], heightAt: (x: number, y: number) => number): RegionalFootprint | null {
  if (!world.region?.projects.some(p => p.definitionId === 'housing' && p.completedAtTick !== null)) return null;
  const appearance = REGIONAL_PROJECTS.find(p => p.id === 'housing')!.appearance;
  const tracks = [...world.tracks, ...reserved];
  for (const x of [6400, 6780, 7160]) {
    const site: RegionalFootprint = { projectId: 'housing', x, y: 1940, ...appearance };
    const corners = [[0, 0], [-site.radius, -site.radius], [site.radius, -site.radius], [-site.radius, site.radius], [site.radius, site.radius]];
    // The illustration occupies a square parcel; reserve its corners as well as its centre.
    if (!corners.every(([dx, dy]) => heightAt(x + dx, site.y + dy) >= 0)
      || !footprintIsClear({...site, radius: site.radius * Math.SQRT2}, tracks)) continue;
    // The new lane joins the existing eastern road. Neither houses nor their access cover railway.
    let clear = true;
    for (let lx = 6000; lx < x - site.radius; lx += 24) {
      if (heightAt(lx, site.y) < 0 || !footprintIsClear({x: lx, y: site.y, radius: 12}, tracks)) { clear = false; break; }
    }
    if (clear) return site;
  }
  return null;
}
