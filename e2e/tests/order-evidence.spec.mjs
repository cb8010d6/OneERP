import { test, expect, materialId, materialName, orderPath, productId } from './order-fixtures.mjs';

const card = (page) => page.getByRole('region', { name: '交付备料评估（参考）', exact: true });
const quantity = (page, label) => card(page).locator('article').locator('div').filter({
  has: page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }),
}).locator('dd');

async function postSyntheticRemaining(page, orderApi) {
  orderApi.expectedShipment = {
    sourceLocationId: 'synthetic-location', allowPartial: false,
    items: [{ productId, shipQuantity: 4 }],
  };
  await page.getByRole('combobox', { name: '来源库位', exact: true }).selectOption('synthetic-location');
  await page.getByRole('spinbutton', { name: `产品 ${productId} 发货数量`, exact: true }).fill('4');
  await page.getByRole('button', { name: '执行整单原子发货', exact: true }).click();
  await expect.poll(() => orderApi.postedPayloads.length).toBe(1);
  expect(orderApi.postedPayloads[0]).toEqual(orderApi.expectedShipment);
}

test('partial shipment evidence displays remaining four and readable material metadata', async ({ page }, testInfo) => {
  await page.goto(orderPath);
  await expect(card(page)).toBeVisible();
  await expect(quantity(page, '订购数量')).toHaveText('10');
  await expect(quantity(page, '净发货数量')).toHaveText('6');
  await expect(quantity(page, '剩余数量')).toHaveText('4');
  await expect(quantity(page, '未预留现存库存')).toHaveText('4');
  await expect(card(page).getByText('现存库存覆盖', { exact: true })).toHaveCount(2);
  await expect(card(page).getByRole('heading', { name: materialName, exact: true })).toBeVisible();
  await expect(card(page).getByText('SYN-WIDGET · 件', { exact: true })).toBeVisible();
  await expect(card(page).getByText(materialId, { exact: true })).toBeHidden();
  await expect(card(page).getByText('未预留库存快照，不代表当前可分配数量。', { exact: false })).toBeVisible();
  await card(page).screenshot({ path: testInfo.outputPath('synthetic-partial-order-evidence.png') });
});

test('mobile shipment callback rereads authoritative order, timeline and fulfillment evidence', async ({ page, orderApi }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(orderPath);
  await expect(quantity(page, '剩余数量')).toHaveText('4');
  const previousReads = { ...orderApi.reads };
  await postSyntheticRemaining(page, orderApi);
  await expect(quantity(page, '净发货数量')).toHaveText('10');
  await expect(quantity(page, '剩余数量')).toHaveText('0');
  await expect(page.getByText('SYNTHETIC_SHIPMENT_REFRESHED', { exact: true })).toBeVisible();
  for (const key of ['order', 'availability', 'timeline']) {
    expect(orderApi.reads[key]).toBeGreaterThan(previousReads[key]);
    expect(orderApi.events.slice(orderApi.events.indexOf('shipment') + 1)).toContain(key);
  }
  await expect(card(page).getByText('现存库存覆盖', { exact: true })).toHaveCount(0);
  await card(page).screenshot({ path: testInfo.outputPath('synthetic-mobile-refreshed-evidence.png') });
});

test('failed evidence refresh removes the previously good assessment after a mocked shipment', async ({ page, orderApi }, testInfo) => {
  await page.goto(orderPath);
  await expect(quantity(page, '剩余数量')).toHaveText('4');
  await expect(card(page).getByText('现存库存覆盖', { exact: true })).toHaveCount(2);
  orderApi.failAvailabilityAfterShipment = true;
  await postSyntheticRemaining(page, orderApi);
  await expect(card(page).getByRole('alert')).toHaveText('履约证据读取失败；当前不能确认覆盖情况。');
  await expect(card(page).getByText('现存库存覆盖', { exact: true })).toHaveCount(0);
  await expect(card(page).locator('article')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_SHIPMENT_REFRESHED', { exact: true })).toBeVisible();
  await card(page).screenshot({ path: testInfo.outputPath('synthetic-failed-evidence-refresh.png') });
});
