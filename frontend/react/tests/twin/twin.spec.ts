import { expect, test, type Page } from '@playwright/test';

const requested = (page: Page) => page.locator('html');

test.use({
  launchOptions: async ({ browserName }, use) => {
    await use(browserName === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'] } : {});
  },
});

test('limits site and zone tracker lists to six rows and keeps search and inspection working across pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/twin?fixture=twin-pagination');
  const inspector = page.getByRole('complementary', { name: 'Tracker inspector' });
  const mapPanel = page.getByRole('region', { name: 'Mine plan' });
  const panelHeightDifference = async () => Math.abs((await mapPanel.boundingBox())!.height - (await inspector.boundingBox())!.height);
  const pages = inspector.getByRole('navigation', { name: 'Tracker pages' });
  await expect(inspector.getByRole('listitem')).toHaveCount(6);
  await expect.poll(panelHeightDifference).toBeLessThan(1);
  await expect(inspector.getByRole('status')).toHaveText('1–6 of 15 results');
  await pages.getByRole('button', { name: 'Next page' }).press('Enter');
  await expect(inspector.getByRole('status')).toHaveText('7–12 of 15 results');
  const tracker = inspector.getByRole('button', { name: /Survey tracker 2\b/ });
  await tracker.click();
  await expect(inspector.getByRole('heading', { name: 'Survey tracker 2' })).toBeVisible();
  await expect.poll(panelHeightDifference).toBeLessThan(1);
  await inspector.getByRole('button', { name: 'Close details' }).click();
  await expect(tracker).toBeFocused();
  await pages.getByRole('button', { name: 'Next page' }).click();
  await expect(inspector.getByRole('listitem')).toHaveCount(3);
  await expect(pages.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await inspector.getByRole('searchbox', { name: 'Search trackers' }).fill('survey tracker');
  await expect(inspector.getByRole('status')).toHaveText('1–6 of 10 results');
  await pages.getByRole('button', { name: 'Next page' }).click();
  await inspector.getByRole('combobox', { name: 'Tracker type' }).selectOption('personnel');
  await expect(inspector.getByRole('status')).toHaveText('1–6 of 10 results');
  await page.getByRole('combobox', { name: 'Inspect mapped zone' }).selectOption('100');
  const zonePages = inspector.getByRole('navigation', { name: 'Trackers in zone pages' });
  await expect(inspector.getByRole('listitem')).toHaveCount(6);
  await zonePages.getByRole('button', { name: 'Next page' }).click();
  await expect(zonePages).toContainText('Page 2 of 2');
  await page.setViewportSize({ width: 390, height: 844 });
  const mapBounds = (await mapPanel.boundingBox())!;
  const trackerBounds = (await inspector.boundingBox())!;
  expect(trackerBounds.y).toBeGreaterThanOrEqual(mapBounds.y + mapBounds.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('isolates a late response from the previous site and clears site-specific selection', async ({ page }) => {
  await page.goto('/twin?fixture=twin-race');
  await expect(requested(page)).toHaveAttribute('data-fixture-twin-requests', '1');
  const site = page.getByRole('combobox', { name: 'Active site' });
  await site.selectOption('2');
  await expect(page.getByRole('button', { name: /South survey kit/ })).toBeVisible();
  await expect(requested(page)).toHaveAttribute('data-fixture-twin-site-one-completed', 'true');
  await expect(page.getByRole('button', { name: /Maya Chen/ })).toHaveCount(0);
  await page.getByRole('button', { name: /South survey kit/ }).click();
  await expect(page.getByRole('heading', { name: 'South survey kit' })).toBeFocused();
  await site.selectOption('1');
  await expect(page.getByRole('heading', { name: 'South survey kit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Maya Chen/ })).toBeVisible();
});

test('keeps a same-site snapshot, inspection and map position during refresh failure and retry', async ({ page }) => {
  await page.goto('/twin?fixture=twin-refresh');
  const map = page.getByRole('img', { name: 'Data-backed facility layout' });
  const initialFrame = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: /Service vehicle 12/ }).click();
  await expect(page.getByRole('heading', { name: 'Service vehicle 12' })).toBeVisible();
  await expect(map.locator('[data-selected][data-uncertain]').first()).toBeVisible();
  await expect(map).not.toHaveAttribute('viewBox', initialFrame!);
  const frame = await map.getAttribute('viewBox');
  const fetched = await page.locator('.dt-retrieved time').getAttribute('datetime');
  await page.getByRole('button', { name: 'Refresh Digital Twin' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updates delayed' })).toBeVisible();
  await expect(page.getByText('Last-known zone: S-02')).toBeVisible();
  await expect(map).toHaveAttribute('viewBox', frame!);
  await expect(page.locator('.dt-retrieved time')).toHaveAttribute('datetime', fetched!);
  await page.getByRole('button', { name: 'Retry Digital Twin' }).click();
  await expect(page.getByText(/Updates delayed/)).toHaveCount(0);
  await expect(map).toHaveAttribute('viewBox', frame!);
  await expect(page.getByRole('heading', { name: 'Service vehicle 12' })).toBeVisible();
});

test('searches normalized labels, node IDs and zones, and keeps map layers independent', async ({ page }) => {
  await page.goto('/twin');
  const search = page.getByRole('searchbox', { name: 'Search trackers' });
  const plan = page.getByRole('img', { name: 'Data-backed facility layout' });
  await search.fill('  MAYA   CHEN ');
  await expect(page.getByText('1 result', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Personnel', exact: true }).click();
  const maya = page.getByRole('button', { name: /Maya Chen/ });
  await maya.press('Enter');
  await expect(page.getByRole('heading', { name: 'Maya Chen' })).toBeFocused();
  await expect(plan.locator('path[data-selected]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal on map' }).click();
  await expect(plan.locator('path[data-zone="100"][data-selected]')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).press('Enter');
  await expect(maya).toBeFocused();
  await search.fill('trk-207');
  await expect(page.getByRole('button', { name: /Service vehicle 12/ })).toBeVisible();
  await search.fill('north   access');
  await expect(page.getByText('2 results', { exact: true })).toBeVisible();
  await search.fill('no matching tracker');
  await expect(page.getByText('No trackers match your filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear list filters' }).click();
  await expect(page.getByText('5 results', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await plan.locator('.dt-map-label').filter({ hasText: 'North access' }).locator('text').first().click();
  await expect(page.getByRole('heading', { name: 'North access' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Trackers reported in this zone' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Inspect mapped zone' }).selectOption('101');
  await expect(page.getByRole('heading', { name: 'Service bay' })).toBeFocused();
  await page.getByRole('button', { name: 'Close details' }).press('Enter');
  await expect(page.getByRole('combobox', { name: 'Inspect mapped zone' })).toBeFocused();
});

test('keeps tracker details available with invalid geometry or missing observations', async ({ page }) => {
  await page.goto('/twin?fixture=twin-no-layout');
  await expect(page.getByRole('heading', { name: 'No usable mine plan' })).toBeVisible();
  await expect(page.getByText('Network topology unavailable', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /Jules Banda/ }).click();
  await expect(page.getByText('Timestamp unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/Location unknown\. This tracker/)).toBeVisible();
  await page.getByRole('button', { name: 'All trackers' }).click();
  await page.getByRole('button', { name: /East gateway/ }).click();
  await expect(page.getByText(/reported zone has no matching geometry/)).toBeVisible();
  await page.goto('/twin?fixture=twin-empty');
  await expect(page.getByText('No trackers are reported for this site.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Data-backed facility layout' })).toBeVisible();
  await page.goto('/twin?fixture=twin-unavailable');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('keeps selection through WebGL failure and resets the camera for explicit levels', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto('/twin?fixture=twin-levels');
  await page.getByRole('button', { name: /Maya Chen/ }).click();
  const plan = page.getByRole('img', { name: 'Data-backed facility layout' });
  const initial = await plan.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Pan right' }).press('Enter');
  await expect(plan).not.toHaveAttribute('viewBox', initial!);
  await page.getByRole('combobox', { name: 'Map level' }).selectOption('24');
  await expect(plan.locator('path[data-zone="100"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal on map' }).click();
  await expect(plan.locator('path[data-zone="100"][data-selected]')).toBeVisible();
  await page.getByRole('button', { name: '3D Schematic' }).click();
  await expect(page.getByRole('heading', { name: '3D view unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maya Chen' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to 2D plan' }).click();
  await expect(page.getByRole('button', { name: '2D Plan' })).toBeFocused();
  await expect(plan.locator('path[data-zone="100"][data-selected]')).toBeVisible();
});

test.describe('rendered schematic and shell', () => {
  test('switches views with a selected tracker and keeps the stage theme local', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'This check uses Chromium’s software WebGL renderer.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/twin');
    const picker = page.getByRole('combobox', { name: 'Stage theme' });
    await expect(requested(page)).toHaveAttribute('data-theme', 'light');
    await picker.selectOption('dark');
    await expect(page.locator('.dt-stage')).toHaveAttribute('data-stage-theme', 'dark');
    await page.getByRole('button', { name: /Maya Chen/ }).click();
    await page.getByRole('button', { name: '3D Schematic' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    const badge = page.locator('.dt-schematic-tag[data-selected]');
    await expect(badge).toContainText('N-01');
    const original = Math.round((await badge.boundingBox())!.x);
    await page.getByRole('button', { name: 'Rotate right' }).press('Enter');
    await expect.poll(async () => Math.round((await badge.boundingBox())!.x)).not.toBe(original);
    const rotated = Math.round((await badge.boundingBox())!.x);
    await page.getByRole('button', { name: 'Refresh Digital Twin' }).click();
    await expect(requested(page)).toHaveAttribute('data-fixture-twin-requests', '2');
    await expect(page.getByRole('button', { name: 'Refresh Digital Twin' })).toBeEnabled();
    await expect.poll(async () => Math.round((await badge.boundingBox())!.x)).toBe(rotated);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await page.getByRole('button', { name: '2D Plan' }).click();
    await expect(page.getByRole('heading', { name: 'Maya Chen' })).toBeVisible();
    await page.getByRole('button', { name: '3D Schematic' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(badge).toBeVisible();
    await page.locator('canvas').dispatchEvent('webglcontextlost');
    await expect(page.getByRole('heading', { name: '3D view unavailable' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to 2D plan' }).click();
    await expect(page.getByRole('heading', { name: 'Maya Chen' })).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('region', { name: 'Unresolved incidents' })).toBeVisible();
    await expect(requested(page)).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /Account for/ }).click();
    await page.getByRole('menuitem', { name: 'Switch to dark theme' }).click();
    await page.getByRole('link', { name: 'Digital Twin', exact: true }).click();
    await expect(picker).toHaveValue('app');
    await expect(page.locator('.dt-stage')).toHaveAttribute('data-stage-theme', 'dark');
  });

  test('allows mobile touch scrolling over the stage and wraps long tracker and zone names', async ({ browser, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'This check dispatches a real scrolling gesture through Chromium CDP.');
    const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await mobile.newPage();
      await page.goto('/twin?fixture=twin-long');
      await page.getByRole('button', { name: '3D Schematic' }).click();
      const map = page.locator('canvas');
      await expect(map).toBeVisible();
      const bounds = (await map.boundingBox())!;
      const x = Math.round(bounds.x + bounds.width / 2);
      const bottom = Math.round(bounds.y + bounds.height * 0.8);
      const session = await mobile.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: bottom }] });
      for (let delta = 25; delta <= 150; delta += 25) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: bottom - delta }] });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.getByRole('link', { name: 'View trackers' }).click();
      const inspector = page.getByRole('complementary', { name: 'Tracker inspector' });
      await expect(inspector).toBeFocused();
      await inspector.getByRole('button', { name: /Service vehicle with an unusually long/ }).tap();
      await expect(inspector.getByRole('heading', { name: /Service vehicle with an unusually long/ })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 320, height: 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    } finally { await mobile.close(); }
  });
});
