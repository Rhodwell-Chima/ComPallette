import { expect, test, type Page } from '@playwright/test';

const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Assets' });
const detail = (page: Page, heading: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const pump = 'Dewatering pump 04';
const screenshots = 'test-results/assets-review';

async function register(page: Page, identifier = 'PUMP-004') {
  await page.getByRole('button', { name: 'Register asset' }).click();
  const form = dialog(page, 'Register asset');
  await expect(form.getByLabel('Asset name')).toBeFocused();
  await form.getByLabel('Asset name').fill(pump);
  await form.getByLabel('Asset ID').fill(identifier);
  await form.getByLabel('Classification').fill('Pump');
  return form;
}

async function assign(page: Page, id = 'TAG-014', handoff = false) {
  if (!handoff) await page.getByRole('button', { name: 'Assign tracker' }).click();
  const form = dialog(page, 'Assign tracker');
  await form.getByLabel('Eligible tracker').selectOption(id);
  await expect(form.getByText(new RegExp(`Assign tracker ${id} to ${pump}`))).toBeVisible();
  await form.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(detail(page, 'Tracking device').getByRole('link', { name: id })).toBeVisible();
}

async function issue(page: Page, handoff = false) {
  if (!handoff) await page.getByRole('button', { name: 'Issue custody' }).click();
  const form = dialog(page, 'Issue custody');
  await form.getByLabel('Find by name or personnel ID').fill('0082');
  await form.getByLabel('Responsible person').selectOption('82');
  await expect(form.getByText(/Issue custody of Dewatering pump 04.*Mwamba Phiri/)).toBeVisible();
  await form.getByRole('button', { name: 'Confirm custody' }).click();
  await expect(detail(page, 'Custody').getByRole('link', { name: 'Mwamba Phiri' })).toBeVisible();
}

async function openAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'More asset actions' }).click();
  await page.getByRole('menuitem', { name }).click();
  return dialog(page, name);
}

test('registers, issues custody, assigns a tracker, reloads and edits an asset', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/assets?fixture=assets-standard');
  await expect(page.getByText('1–25 of 58 assets')).toBeVisible();
  const form = await register(page);
  if (info.project.name === 'chromium') await page.screenshot({ path: `${screenshots}/registration.png`, animations: 'disabled' });
  await form.getByRole('button', { name: 'Register asset' }).press('Enter');
  await expect(page.getByText(`${pump} registered`)).toBeVisible();
  await page.getByRole('link', { name: 'Issue custody' }).click();
  await expect(page.getByText('No tracker assigned', { exact: true })).toBeVisible();
  await issue(page, true);
  await assign(page);
  await expect(detail(page, 'Last reported location')).toContainText('Awaiting a location observation since assignment');
  await expect(detail(page, 'Last reported location')).not.toContainText('Level 2 Haulage');
  await expect(detail(page, 'Tracking device')).toContainText('OFFLINE');
  if (info.project.name === 'chromium') await page.screenshot({ path: `${screenshots}/detail.png` });
  await page.getByText('Tracker observations, readings, and incidents').click();
  await expect(page.getByText('Capture time unknown')).toBeVisible();
  await expect(page.getByText(/Level 2 Haulage/)).toBeVisible();
  await breadcrumb(page).click();
  await expect(page.getByRole('row', { name: /Dewatering pump 04/ })).toContainText('Mwamba Phiri');
  await expect(page.getByRole('row', { name: /Dewatering pump 04/ })).toContainText('TAG-014');
  if (info.project.name === 'chromium') await page.screenshot({ path: `${screenshots}/roster.png`, fullPage: true });
  await page.getByRole('link', { name: pump }).click();
  await page.reload();
  await expect(page).toHaveTitle(`${pump} · ComPallette`);
  await expect(page.locator('html')).not.toHaveAttribute('data-fixture-asset-writes');
  await page.getByRole('button', { name: 'Edit asset' }).click();
  const edit = dialog(page, 'Edit asset');
  await edit.getByLabel('Classification').fill('');
  await edit.getByLabel('Operational status').selectOption('MAINTENANCE');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/PUMP-004.*Unclassified.*Maintenance/)).toBeVisible();
  await expect(detail(page, 'Tracking device')).toContainText('TAG-014');
  await expect(detail(page, 'Custody')).toContainText('Mwamba Phiri');
  await detail(page, 'Custody').getByRole('link', { name: 'Mwamba Phiri' }).click();
  await page.getByText('Custody and device records').click();
  await expect(page.getByRole('link', { name: /Dewatering pump 04.*PUMP-004/ })).toBeVisible();
});

