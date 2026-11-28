import { expect, test, type Page } from '@playwright/test';

const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Personnel' });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const latest = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Latest location', exact: true }) });

async function register(page: Page, name = 'Mwamba Phiri', identifier = 'PER-0082') {
  await page.getByRole('button', { name: 'Register person' }).click();
  const form = dialog(page, 'Register person');
  await expect(form.getByLabel('Full name')).toBeFocused();
  await form.getByLabel('Full name').fill(name);
  await form.getByLabel('Personnel ID').fill(identifier);
  await form.getByLabel('Operational role').selectOption('MAINTENANCE_TECHNICIAN');
  await form.getByLabel('Team / crew').fill('Ventilation crew');
  return form;
}

test('registers, reloads, edits and clears a role over the normal routes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/personnel?fixture=personnel-standard');
  await expect(page.getByRole('row', { name: /Amina Mulenga/ })).toContainText('Last-known zone: NORTH ACCESS');
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/personnel-review/roster.png' });
  const form = await register(page);
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/personnel-review/registration.png', animations: 'disabled' });
  await form.getByRole('button', { name: 'Register person' }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Mwamba Phiri registered' })).toBeVisible();
  await page.getByRole('link', { name: 'View person' }).click();
  await expect(page.getByRole('heading', { name: 'Mwamba Phiri' })).toBeFocused();
  await expect(page.getByText('No wearable assigned', { exact: true })).toBeVisible();
  await expect(page.getByText('No account linked', { exact: true })).toBeVisible();
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/personnel-review/unassigned.png' });
  await page.reload();
  await expect(page).toHaveTitle('Mwamba Phiri · ComPallette');
  await expect(page.getByText('Maintenance technician', { exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-personnel-writes');
  await page.getByRole('button', { name: 'Edit person' }).click();
  await dialog(page, 'Edit person').getByLabel('Operational role').selectOption('SHIFT_SUPERVISOR');
  await dialog(page, 'Edit person').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Shift supervisor', { exact: true })).toBeVisible();
  await breadcrumb(page).click();
  await expect(page.getByRole('row', { name: /Mwamba Phiri/ })).toContainText('Shift supervisor');
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('SHIFT_SUPERVISOR');
  await page.getByRole('link', { name: 'Mwamba Phiri' }).click();
  await page.getByRole('button', { name: 'Edit person' }).click();
  await dialog(page, 'Edit person').getByLabel('Operational role').selectOption('');
  await dialog(page, 'Edit person').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Unassigned', { exact: true })).toBeVisible();
  await breadcrumb(page).click();
  await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('SHIFT_SUPERVISOR');
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeFocused();
  await expect(page.getByText(/outside the current roster view/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('row', { name: /Mwamba Phiri/ })).toContainText('Unassigned');
});

test('hands registration to assignment and keeps prior device observations out of the person location', async ({ page }, info) => {
  await page.goto('/personnel?fixture=personnel-standard');
  await (await register(page)).getByRole('button', { name: 'Register person' }).click();
  await page.getByRole('link', { name: 'Assign wearable' }).click();
  const assign = dialog(page, 'Assign wearable');
  await assign.getByLabel('Eligible wearable').selectOption('BADGE-014');
  await expect(assign.getByText(/Assign wearable BADGE-014 to Mwamba Phiri \(PER-0082\)/)).toBeVisible();
  await assign.getByRole('button', { name: 'Confirm assignment' }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Wearable BADGE-014 assigned.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wearable', exact: true })).toBeFocused();
  await expect(latest(page)).toContainText('No usable location observation');
  await expect(latest(page)).not.toContainText('OLDER ZONE');
  await expect(page.getByRole('heading', { name: 'Device location observations' })).toBeVisible();
  await expect(page.getByText('OLDER ZONE', { exact: true })).toBeVisible();
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/personnel-review/assigned.png' });
  await breadcrumb(page).click();
  await expect(page.getByRole('row', { name: /Mwamba Phiri/ })).toContainText('BADGE-014');
});

test('restores the read-only operator’s search, sort, scroll and person link', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto('/personnel?fixture=personnel-readonly');
  await expect(page.getByRole('button', { name: 'Register person' })).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search personnel' });
  await search.fill('ventilation');
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('UNDERGROUND_MINER');
  await page.getByRole('button', { name: 'Person', exact: true }).click();
  const origin = page.getByRole('link', { name: 'Ventilation crew member 08', exact: true });
  await origin.scrollIntoViewIfNeeded();
  const scroller = page.locator('.personnel-table-frame');
  const scroll = await scroller.evaluate(element => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await origin.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ventilation crew member 08' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Edit person' })).toHaveCount(0);
  await expect(page.getByText('Administrative audit')).toHaveCount(0);
  await page.goBack();
  await expect(search).toHaveValue('ventilation');
  await expect(page.getByRole('columnheader', { name: 'Person' })).toHaveAttribute('aria-sort', 'descending');
  await expect(origin).toBeFocused();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(scroll);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Ventilation crew member 08' })).toBeVisible();
  await breadcrumb(page).click();
  await expect(origin).toBeFocused();
  const direct = await context.newPage();
  await direct.goto('/personnel/1?fixture=personnel-readonly');
  await expect(direct.getByRole('heading', { name: 'Amina Mulenga' })).toBeVisible();
  await expect(latest(direct)).toContainText('Last-known zone: NORTH ACCESS');
  await direct.reload();
  await expect(direct.locator('html')).not.toHaveAttribute('data-personnel-writes');
  await breadcrumb(direct).click();
  await expect(direct).toHaveURL(/\/personnel$/);
  await direct.close();
});

test('recovers from stale edits and competing wearable assignments', async ({ page }) => {
  await page.goto('/personnel/2?fixture=personnel-conflict');
  await page.getByRole('button', { name: 'Edit person' }).click();
  const edit = dialog(page, 'Edit person');
  await edit.getByLabel('Team / crew').fill('Shift B');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toContainText('The record changed');
  await edit.getByRole('button', { name: 'Reload edit form' }).click();
  await expect(edit.getByLabel('Team / crew')).toHaveValue('Ventilation crew');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  const action = page.getByRole('button', { name: 'Assign wearable', exact: true });
  await action.click();
  const assign = dialog(page, 'Assign wearable');
  await assign.getByLabel('Eligible wearable').selectOption('BADGE-014');
  await assign.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(assign.getByRole('alert')).toContainText('A competing relationship change');
  await assign.getByRole('button', { name: 'Review latest options' }).click();
  await expect(assign.getByRole('option', { name: 'BADGE-014' })).toHaveCount(0);
  await assign.getByLabel('Eligible wearable').selectOption('BADGE-017');
  await assign.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.getByText('Wearable BADGE-017 assigned.', { exact: true })).toBeVisible();
});

