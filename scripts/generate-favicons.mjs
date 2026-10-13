import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const folder of ['browser', 'public']) {
    const directory = new URL(`${folder}/`, root);
    const svg = await readFile(new URL('favicon.svg', directory), 'utf8');
    const sizes = [16, 32, 48, 64];
    const images = [];
    for (const size of [...sizes, 180]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
      const png = await page.screenshot({ omitBackground: true });
      if (size === 180) await writeFile(new URL('apple-touch-icon.png', directory), png);
      else images.push(png);
    }
    // PNG-backed ICO entries are supported by Windows 10/11 and modern browsers.
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    for (const [index, size] of sizes.entries()) {
      const entry = 6 + 16 * index;
      header[entry] = size; header[entry + 1] = size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(images[index].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += images[index].length;
    }
    await writeFile(new URL('favicon.ico', directory), Buffer.concat([header, ...images]));
    console.log(`Generated SVG companions: ${fileURLToPath(directory)}`);
  }
} finally { await browser.close(); }
