import {test,expect,type Page} from '@playwright/test';
import {worldToCameraPoint} from './helpers/CameraCoordinates';

const snapshot=(page:Page)=>page.evaluate(()=>window.__railSimConstructionSnapshot!());
async function openBrookford(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Play Brookford',exact:true}).click();
  await page.waitForFunction(()=>window.__railSimScene==='WorldScene');
  await expect(page.getByTestId('company-hud')).toBeVisible();
}

test('Brookford: draw, recover, run, diagnose, grow and reopen',async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1600,height:1000});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await openBrookford(page);
  const panel=page.locator('.railway-panel');
  await page.screenshot({path:testInfo.outputPath('brookford-overview.png')});
  const before=await snapshot(page);
  expect(before.world.generationConfig.seed).toBe('riverside-brookford-v1');
  expect(before.world.management!.speed).toBe(0);
  // A short mouse construction/recovery interaction, on flat land away from the operating railway.
  const screen=async(x:number,y:number)=>{
    const state=await snapshot(page),box=(await page.locator('canvas').boundingBox())!;
    const p=worldToCameraPoint({x,y},state.camera);
    return{x:box.x+p.x*box.width/state.camera.width,y:box.y+p.y*box.height/state.camera.height};
  };
  await page.keyboard.press('p');
  const a=await screen(2400,3300),b=await screen(3400,3300);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  await expect(page.getByTestId('construction-confirm')).toBeEnabled();
  await page.getByTestId('construction-cancel').click();
  expect((await snapshot(page)).world.company.cash).toBe(before.world.company.cash);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  await page.getByTestId('construction-confirm').click();
  const built=await snapshot(page);expect(built.world.tracks.length).toBe(before.world.tracks.length+1);
  expect(built.world.company.cash).toBeLessThan(before.world.company.cash);
  await page.keyboard.press('Escape');await page.keyboard.press('h');
  // The same production session is stepped deterministically: no twenty-minute driving preamble.
  await page.evaluate(()=>window.__railSimFirstRouteHarness!.advanceFixedTicks(600));
  const grown=await snapshot(page);
  expect(grown.world.region!.projects.find(p=>p.definitionId==='housing')!.completedAtTick).not.toBeNull();
  expect(grown.world.region!.passengerDemandBonusBps).toBe(2500);
  if(await panel.locator('.rp-toggle').getAttribute('aria-expanded')==='false')await panel.locator('.rp-toggle').click();
  await panel.getByRole('button',{name:'Services',exact:true}).click();
  await expect(panel).toContainText('s waiting');
  await page.screenshot({path:testInfo.outputPath('brookford-shared-track-inspector.png')});
  await panel.getByRole('button',{name:'Projects',exact:true}).click();
  await expect(panel).toContainText('Complete');
  await page.screenshot({path:testInfo.outputPath('brookford-neighbourhood.png')});
  await panel.getByRole('button',{name:'Company',exact:true}).click();
  await panel.getByRole('button',{name:'Save world',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('World saved.');
  await page.reload();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(()=>window.__railSimScene==='WorldScene');
  const loaded=await snapshot(page);
  expect(loaded.world.id).toBe(grown.world.id);expect(loaded.world.tracks).toEqual(grown.world.tracks);
  expect(loaded.world.region!.transformations).toEqual(grown.world.region!.transformations);
  expect(errors).toEqual([]);
});

test('Brookford: preview and buy a relief line with an exact charge',async({page},testInfo)=>{
  await page.setViewportSize({width:1600,height:1000});await openBrookford(page);
  const panel=page.locator('.railway-panel'),before=(await snapshot(page)).world;
  await panel.getByRole('button',{name:'Plans',exact:true}).click();
  await panel.getByRole('button',{name:'Preview northern relief line',exact:true}).click();
  await expect(panel).toContainText('£45,218');
  expect((await snapshot(page)).world.company).toEqual(before.company);
  await panel.getByRole('button',{name:'Build draft',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Built 3 tracks');
  const after=(await snapshot(page)).world;
  expect(after.company.cash).toBe(before.company.cash-45218);
  expect(after.tracks.length).toBe(before.tracks.length+3);
  await page.screenshot({path:testInfo.outputPath('brookford-relief-line.png')});
});

test.describe('Brookford on landscape touch',()=>{
  test.use({hasTouch:true,viewport:{width:844,height:390}});
  test('starts, pauses and opens the focused project without hover',async({page},testInfo)=>{
    await openBrookford(page);const panel=page.locator('.railway-panel');
    await panel.locator('[data-speed="1"]').tap();
    await expect.poll(async()=>(await snapshot(page)).world.management!.clockSeconds).toBeGreaterThan(0);
    await panel.getByRole('button',{name:'Pause railway',exact:true}).tap();
    if(await panel.locator('.rp-toggle').getAttribute('aria-expanded')==='false')await panel.locator('.rp-toggle').tap();
    await panel.getByRole('button',{name:'Projects',exact:true}).tap();
    await expect(panel.getByRole('heading',{name:'Homes by the Railway',exact:true})).toBeVisible();
    const bounds=(await panel.boundingBox())!;expect(bounds.x+bounds.width).toBeLessThanOrEqual(844);expect(bounds.y+bounds.height).toBeLessThanOrEqual(390);
    const heights=await panel.locator('button:visible').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height));expect(heights.every(h=>h>=44)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('brookford-touch.png')});
    await panel.getByRole('button',{name:'Company',exact:true}).tap();
    await panel.getByRole('button',{name:'Save and return to menu',exact:true}).tap();
    await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
  });
});
