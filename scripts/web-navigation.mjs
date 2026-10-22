export async function selectPane(page,pane) {
  if(await page.locator('#mobile-navigation').isVisible()) {
    if(pane==='connection')await page.locator('#mobile-connection').click();
    else if(pane==='received')await page.locator('#mobile-received').click();
    else {await page.locator('#mobile-send').click();if(pane==='devices')await page.locator('#choose-recipient').click();}
  } else await page.locator('#tab-'+(pane==='received'?'transfer':pane)).click();
}
export async function openSettings(page) {
  await page.locator(await page.locator('#mobile-navigation').isVisible()?'#mobile-settings':'#open-settings').click();
}
export async function selectDesktopLan(page) {
  await openSettings(page);await page.locator('#connection-mode').selectOption('lan');await page.locator('#connection-settings [data-close-settings]').last().click();
}
