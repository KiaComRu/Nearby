import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../browser/', import.meta.url);
await mkdir(new URL('icons/', root), { recursive: true });
const svg = await readFile(new URL('favicon.svg', root), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;display:grid;place-items:center;background:${maskable ? '#080d18' : 'transparent'}}svg{display:block;width:${maskable ? '62.5%' : '100%'};height:${maskable ? '62.5%' : '100%'}}</style>${svg}`);
    await writeFile(new URL('icons/' + name, root), await page.screenshot({ omitBackground: !maskable }));
  }
} finally { await browser.close(); }
console.log('PWA icons generated from the existing Nearby SVG.');