test('keeps duplicate ID feedback in the form and isolates old-site fetches', async ({ page }) => {
  await page.goto('/personnel?fixture=personnel-slow');
  const activeSite = page.getByRole('combobox', { name: 'Active site' });
  await page.getByRole('searchbox', { name: 'Search personnel' }).fill('ventilation');
  await activeSite.selectOption('2');
  await expect(page.getByRole('heading', { name: 'No personnel registered at this site' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search personnel' })).toHaveValue('');
  await activeSite.selectOption('1');
  const form = await register(page, 'Duplicate draft', 'PER-0001');
  await form.getByRole('button', { name: 'Register person' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await form.getByRole('link', { name: /Personnel ID: This personnel ID/ }).click();
  await expect(form.getByLabel('Personnel ID')).toBeFocused();
  await expect(form.getByLabel('Full name')).toHaveValue('Duplicate draft');
});

test('keeps in-flight writes scoped when the active site changes', async ({ page }) => {
  const changeSiteWhileDialogIsOpen = () => page.locator('select[aria-label="Active site"]').evaluate((input: HTMLSelectElement) => {
    input.value = '2';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.goto('/personnel?fixture=personnel-slow');
  const form = await register(page);
  await form.getByRole('button', { name: 'Register person' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-pending-personnel-write', 'registration');
  await changeSiteWhileDialogIsOpen();
  await expect(page.getByRole('heading', { name: 'No personnel registered at this site' })).toBeVisible();
  await expect(page.getByText('Mwamba Phiri registered', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Active site' }).selectOption('1');
  await page.getByRole('link', { name: 'Mwamba Phiri' }).click();
  await page.getByRole('button', { name: 'Assign wearable', exact: true }).click();
  const wearable = dialog(page, 'Assign wearable');
  await wearable.getByLabel('Eligible wearable').selectOption('BADGE-014');
  await wearable.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-pending-personnel-write', 'entity');
  await changeSiteWhileDialogIsOpen();
  await expect(page.getByText('This record belongs to another permitted site.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mwamba Phiri' })).toHaveCount(0);
  await expect(page.getByText('Wearable BADGE-014 assigned.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('completes the flow on mobile with reduced motion and captures a dark detail', async ({ browser, browserName, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: browserName !== 'firefox' });
  const page = await context.newPage();
  try {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('compallette.theme', 'dark'));
  await page.goto('/personnel?fixture=personnel-standard');
  await (await register(page, 'Mwamba Phiri with a long operational display name')).getByRole('button', { name: 'Register person' }).press('Enter');
  await page.getByRole('link', { name: 'Assign wearable' }).tap();
  await dialog(page, 'Assign wearable').getByLabel('Eligible wearable').selectOption('BADGE-014');
  await dialog(page, 'Assign wearable').getByRole('button', { name: 'Confirm assignment' }).press('Enter');
  await expect(latest(page)).toContainText('No usable location observation');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/personnel-review/mobile-detail.png', fullPage: true });
  await breadcrumb(page).press('Enter');
  await expect(page.getByRole('link', { name: /Mwamba Phiri with/ })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    await context.close();
  }
});
