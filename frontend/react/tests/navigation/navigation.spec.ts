import { expect, test, type Page } from '@playwright/test';

const destinations = [
  ['Dashboard', '/'], ['Digital Twin', '/twin'], ['Personnel', '/personnel'],
  ['Assets', '/assets'], ['Environmental', '/environment'], ['Devices & Mesh', '/devices'],
  ['Gateways & Commissioning', '/gateways'], ['Sites & Zones', '/sites-zones'],
  ['Integrations', '/integrations'], ['Reports', '/reports'], ['Audit Trail', '/audit'],
  ['Users & Access', '/access'], ['Settings', '/settings'],
] as const;

const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary navigation' });
const incidents = (page: Page) => page.getByRole('navigation', { name: 'Incident navigation' });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Open navigation' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'ComPallette navigation' });
const account = (page: Page) => page.getByRole('button', { name: 'Account for TEST-OPERATOR' });

async function checkDestinations(page: Page) {
  const links = primary(page).getByRole('link');
  await expect(links).toHaveCount(destinations.length);
  const hrefs = await links.evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(new Set(hrefs)).toEqual(new Set(destinations.map(([, href]) => href)));
  await expect(primary(page).getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1);
}

test('uses one complete destination set and follows route history and direct links', async ({ page }) => {
  await page.goto('/alerts');
  await checkDestinations(page);
  await expect(incidents(page).getByRole('link', { name: 'Alerts & Incidents' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('banner').getByRole('link')).toHaveCount(1);
  for (const [label, href] of destinations) {
    const link = primary(page).getByRole('link', { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(url => url.pathname === href);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(primary(page).or(incidents(page)).locator('[aria-current]')).toHaveCount(1);
  }
  await page.goto('/personnel/1?source=fixture');
  await expect(page.getByRole('heading', { name: 'Isolated test person' })).toBeVisible();
  const personnel = primary(page).getByRole('link', { name: 'Personnel' });
  await expect(personnel).toHaveAttribute('aria-current', 'location');
  await page.reload();
  await expect(personnel).toHaveAttribute('aria-current', 'location');
  await primary(page).getByRole('link', { name: 'Assets' }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/personnel\/1\?source=fixture$/);
  await expect(personnel).toHaveAttribute('aria-current', 'location');
  await page.goForward();
  await expect(primary(page).getByRole('link', { name: 'Assets' })).toHaveAttribute('aria-current', 'page');
  await account(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Isolated test person' })).toBeFocused();
});

test('updates links when the selected site changes capabilities and preserves direct guards', async ({ page }) => {
  await page.goto('/settings');
  await expect(primary(page).getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('2');
  await expect(page.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();
  for (const name of ['Gateways & Commissioning', 'Audit Trail', 'Users & Access', 'Settings']) {
    await expect(primary(page).getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  await expect(primary(page).getByRole('link', { name: 'Sites & Zones' })).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('1');
  await expect(primary(page).getByRole('link', { name: 'Audit Trail' })).toHaveAttribute('aria-current', 'page');
});

test('traps focus in the mobile drawer and restores it on Escape and outside click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.goto('/alerts');
  await expect(primary(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await menuButton(page).focus();
  await menuButton(page).press('Enter');
  const close = drawer(page).getByRole('button', { name: 'Close navigation' });
  await expect(close).toBeFocused();
  await checkDestinations(page);
  await expect(incidents(page)).toHaveCount(0);
  await close.press('Shift+Tab');
  await expect(drawer(page).getByRole('link', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton(page)).toHaveCSS('outline-style', 'solid');
  await menuButton(page).click();
  await expect(close).toBeFocused();
  const backdrop = page.locator('.nav-overlay[data-state="open"]');
  const bounds = (await backdrop.boundingBox())!;
  await backdrop.click({ position: { x: bounds.width - 12, y: bounds.height / 2 } });
  await expect(drawer(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();
  await menuButton(page).click();
  await drawer(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
});

test('recovers from drawer resize and repeated open and close', async ({ page }) => {
  await page.setViewportSize({ width: 639, height: 900 });
  await page.goto('/alerts');
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(menuButton(page)).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(primary(page)).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('main')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 640 });
  for (let i = 0; i < 3; i++) {
    await menuButton(page).click();
    await page.keyboard.press('Escape');
    await expect(menuButton(page)).toBeFocused();
  }
  await expect(primary(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('keeps one account menu and gives keyboard and touch access to utilities', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 375, height: 760 } });
  try {
    const page = await context.newPage();
    await page.goto('/alerts');
    await expect(incidents(page).getByRole('link')).toHaveAccessibleDescription('2 new alerts');
    await menuButton(page).tap();
    await checkDestinations(page);
    await drawer(page).getByRole('button', { name: 'Close navigation' }).tap();
    await account(page).tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(1);
    await expect(menu.getByText('Settings', { exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Switch to dark theme' }).tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const confirmation = page.getByRole('dialog', { name: /Resolve alert/ });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    const health = page.getByRole('button', { name: 'Backend telemetry link: Connected' });
    await health.tap();
    await expect(page.getByRole('dialog', { name: 'Backend diagnostics' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(health).toBeFocused();
    await account(page).focus();
    await account(page).press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Switch to light theme' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('searches the selected site and focuses content after navigating to a result', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/alerts?fixture=slow-search');
  const trigger = page.getByRole('button', { name: 'Search records' });
  await expect(trigger).toBeVisible();
  await page.keyboard.press('Control+k');
  const panel = page.getByRole('dialog', { name: 'Search site records' });
  const field = panel.getByRole('searchbox');
  await expect(field).toBeFocused();
  await field.fill('no results');
  await expect(panel.getByRole('status')).toHaveText('Searching…');
  await expect(panel.getByRole('status')).toHaveText('No matching records.');
  await field.fill('Isolated');
  await expect(panel.getByRole('link', { name: /Isolated test person/ })).toBeVisible();
  await field.press('Enter');
  await expect(page).toHaveURL(/\/personnel\/1$/);
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('keeps an incident draft and the header link mounted across navigation', async ({ page }) => {
  await page.goto('/alerts');
  const incidentLink = incidents(page).getByRole('link');
  const originalLink = await incidentLink.elementHandle();
  const notes = page.getByRole('textbox', { name: 'Investigation / resolution notes' });
  await notes.fill('Isolated handover draft');
  await primary(page).getByRole('link', { name: 'Dashboard' }).click();
  await expect(incidentLink).toHaveAccessibleDescription('2 new alerts');
  expect(await originalLink?.evaluate(element => element.isConnected)).toBe(true);
  await incidentLink.click();
  await expect(notes).toHaveValue('Isolated handover draft');
});

test('reports unavailable telemetry and alert count in an isolated outage', async ({ page }) => {
  await page.goto('/environment?fixture=offline');
  await expect(page.getByRole('button', { name: 'Backend telemetry link: Connection failed' })).toBeVisible();
  await expect(incidents(page).getByRole('link')).toHaveAccessibleDescription('New alert count unavailable');
  await expect(primary(page).getByRole('link', { name: 'Environmental' })).toHaveAttribute('aria-current', 'page');
});

test('marks failed polling refreshes as unverified after a successful response', async ({ page }) => {
  await page.clock.install();
  await page.goto('/environment?fixture=stale');
  const alarm = incidents(page).getByRole('link');
  await expect(page.getByRole('button', { name: 'Backend telemetry link: Connected' })).toBeVisible();
  await expect(alarm).toHaveAccessibleDescription('2 new alerts');
  await page.clock.fastForward(16_000);
  await expect(alarm).toHaveAccessibleDescription('New alert count unavailable');
  await page.clock.fastForward(2_000);
  await expect(page.getByRole('button', { name: 'Backend telemetry link: Status unverified' })).toBeVisible();
});

test('fits long account names and capped alert counts and handles a missing account name', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/environment?fixture=long-account');
  const operator = page.getByRole('button', { name: /^Account for TEST-OPERATOR-WITH/ });
  await expect(operator).toBeVisible();
  const alarm = incidents(page).getByRole('link');
  await expect(alarm).toHaveAccessibleDescription('At least 100 new alerts');
  await expect(alarm).toHaveText('99+');
  expect(await page.getByRole('banner').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  await operator.click();
  await expect(page.getByRole('menu').getByText(/^TEST-OPERATOR-WITH/)).toBeVisible();
  await page.goto('/environment?fixture=missing-account');
  await expect(page.getByRole('button', { name: 'Account for Operator' })).toBeVisible();
});

test('returns to sign in after an expired session and redirects unsupported routes', async ({ page }) => {
  await page.goto('/unknown-navigation-destination');
  await expect(page).toHaveURL(url => url.pathname === '/');
  await expect(primary(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/environment?fixture=expired');
  await page.getByRole('button', { name: 'Search records' }).click();
  await page.getByRole('searchbox').fill('Isolated');
  await expect(page.getByText(/Your operator session ended/)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await expect(primary(page)).toHaveCount(0);
});

test('keeps navigation labels and focus indicators readable in both themes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Rendered color sampling is verified in Chromium.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/environment');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await account(page).click();
      await page.getByRole('menuitem', { name: 'Switch to dark theme' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    await page.getByRole('button', { name: 'Search records' }).focus();
    await page.keyboard.press('Tab');
    await expect(incidents(page).getByRole('link')).toBeFocused();
    const contrast = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      function luminance(color: string) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
          .map(byte => byte / 255)
          .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      }
      function ratio(fg: string, bg: string, outline = false) {
        const style = getComputedStyle(document.querySelector(fg)!);
        const a = luminance(outline ? style.outlineColor : style.color);
        const b = luminance(getComputedStyle(document.querySelector(bg)!).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
      return {
        link: ratio('.nav-destination:not([aria-current])', '.nav-sidebar'),
        group: ratio('.nav-group-heading', '.nav-sidebar'),
        active: ratio('.nav-destination[aria-current]', '.nav-selection'),
        utility: ratio('.nav-search-text', '.nav-header'),
        badge: ratio('.nav-alert-count', '.nav-alert-count'),
        focus: ratio('.nav-incident-link:focus-visible', '.nav-header', true),
      };
    });
    const { focus, ...textRatios } = contrast;
    for (const ratio of Object.values(textRatios)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(focus).toBeGreaterThanOrEqual(3);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(incidents(page).getByRole('link')).toHaveCSS('outline-style', 'solid');
  await expect(primary(page).getByRole('link', { name: 'Environmental' })).toHaveAttribute('aria-current', 'page');
});

test('persists desktop preference independently of mobile and tablet, and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/environment');
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(primary(page)).toHaveCSS('width', '235px');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(primary(page)).toHaveCSS('width', '71px');
  const twin = primary(page).getByRole('link', { name: 'Digital Twin' });
  await twin.focus();
  await expect(page.getByRole('tooltip', { name: 'Digital Twin' })).toBeVisible();
  await page.reload();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(expand).toHaveCount(0);
  await expect(primary(page)).toHaveCSS('width', '71px');
  await page.setViewportSize({ width: 390, height: 720 });
  await menuButton(page).click();
  await expect(drawer(page)).toHaveCSS('animation-name', 'none');
  await checkDestinations(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(primary(page)).toHaveCSS('width', '235px');
});

test('finishes an animated desktop collapse and expansion with the workspace resized', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const main = page.getByRole('main');
  const before = (await main.boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await main.boundingBox())!.width).toBe(before + 164);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect.poll(async () => (await main.boundingBox())!.width).toBe(before);
});

test('keeps the same operational map when changing sidebar width on Digital Twin', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/twin');
  const map = page.getByRole('img', { name: 'Data-backed facility layout' });
  const originalMap = await map.elementHandle();
  const before = (await map.boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await map.boundingBox())!.width).toBeGreaterThan(before);
  expect(await originalMap?.evaluate(element => element.isConnected)).toBe(true);
});

const viewports = [
  [314, 202], [320, 640], [360, 800], [375, 812], [390, 844], [430, 932], [639, 800],
  [640, 820], [648, 820], [740, 360], [768, 1024], [820, 1180], [1023, 768], [1024, 768], [1032, 768],
  [1280, 800], [1440, 900], [1536, 960], [1920, 1080], [2560, 1440],
] as const;

for (const [width, height] of viewports) {
  test(`fits the header and provides the correct navigation at ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/alerts');
    const header = page.getByRole('banner');
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS('height', '60px');
    expect(await header.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const desktop = width >= 1024;
    const mobile = width < 640 || (!desktop && height < 384);
    if (mobile) {
      await expect(primary(page)).toHaveCount(0);
      await menuButton(page).click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page).getByRole('link', { name: 'Integrations' })).toBeVisible();
    } else {
      await expect(menuButton(page)).toHaveCount(0);
      await checkDestinations(page);
      const first = primary(page).getByRole('link', { name: 'Dashboard' });
      await expect(first).toHaveCSS('min-height', '44px');
      if (desktop) await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
      else await expect(first).toHaveCSS('width', '44px');
    }
    if ([390, 768, 1440].includes(width)) {
      if (width === 768) {
        await account(page).click();
        await page.getByRole('menuitem', { name: 'Switch to dark theme' }).click();
        await expect(page.getByRole('menu')).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath('navigation.png'), animations: 'disabled' });
    }
  });
}
