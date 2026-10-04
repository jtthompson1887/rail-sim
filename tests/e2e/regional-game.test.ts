import { test, expect, type Page } from '@playwright/test';
async function openRegion(page:Page,width:number,height:number){
  await page.setViewportSize({width,height});await page.goto('/');
  await page.waitForFunction(()=>window.__railSimScene==='MenuScene',undefined,{timeout:40000});await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__railSimScene==='WorldSelectScene');await page.locator('canvas').click({position:{x:width/2,y:height-90}});
  const picker=page.getByRole('dialog',{name:'Create railway region'});await expect(picker).toBeVisible();await picker.getByLabel('World seed').fill('playtest-884');await picker.getByLabel('Landscape').selectOption('lowlands');await picker.getByRole('button',{name:'Create region',exact:true}).click();
  await page.waitForFunction(()=>window.__railSimScene==='WorldScene',undefined,{timeout:40000});await page.locator('.railway-panel').getByRole('button',{name:'Railway',exact:true}).click();
}
const snapshot=(page:Page)=>page.evaluate(()=>window.__railSimFirstRouteHarness!.snapshot().world);
async function expectRailwayToClearFinances(page:Page){
  await expect(page.getByTestId('company-hud')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const finance=document.querySelector('[data-testid="company-hud"]')!.getBoundingClientRect();
    const header=document.querySelector('.railway-panel .rp-head')!.getBoundingClientRect();
    const panel=document.querySelector('.railway-panel')!.getBoundingClientRect();
    return {clearsFinance:header.top>=finance.bottom+6,fitsViewport:panel.bottom<=window.innerHeight-6};
  })).toEqual({clearsFinance:true,fitsViewport:true});
}
test('mouse: build, run, rehearse and reopen an autonomous regional railway',async({page},testInfo)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openRegion(page,1366,700);
  const panel=page.locator('.railway-panel'),before=await snapshot(page);expect(before.management!.speed).toBe(0);expect(before.economy.facilities).toHaveLength(13);
  const forest=before.economy.facilities.find(f=>f.definitionId==='managed-forest')!,sawmill=before.economy.facilities.find(f=>f.definitionId==='sawmill')!;
  await panel.getByRole('button',{name:'Plans',exact:true}).click();await panel.locator('[name="from"]').selectOption(forest.id);await panel.locator('[name="to"]').selectOption(sawmill.id);await panel.getByRole('button',{name:'Preview connection',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Build draft',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Build draft',exact:true}).click();
  expect((await snapshot(page)).tracks.length).toBeGreaterThan(0);
  await panel.getByRole('button',{name:'Fleet',exact:true}).click();await panel.locator('[name="family"]').selectOption('mixed-diesel');await panel.getByRole('button',{name:'Buy and place train',exact:true}).click();expect((await snapshot(page)).trains).toHaveLength(1);
  await panel.getByRole('button',{name:'Services',exact:true}).click();await panel.locator('[name="service-name"]').fill('Timber shuttle');await panel.locator('[name="stop-0"]').selectOption('facility:'+forest.id);await panel.locator('[name="stop-1"]').selectOption('facility:'+sawmill.id);await panel.getByRole('button',{name:'Start service',exact:true}).click();
  expect((await snapshot(page)).management!.services).toHaveLength(1);await panel.getByRole('button',{name:'4× simulation speed',exact:true}).click();
  await expect.poll(async()=>((await snapshot(page)).trains[0].operations.lifetimeDeliveredUnits),{timeout:45000}).toBeGreaterThan(0);
  await panel.getByRole('button',{name:'Pause railway',exact:true}).click();const paused=await snapshot(page);
  await expect(page.getByTestId('company-cash')).toHaveText(new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(paused.company.cash));
  await expect(page.getByTestId('company-economy-time')).toHaveText(`Day ${(Math.floor(paused.economy.tick/24)+1).toLocaleString('en-GB')} · Tick ${paused.economy.tick.toLocaleString('en-GB')}`);
  await expectRailwayToClearFinances(page);
  await panel.getByRole('button',{name:'Find train',exact:true}).first().click();
  await page.screenshot({path:testInfo.outputPath('regional-railway-desktop.png')});
  await panel.getByRole('button',{name:'Plans',exact:true}).click();await panel.getByRole('button',{name:'Rehearse current railway',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Rehearsal complete',{timeout:40000});
  const after=await snapshot(page);expect(after.company).toEqual(paused.company);expect(after.management).toEqual(paused.management);expect(after.trains).toEqual(paused.trains);
  await panel.getByRole('button',{name:'Company',exact:true}).click();await panel.getByRole('button',{name:'Save world',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('World saved.');
  await page.reload();await page.waitForFunction(()=>window.__railSimScene==='MenuScene',undefined,{timeout:40000});await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__railSimScene==='WorldSelectScene');await page.locator('canvas').click({position:{x:683,y:200}});
  await page.waitForFunction(()=>window.__railSimScene==='WorldScene');const reloaded=await snapshot(page);expect(reloaded.management!.services[0].name).toBe('Timber shuttle');expect(reloaded.trains[0].operations.lifetimeDeliveredUnits).toBe(after.trains[0].operations.lifetimeDeliveredUnits);
  expect(errors).toEqual([]);
});
test.describe('landscape touch',()=>{
  test.use({hasTouch:true});
  test('creation, projects and construction panels fit a phone without hover',async({page},testInfo)=>{
    test.setTimeout(90000);await openRegion(page,844,390);const panel=page.locator('.railway-panel');
    await expectRailwayToClearFinances(page);
    await panel.getByRole('button',{name:'Projects',exact:true}).tap();await expect(panel.getByRole('heading',{name:'Homes by the Railway',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Accept project',exact:true}).first().tap();expect((await snapshot(page)).region!.projects[0].accepted).toBe(true);
    await page.screenshot({path:testInfo.outputPath('regional-projects-phone.png')});
    await panel.getByRole('button',{name:'Plans',exact:true}).tap();await expect(panel.getByRole('button',{name:'Preview connection',exact:true})).toBeVisible();
    const bounds=await panel.boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(844);
    const buttonSizes=await panel.locator('button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height));expect(buttonSizes.every(h=>h>=44||h===0)).toBe(true);
    await page.setViewportSize({width:668,height:375});
    await expectRailwayToClearFinances(page);
    const resizedButtons=await panel.locator('button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height));expect(resizedButtons.every(h=>h>=44||h===0)).toBe(true);
  });
});
