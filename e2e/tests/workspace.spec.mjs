import { test, expect } from './fixtures.mjs';

const labPath = '/dashboard/lab/data-grid';
const grid = (page) => page.getByRole('table');
const firstCell = (page) => grid(page).getByRole('cell').first();

test('mobile navigation traps focus, Escape restores focus and desktop resize removes inert state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(labPath);
  const trigger = page.getByRole('button', { name: '打开导航', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: '主导航' });
  const close = drawer.getByRole('button', { name: '关闭导航' });
  await expect(close).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(trigger).toBeHidden();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '当前公司' })).toBeEnabled();
});

test('mobile drawer navigation closes the drawer and activates a workspace page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(labPath);
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '客户管理', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/customers$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(grid(page).getByRole('cell', { name: 'Customer of synthetic-a', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '已打开的工作页面' }).getByRole('button', { name: '客户管理', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('real layout keeps header and cells aligned during two-axis virtual scrolling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(labPath);
  await expect(firstCell(page)).toHaveText('ORD-202603-0001');
  const table = grid(page);
  expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const geometry = () => table.evaluate((element) => {
    const headers = [...element.querySelectorAll('[role="columnheader"]')];
    const row = element.querySelector('[role="cell"]')?.parentElement;
    return {
      headerTop: headers[0].getBoundingClientRect().top,
      tableTop: element.getBoundingClientRect().top,
      offsets: headers.map((header, index) => {
        const head = header.getBoundingClientRect();
        const cell = row.children[index].getBoundingClientRect();
        return Math.abs(head.left - cell.left) + Math.abs(head.width - cell.width);
      }),
    };
  });
  expect((await geometry()).offsets.every((offset) => offset < 1)).toBe(true);
  await table.evaluate((element) => { element.scrollLeft = 220; element.scrollTop = 20_000; });
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  await expect(firstCell(page)).not.toHaveText('ORD-202603-0001');
  expect(await table.getByRole('row').count()).toBeLessThan(100);
  const scrolled = await geometry();
  expect(scrolled.offsets.every((offset) => offset < 1)).toBe(true);
  expect(Math.abs(scrolled.headerTop - scrolled.tableTop)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('synthetic-grid-scroll.png'), fullPage: true });
});

test('inline edits commit, Escape cancels, and company switch clears in-memory drafts', async ({ page }) => {
  await page.goto(labPath);
  await firstCell(page).dblclick();
  await grid(page).getByRole('textbox').fill('Synthetic committed edit');
  await page.keyboard.press('Enter');
  await expect(firstCell(page)).toHaveText('Synthetic committed edit');
  await firstCell(page).dblclick();
  await grid(page).getByRole('textbox').fill('Synthetic cancelled edit');
  await page.keyboard.press('Escape');
  await expect(firstCell(page)).toHaveText('Synthetic committed edit');
  await firstCell(page).dblclick();
  await grid(page).getByRole('textbox').fill('Company A unsaved draft');
  await page.getByRole('combobox', { name: '当前公司' }).selectOption('synthetic-b');
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
  await expect(firstCell(page)).toHaveText('ORD-202603-0001');
  await expect(page.getByRole('combobox', { name: '当前公司' })).toHaveValue('synthetic-b');
  await page.getByRole('combobox', { name: '当前公司' }).selectOption('synthetic-a');
  await expect(firstCell(page)).toHaveText('ORD-202603-0001');
});

test('read-only production list does not create an inline editor on double click', async ({ page }) => {
  await page.goto('/dashboard/customers');
  const cell = grid(page).getByRole('cell', { name: 'Customer of synthetic-a', exact: true });
  await expect(cell).toBeVisible();
  await cell.dblclick();
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
  await expect(cell).toHaveText('Customer of synthetic-a');
  await expect(page.getByRole('button', { name: '新建 / 编辑', exact: true })).toBeDisabled();
});

test('workspace tabs activate existing routes without duplication and close to the previous page', async ({ page }) => {
  await page.goto(labPath);
  const nav = page.getByRole('navigation', { name: '主导航' });
  const tabs = page.getByRole('navigation', { name: '已打开的工作页面' });
  await nav.getByRole('button', { name: '客户管理', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/customers$/);
  await tabs.getByRole('button', { name: '网格实验', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/lab\/data-grid$/);
  await expect(tabs.getByRole('button', { name: '网格实验', exact: true })).toHaveCount(1);
  await expect(tabs.getByRole('button', { name: '网格实验', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('button', { name: '客户管理', exact: true }).click();
  await tabs.getByRole('button', { name: '关闭 客户管理', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/lab\/data-grid$/);
  await expect(tabs.getByRole('button', { name: '客户管理', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: '概览', exact: true })).toBeVisible();
});
