import { expect, test, type Page } from '@playwright/test';

const snapshotReceived = (page: Page) => page.getByRole('status').filter({ hasText: 'Snapshot received' });
const incidents = (page: Page) => page.getByRole('region', { name: 'Unresolved incidents' });
const history = (page: Page) => page.getByRole('region', { name: 'Monitoring history' });
const requestCount = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.fixtureDashboardRequests ?? 0));

test('shows incidents before history and opens the selected alert for review', async ({ page }) => {
  await page.goto('/?fixture=dashboard-overload');
  await expect(snapshotReceived(page)).toBeVisible();
  await expect(incidents(page)).toContainText('10 unresolved');
  await expect(incidents(page)).toContainText('8 of 10 incidents are in this preview');
  expect((await incidents(page).boundingBox())!.y).toBeLessThan((await history(page).boundingBox())!.y);
  await incidents(page).getByRole('button', { name: 'Show 5 more in preview' }).press('Enter');
  await expect(incidents(page).getByRole('link', { name: /TEST-WARNING-5/ })).toBeVisible();
  await incidents(page).getByRole('link', { name: /TEST-OLDER-CRITICAL/ }).click();
  await expect(page).toHaveURL(/alert=77&review=1/);
  await expect(page.getByRole('heading', { name: 'TEST-OLDER-CRITICAL' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('keeps gaps, zeroes and native units visible in charts and their table', async ({ page }) => {
  await page.goto('/');
  await expect(snapshotReceived(page)).toBeVisible();
  await expect(history(page).getByRole('img', { name: /CO .*11 available buckets/ })).toBeVisible();
  await expect(history(page).locator('polyline')).toHaveCount(2);
  await history(page).getByText('View chart data').click();
  const table = history(page).getByRole('table');
  await expect(table.getByRole('cell', { name: '0', exact: true })).toHaveCount(1);
  await expect(table.getByRole('cell', { name: 'Unavailable' })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: 'CO (ppm)' })).toBeVisible();
  await history(page).getByRole('button', { name: 'Unresolved incidents' }).click();
  await expect(table.getByRole('columnheader', { name: 'Unresolved incidents' })).toBeVisible();
  await expect(table.getByRole('cell', { name: '0', exact: true })).toHaveCount(4);
  await expect(incidents(page).getByRole('link', { name: /TEST-ALARM-1/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Latest environmental readings' })).toContainText('0 ppm');
  await expect(page.getByRole('region', { name: 'Recorded zone associations' })).toContainText('North access');
  expect(await requestCount(page)).toBe(1);
});

test('isolates site switching, missing metrics and permissions', async ({ page }) => {
  await page.goto('/');
  const activeSite = page.getByRole('combobox', { name: 'Active site' });
  await expect(page.getByRole('region', { name: 'Recent operator activity' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('devices');
  await expect(page.getByText('GATEWAY REGISTERED')).toBeVisible();
  await expect(page.getByText('ALERT ASSIGNED')).toHaveCount(0);
  await activeSite.selectOption('2');
  await expect(page.getByText(/TEST SITE 2 · Africa/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent operator activity' })).toHaveCount(0);
  await expect(incidents(page).getByRole('link', { name: /TEST-ALARM-/ })).toHaveCount(0);
  await expect(incidents(page)).toContainText('No unresolved incidents reported');
  await page.goto('/?fixture=dashboard-partial');
  await activeSite.selectOption('1');
  await expect(page.getByRole('link', { name: /Online devices/ })).toContainText('0');
  await expect(page.getByRole('link', { name: /Registered assets/ })).toContainText('Unavailable');
  await expect(incidents(page)).toContainText('Incident details are unavailable');
  await expect(history(page)).toContainText('Historical data is unavailable');
});

test('retains a labeled snapshot on refresh failure and recovers on retry', async ({ page }) => {
  await page.goto('/?fixture=dashboard-flaky');
  const refresh = page.getByRole('button', { name: 'Refresh snapshot' });
  await expect(snapshotReceived(page)).toBeVisible();
  await refresh.click();
  await expect(page.getByRole('status').filter({ hasText: 'Snapshot unverified' })).toBeVisible();
  await expect(page.getByText(/Showing previously received data/)).toBeVisible();
  await expect(incidents(page).getByRole('link', { name: /TEST-ALARM-1/ })).toBeVisible();
  await refresh.click();
  await expect(snapshotReceived(page)).toBeVisible();
  await expect(page.getByText(/Showing previously received data/)).toHaveCount(0);
});

test('retains the incident preview while offline and resumes polling on reconnect', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(snapshotReceived(page)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'Browser offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh snapshot' })).toBeDisabled();
  await expect(incidents(page).getByRole('link', { name: /TEST-ALARM-1/ })).toBeVisible();
  await context.setOffline(false);
  await page.clock.fastForward(16_000);
  await expect(snapshotReceived(page)).toBeVisible();
  await expect.poll(() => requestCount(page)).toBeGreaterThan(1);
});

test('keeps the dashboard available when bootstrap refresh fails and hides activity', async ({ page }) => {
  await page.clock.install();
  await page.goto('/?fixture=dashboard-bootstrap-failure');
  await expect(snapshotReceived(page)).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(page.getByText(/Site access could not be refreshed/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent operator activity' })).toHaveCount(0);
  await expect(incidents(page)).toBeVisible();
});

test('handles initial loading, unavailable data, mismatched scope and no site', async ({ page }) => {
  await page.goto('/?fixture=dashboard-delay');
  await expect(page.getByRole('heading', { name: 'Loading operational data' })).toBeVisible();
  await expect(snapshotReceived(page)).toBeVisible();
  for (const scenario of ['dashboard-unavailable', 'dashboard-mismatched-site']) {
    await page.goto(`/?fixture=${scenario}`);
    await expect(page.getByRole('heading', { name: 'Operational data unavailable' })).toBeVisible();
    await expect(incidents(page)).toHaveCount(0);
  }
  await page.goto('/?fixture=dashboard-stale-generated');
  await expect(page.getByRole('status').filter({ hasText: 'Snapshot unverified' })).toBeVisible();
  await expect(incidents(page)).toBeVisible();
  await page.goto('/?fixture=dashboard-no-site');
  await expect(page.getByRole('heading', { name: 'No site is available' })).toBeVisible();
  expect(await requestCount(page)).toBe(0);
});

test('fits requested viewport widths and retains chart state when the navigation resizes', async ({ page }, testInfo) => {
  const sizes = [320, 360, 375, 390, 430, 480, 640, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920, 2560];
  await page.clock.setFixedTime(new Date('2026-11-17T08:00:00Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(snapshotReceived(page)).toBeVisible();
  await history(page).getByRole('button', { name: 'Dust (µg/m³)' }).click();
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await collapse.click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(collapse).toBeVisible();
  for (const [width, height] of [...sizes.map(width => [width, 920]), [740, 360]]) {
    await page.setViewportSize({ width, height });
    const workspace = page.locator('.dashboard-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate(element => element.scrollWidth - element.clientWidth), `${width}×${height}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(history(page).getByRole('button', { name: 'Dust (µg/m³)' })).toHaveAttribute('aria-pressed', 'true');
    if ([390, 768, 1440].includes(width)) {
      if (width === 768) {
        await page.getByRole('button', { name: 'Account for TEST-OPERATOR' }).click();
        await page.getByRole('menuitem', { name: 'Switch to dark theme' }).click();
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), animations: 'disabled', fullPage: true });
    }
  }
});
