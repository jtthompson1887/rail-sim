import { test, expect, type Page } from '@playwright/test';

const snapshot = (page: Page) => page.evaluate(() => window.__railSimFirstRouteHarness!.snapshot().world);

async function buildRegionalTrack(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your railways', exact: true }).click();
  await page.waitForFunction(() => window.__railSimScene === 'WorldSelectScene');
  const viewport = page.viewportSize()!;
  await page.locator('canvas').click({position:{x:viewport.width/2,y:viewport.height-90}});
  const picker = page.getByRole('dialog', {name:'Create railway region'});
  await picker.getByLabel('World seed').fill('playtest-884');
  await picker.getByLabel('Landscape').selectOption('lowlands');
  await picker.getByRole('button', {name:'Create region',exact:true}).click();
  await page.waitForFunction(() => window.__railSimScene === 'WorldScene');
  const panel = page.locator('.railway-panel');
  await panel.getByRole('button', {name:'Railway',exact:true}).click();
  const before = await snapshot(page);
  expect(before.management!.speed).toBe(0);expect(before.trains).toHaveLength(0);
  await panel.getByRole('button', {name:'Plans',exact:true}).click();
  await panel.locator('[name="from"]').selectOption(before.economy.facilities.find(f=>f.definitionId==='managed-forest')!.id);
  await panel.locator('[name="to"]').selectOption(before.economy.facilities.find(f=>f.definitionId==='sawmill')!.id);
  await panel.getByRole('button', {name:'Preview connection',exact:true}).click();
  await panel.getByRole('button', {name:'Build draft',exact:true}).click();
  expect((await snapshot(page)).tracks.length).toBeGreaterThan(0);
  return panel;
}

test('new region: Vehicle and N open Fleet, purchase charges once and survives reopening', async ({page},testInfo) => {
  test.setTimeout(90000);await page.setViewportSize({width:1366,height:700});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const panel=await buildRegionalTrack(page);
  await panel.getByRole('button',{name:'Railway',exact:true}).click();
  // Read the actual Phaser button's position, then click it through the mouse.
  const position=await page.evaluate(()=>{
    const scene=window.__railSimGame.scene.getScene('EditorUIScene') as any;
    const button=scene.toolbar.toolButtons.find((b:any)=>b.tool==='place-vehicle').bg;
    return {x:button.x,y:button.y};
  });
  await page.locator('canvas').click({position});
  await expect(panel.getByRole('heading',{name:'Fleet depot'})).toBeVisible();
  await expect(page.getByTestId('vehicle-purchase-panel')).toBeHidden();
  await expect(page.getByTestId('fleet-purchase-price')).toHaveText('£75,000');
  const before=await snapshot(page);
  await panel.getByRole('button',{name:'Buy and place train',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Train purchased and placed');
  const bought=await snapshot(page);expect(bought.trains).toHaveLength(1);
  expect(bought.company.cash).toBe(before.company.cash-75000);
  expect(bought.company.ledger.filter(e=>e.category==='vehicle-capex')).toHaveLength(1);
  await panel.getByRole('button',{name:'Buy and place train',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('clear depot track');
  expect((await snapshot(page)).company).toEqual(bought.company);
  expect((await snapshot(page)).trains).toEqual(bought.trains);
  await page.screenshot({path:testInfo.outputPath('vehicle-purchase-desktop.png')});
  await panel.getByRole('button',{name:'Company',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Your railway company'})).toBeVisible();
  await panel.getByRole('button',{name:'Save world',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText(/Saving world…|World saved\./);
  await expect(panel.getByRole('status')).toHaveText('World saved.',{timeout:20000});
  await page.reload();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(()=>window.__railSimScene==='WorldScene');
  const reopened=await snapshot(page);expect(reopened.trains).toEqual(bought.trains);expect(reopened.company).toEqual(bought.company);
  await expect(panel.getByRole('heading',{name:'Fleet depot'})).toBeHidden();
  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();});
  await page.keyboard.press('n');await expect(panel.getByRole('heading',{name:'Fleet depot'})).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('Fleet on landscape touch',()=>{
  test.use({hasTouch:true,viewport:{width:844,height:390}});
  test('shows the rejection and remedy in view, then places a suitable train',async({page},testInfo)=>{
    test.setTimeout(90000);const panel=await buildRegionalTrack(page),before=await snapshot(page);
    await panel.getByRole('button',{name:'Fleet',exact:true}).tap();
    await panel.getByLabel('Powered family').selectOption('electric-freight');
    await expect(page.getByTestId('fleet-purchase-price')).toHaveText('£180,000');
    await panel.getByRole('button',{name:'Buy and place train',exact:true}).tap();
    await expect(panel.getByRole('status')).toContainText('Electrify the depot track');
    await expect(panel.getByRole('status')).toBeInViewport();
    expect((await snapshot(page)).company).toEqual(before.company);expect((await snapshot(page)).trains).toHaveLength(0);
    await page.screenshot({path:testInfo.outputPath('vehicle-purchase-touch-feedback.png')});
    await panel.getByLabel('Powered family').selectOption('diesel-shunter');
    await panel.getByRole('button',{name:'Buy and place train',exact:true}).tap();
    await expect(panel.getByRole('status')).toContainText('Train purchased and placed');
    await expect(panel.getByRole('status')).toBeInViewport();
    expect((await snapshot(page)).trains).toHaveLength(1);expect((await snapshot(page)).company.cash).toBe(before.company.cash-75000);
  });
});