test('returns either relationship independently, then previews and transfers both', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/assets?fixture=assets-standard');
  await (await register(page)).getByRole('button', { name: 'Register asset' }).click();
  await page.getByRole('link', { name: 'Assign tracker' }).click();
  await assign(page, 'TAG-014', true);
  await issue(page);
  await page.getByRole('button', { name: 'Return custody' }).click();
  await dialog(page, 'Return custody').getByLabel('Reason').fill('Returned to stores');
  await dialog(page, 'Return custody').getByRole('button', { name: 'Confirm return' }).click();
  await expect(detail(page, 'Custody')).toContainText('No custodian');
  await expect(detail(page, 'Tracking device')).toContainText('TAG-014');
  await issue(page);
  await page.getByRole('button', { name: 'Release tracker' }).click();
  await dialog(page, 'Release tracker').getByLabel('Reason').fill('Battery service');
  await dialog(page, 'Release tracker').getByRole('button', { name: 'Confirm release' }).click();
  await expect(detail(page, 'Tracking device')).toContainText('No tracker assigned');
  await expect(detail(page, 'Custody')).toContainText('Mwamba Phiri');
  await assign(page);
  const transfer = await openAction(page, 'Transfer site');
  await transfer.getByLabel('Destination site').selectOption('2');
  await transfer.getByRole('button', { name: 'Preview affected relationships' }).click();
  await expect(transfer.getByText(/Release tracker TAG-014/)).toBeVisible();
  await expect(transfer.getByText(/End custody held by Mwamba Phiri · PER-0082/)).toBeVisible();
  await transfer.getByLabel('Reason').fill('Reallocate to the north dewatering team');
  if (info.project.name === 'chromium') await page.screenshot({ path: `${screenshots}/transfer.png`, animations: 'disabled' });
  await transfer.getByRole('button', { name: 'Confirm transfer' }).click();
  await page.getByRole('link', { name: 'Open asset at North Site' }).click();
  await expect(page.getByRole('heading', { name: pump })).toBeVisible();
  await expect(detail(page, 'Tracking device')).toContainText('No tracker assigned');
  await expect(detail(page, 'Custody')).toContainText('No custodian');
  await expect(detail(page, 'Last reported location')).toContainText('Location unknown');
  await page.getByText('Site-transfer history').click();
  await expect(page.getByText('Mining Pilot Site → North Site')).toBeVisible();
  await breadcrumb(page).click();
  await expect(page.getByRole('link', { name: pump })).toBeVisible();
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('1');
  await expect(page.getByText('1–25 of 58 assets')).toBeVisible();
  await expect(page.getByRole('link', { name: pump })).toHaveCount(0);
});

