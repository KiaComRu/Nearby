import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './build-pwa.mjs';
const root = fileURLToPath(new URL('./', import.meta.url));
await mkdir(root + 'vendor', { recursive: true });
await build({ entryPoints: [root + '../node_modules/qrcode/lib/browser.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'QRCode', minify: true, outfile: root + 'vendor/qrcode.js', legalComments: 'inline' });
await copyFile(root + '../node_modules/qrcode/license', root + 'vendor/QRCode-LICENSE.txt');
await copyFile(root + '../node_modules/dijkstrajs/LICENSE.md', root + 'vendor/dijkstrajs-LICENSE.txt');
await copyFile(root + '../public/statistics.js', root + 'statistics.js');
const version = JSON.parse(await readFile(root + '../package.json', 'utf8')).version;
await copyFile(root + 'app.js', root + `app-${version}.js`);
const html = await readFile(root + 'index.html','utf8');
const appRevision = createHash('sha256').update(await readFile(root + 'app.js')).digest('hex').slice(0,12);
const styleRevision = createHash('sha256').update(await readFile(root + 'workspace.css')).digest('hex').slice(0,12);
const localeRevision = createHash('sha256').update(await readFile(root + 'localize.js')).digest('hex').slice(0,12);
await writeFile(root + 'index.html',html
  .replace(/src="app(?:-\d+\.\d+\.\d+)?\.js(?:\?[^"\s]*)?"/, `src="app-${version}.js?v=${appRevision}"`)
  .replace(/href="workspace\.css(?:\?[^"\s]*)?"/, `href="workspace.css?v=${styleRevision}"`)
  .replace(/src="localize\.js(?:\?[^"\s]*)?"/, `src="localize.js?v=${localeRevision}"`));
console.log('Browser QR bundle built locally; no external QR service.');
