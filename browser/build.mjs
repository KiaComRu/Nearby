import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
await mkdir(root + 'vendor', { recursive: true });
await build({ entryPoints: [root + '../node_modules/qrcode/lib/browser.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'QRCode', minify: true, outfile: root + 'vendor/qrcode.js', legalComments: 'inline' });
await copyFile(root + '../node_modules/qrcode/license', root + 'vendor/QRCode-LICENSE.txt');
await copyFile(root + '../node_modules/dijkstrajs/LICENSE.md', root + 'vendor/dijkstrajs-LICENSE.txt');
console.log('Browser QR bundle built locally; no external QR service.');