test('pages without repetition and restores a read-only operator’s filtered position', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 740 });
  await page.goto('/assets?fixture=assets-readonly');
  await expect(page.getByRole('button', { name: 'Register asset' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Classification' }).selectOption('Pump');
  const search = page.getByRole('searchbox', { name: 'Search assets' });
  await search.fill('pump');
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Asset', exact: true }).press('Enter');
  await expect(page.getByText('1–25 of 58 assets')).toBeVisible();
  const table = page.getByRole('table');
  const links = () => table.getByRole('link');
  const names = await links().allTextContents();
  await page.getByRole('button', { name: 'Next page' }).press('Enter');
  await expect(page.getByText('26–50 of 58 assets')).toBeVisible();
  await expect(links()).toHaveCount(25);
  names.push(...await links().allTextContents());
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('51–58 of 58 assets')).toBeVisible();
  await expect(links()).toHaveCount(8);
  names.push(...await links().allTextContents());
  expect(new Set(names).size).toBe(58);
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  const link = page.getByRole('link', { name: /Dewatering pump 04/ });
  await link.scrollIntoViewIfNeeded();
  const tableFrame = page.locator('[data-table-scroll]');
  await link.focus();
  const tableScroll = await tableFrame.evaluate(element => element.scrollTop);
  expect(tableScroll).toBeGreaterThan(0);
  await link.press('Enter');
  await expect(page.getByRole('heading', { name: /Dewatering pump 04/ })).toBeFocused();
  await expect(detail(page, 'Custody')).toContainText('Mwamba Phiri');
  await expect(detail(page, 'Last reported location')).toContainText('Last-known zone: Level 2 Haulage');
  await expect(detail(page, 'Last reported location').locator('time')).toHaveAttribute('datetime', /T/);
  await expect(page.getByRole('button', { name: 'Edit asset' })).toHaveCount(0);
  await expect(page.getByText('Administrative audit')).toHaveCount(0);
  await page.goBack();
  await expect(link).toBeFocused();
  await expect.poll(() => tableFrame.evaluate(element => element.scrollTop)).toBe(tableScroll);
  await expect(search).toHaveValue('pump');
  await expect(page.getByText('51–58 of 58 assets')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: /Dewatering pump 04/ })).toBeVisible();
  await breadcrumb(page).click();
  await expect(link).toBeFocused();
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('2');
  await expect(search).toHaveValue('');
  await expect(page).not.toHaveURL(/page=3/);
  await expect(page.getByText('0 assets', { exact: true })).toBeVisible();
});

test('requires a revised transfer preview after a competing custody issue', async ({ page }) => {
  await page.goto('/assets?fixture=assets-standard');
  await (await register(page)).getByRole('button', { name: 'Register asset' }).click();
  await page.getByRole('link', { name: 'View asset' }).click();
  await assign(page);
  const transfer = await openAction(page, 'Transfer site');
  await transfer.getByLabel('Destination site').selectOption('2');
  await transfer.getByRole('button', { name: 'Preview affected relationships' }).click();
  await expect(transfer.getByText(/Release tracker TAG-014/)).toBeVisible();
  await expect(transfer.getByText(/End custody/)).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.fixtureAssetConflict = 'transfer'; });
  await transfer.getByLabel('Reason').fill('Move to North');
  await transfer.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(transfer.getByRole('alert')).toContainText('A competing change was saved.');
  await expect(transfer.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  await transfer.getByRole('button', { name: 'Review current record' }).click();
  await transfer.getByLabel('Destination site').selectOption('2');
  await transfer.getByRole('button', { name: 'Preview affected relationships' }).click();
  await expect(transfer.getByText(/End custody held by Mwamba Phiri/)).toBeVisible();
  await transfer.getByLabel('Reason').fill('Move to North with reviewed custody');
  await transfer.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.getByRole('link', { name: 'Open asset at North Site' })).toBeVisible();
});

test('handles competing trackers, retries a lost response, and archives open relationships', async ({ page }) => {
  await page.goto('/assets?fixture=assets-standard');
  await (await register(page)).getByRole('button', { name: 'Register asset' }).click();
  await page.getByRole('link', { name: 'View asset' }).click();
  await page.getByRole('button', { name: 'Assign tracker' }).click();
  const assignForm = dialog(page, 'Assign tracker');
  await assignForm.getByLabel('Eligible tracker').selectOption('TAG-014');
  await page.evaluate(() => { document.documentElement.dataset.fixtureAssetConflict = 'assign'; });
  await assignForm.getByRole('button', { name: 'Confirm assignment' }).click();
  await assignForm.getByRole('button', { name: 'Review current record' }).click();
  await expect(assignForm.getByRole('option', { name: 'TAG-014' })).toHaveCount(0);
  await assignForm.getByLabel('Eligible tracker').selectOption('TAG-017');
  await page.evaluate(() => { document.documentElement.dataset.fixtureAssetLost = 'assign'; });
  await assignForm.getByRole('button', { name: 'Confirm assignment' }).click();
  await assignForm.getByRole('button', { name: 'Retry same operation' }).click();
  await expect(detail(page, 'Tracking device')).toContainText('TAG-017');
  await expect(detail(page, 'Tracker assignment history').getByRole('listitem')).toHaveCount(1);
  await issue(page);
  const archive = await openAction(page, 'Archive asset');
  await expect(archive.getByText(/Release tracker TAG-017/)).toBeVisible();
  await expect(archive.getByText(/End custody held by Mwamba Phiri/)).toBeVisible();
  await archive.getByLabel('Reason').fill('End of service');
  await archive.getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit asset' })).toHaveCount(0);
  await breadcrumb(page).click();
  await expect(page.getByRole('heading', { name: 'Asset registry' })).toBeFocused();
  await page.getByRole('combobox', { name: 'Record visibility' }).selectOption('archived');
  await expect(page.getByRole('link', { name: pump })).toBeVisible();
});

