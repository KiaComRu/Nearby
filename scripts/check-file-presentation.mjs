import assert from 'node:assert/strict';

export async function checkFilePresentation(page, row, { image = false, touch = false } = {}) {
  await row.waitFor();
  await row.locator('.open-transfer:not(:disabled)').waitFor();
  assert.equal(await row.locator('td').count(), 4);
  const commands = row.locator('.transfer-icon'); assert.equal(await commands.count(), 3);
  assert.deepEqual(await commands.allInnerTexts(), ['', '', '']);
  const layout = await commands.evaluateAll(nodes => nodes.map(node => ({
    cell: node.closest('td').cellIndex, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y, width: node.getBoundingClientRect().width
  })));
  if (!layout.every(item => item.cell === 3 && item.y === layout[0].y)) await page.screenshot({path:'artifacts/action-icons-layout-debug.png'});
  assert.ok(layout.every(item => item.cell === 3 && Math.abs(item.y - layout[0].y) < 1), JSON.stringify(layout));
  assert.ok(layout.every((item,index) => !index || item.x >= layout[index-1].x + layout[index-1].width));
  assert.equal(await row.locator('.open-transfer svg').count(), 1);
  assert.ok(await row.locator('.open-transfer').getAttribute('aria-label'));
  const heading = await row.evaluate(element => element.closest('table').querySelector('thead th:last-child')?.textContent);
  if (heading !== undefined) assert.equal(heading, '');
  const preview = row.locator('.file-preview');
  if (image) await preview.locator('img').waitFor();
  assert.equal(await preview.count(), 1);
  const geometry = await row.evaluate(element => {
    const preview = element.querySelector('.file-preview').getBoundingClientRect(), title = element.querySelector('.transfer-title').getBoundingClientRect();
    return { left: preview.right <= title.left, width: preview.width, image: element.querySelector('.file-preview img')?.src };
  });
  assert.ok(geometry.left); assert.ok(geometry.width >= 36 && geometry.width <= 48);
  if (image) assert.ok(geometry.image.startsWith('data:image/png;base64,'), 'only the small rendered thumbnail remains in the row');
  const button = row.locator('.transfer-status-button'), detail = row.locator('.transfer-detail');
  assert.equal(await button.innerText(), ''); assert.equal(await button.locator('svg').count(), 1);
  assert.ok(await detail.isHidden()); assert.equal(await row.locator('.transfer-status progress').count(), 0);
  const tooltip = page.getByRole('tooltip');
  if (!touch) {
    await button.hover(); await tooltip.waitFor(); assert.equal(await tooltip.textContent(), await detail.textContent());
    await page.keyboard.press('Escape'); assert.ok(await tooltip.isHidden());
  }
  if (touch) await button.tap(); else await button.click();
  await tooltip.waitFor(); assert.equal(await tooltip.textContent(), await detail.textContent());
  const box = await tooltip.boundingBox(), width = await page.evaluate(() => innerWidth); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width);
  // The displayed status follows progress without moving text into the table cell.
  await detail.evaluate(element => { element.dataset.originalStatus = element.textContent; element.textContent = 'Status changed while open'; });
  await page.waitForFunction(() => document.querySelector('[role=tooltip]')?.textContent === 'Status changed while open');
  await detail.evaluate(element => { element.textContent = element.dataset.originalStatus; delete element.dataset.originalStatus; });
  if (touch) await button.tap(); else await button.click();
  assert.ok(await tooltip.isHidden());
  if (!touch) {
    await page.locator('h1').first().click(); await button.focus(); await tooltip.waitFor();
    await page.keyboard.press('Escape'); assert.ok(await tooltip.isHidden());
  }
  await row.evaluate(element => { const scroll = element.closest('.transfer-scroll'); if (scroll) scroll.scrollLeft = 0; });
}