test('keeps duplicate errors in the form and old-site saves out of new-site results', async ({ page }) => {
  await page.goto('/assets?fixture=assets-slow');
  await (await register(page, 'P-010')).getByRole('button', { name: 'Register asset' }).click();
  const form = dialog(page, 'Register asset');
  await expect(form.getByText('This asset ID is already used in this organisation.', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Asset name')).toHaveValue(pump);
  await form.getByLabel('Asset ID').fill('PUMP-004');
  await page.evaluate(() => { delete document.documentElement.dataset.fixtureAssetPending; });
  await form.getByRole('button', { name: 'Register asset' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-asset-pending', 'registration');
  await page.evaluate(() => {
    const site = document.querySelector<HTMLSelectElement>('select[aria-label="Active site"]')!;
    site.value = '2';
    site.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('link', { name: 'North site drill' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(`${pump} registered`)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('1');
  await page.getByRole('link', { name: pump }).click();
  await page.getByRole('button', { name: 'Assign tracker' }).click();
  const assignment = dialog(page, 'Assign tracker');
  await assignment.getByLabel('Eligible tracker').selectOption('TAG-014');
  await assignment.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-asset-pending', 'action');
  await page.evaluate(() => {
    const site = document.querySelector<HTMLSelectElement>('select[aria-label="Active site"]')!;
    site.value = '2';
    site.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('heading', { name: 'Asset registered at another site' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Tracker assigned.', { exact: true })).toHaveCount(0);
});

test('clamps to the nearest valid page when the last visible asset is archived', async ({ page }) => {
  await page.goto('/assets?fixture=assets-clamp');
  await page.getByLabel('Assets per page').selectOption('50');
  await expect(page.getByText('1–50 of 51 assets')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('51–51 of 51 assets')).toBeVisible();
  await page.getByRole('link', { name: 'Ventilation drill' }).click();
  const archive = await openAction(page, 'Archive asset');
  await expect(archive.getByText('There are no open tracker or custody relationships to close.')).toBeVisible();
  await archive.getByLabel('Reason').fill('Retired');
  await archive.getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await breadcrumb(page).click();
  await expect(page.getByText('1–50 of 50 assets')).toBeVisible();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole('heading', { name: 'Asset registry' })).toBeFocused();
});

test('renders direct links on mobile and tablet in dark mode with reduced motion', async ({ browser }, info) => {
  const mobile = await browser.newContext({
    baseURL: String(info.project.use.baseURL), viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true,
  });
  try {
    const page = await mobile.newPage();
    await page.addInitScript(() => localStorage.setItem('compallette.theme', 'dark'));
    await page.goto('/assets/1?fixture=assets-readonly');
    await expect(page.getByRole('heading', { name: /Dewatering pump 04/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(detail(page, 'Last reported location')).toContainText('West Ventilation and Return Passage');
    if (info.project.name === 'chromium') await page.screenshot({ path: `${screenshots}/mobile.png`, fullPage: true });
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    await expect(detail(page, 'Last reported location')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-fixture-asset-writes');
    await expect(breadcrumb(page)).toBeVisible();
  } finally { await mobile.close(); }
});
