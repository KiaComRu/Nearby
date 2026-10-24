import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installMetrika } from '../site/build-metrika.mjs';
import { metrikaCsp } from '../site/metrika-policy.mjs';
const root = fileURLToPath(new URL('./', import.meta.url));
await mkdir(root + 'vendor', { recursive: true });
await build({ entryPoints: [root + '../node_modules/qrcode/lib/browser.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'QRCode', minify: true, outfile: root + 'vendor/qrcode.js', legalComments: 'inline' });
await copyFile(root + '../node_modules/qrcode/license', root + 'vendor/QRCode-LICENSE.txt');
await copyFile(root + '../node_modules/dijkstrajs/LICENSE.md', root + 'vendor/dijkstrajs-LICENSE.txt');
await copyFile(root + '../public/statistics.js', root + 'statistics.js');
for (const name of ['file-presentation.js','file-presentation.css']) await copyFile(root + '../public/' + name, root + name);
const version = JSON.parse(await readFile(root + 'version.json', 'utf8')).version;
await copyFile(root + 'app.js', root + `app-${version}.js`);
const presentationRevision = createHash('sha256').update(await readFile(root + 'file-presentation.js')).update(await readFile(root + 'file-presentation.css')).digest('hex').slice(0,12);
const html = await readFile(root + 'index.html','utf8');
const appRevision = createHash('sha256').update(await readFile(root + 'app.js')).digest('hex').slice(0,12);
const styleRevision = createHash('sha256').update(await readFile(root + 'workspace.css')).digest('hex').slice(0,12);
const localeRevision = createHash('sha256').update(await readFile(root + 'localize.js')).digest('hex').slice(0,12);
const tabsRevision = createHash('sha256').update(await readFile(root + 'tabs.js')).digest('hex').slice(0,12);
await writeFile(root + 'index.html',html
  .replace(/src="tabs\.js(?:\?[^"\s]*)?"/, `src="tabs.js?v=${tabsRevision}"`)
  .replace(/src="app(?:-\d+\.\d+\.\d+)?\.js(?:\?[^"\s]*)?"/, `src="app-${version}.js?v=${appRevision}"`)
  .replace(/href="workspace\.css(?:\?[^"\s]*)?"/, `href="workspace.css?v=${styleRevision}"`)
  .replace(/(?:src|href)="(file-presentation\.(?:js|css))(?:\?[^"\s]*)?"/g, (match, name) => `${name.endsWith('.js') ? 'src' : 'href'}="${name}?v=${presentationRevision}"`)
  .replace(/src="localize\.js(?:\?[^"\s]*)?"/, `src="localize.js?v=${localeRevision}"`));
const policy = await readFile(root + '.htaccess','utf8');
await writeFile(root + '.htaccess',policy.replace(/^Header always set Content-Security-Policy ".*"$/m, `Header always set Content-Security-Policy "${metrikaCsp}"`));
await installMetrika(root,['index.html','offline.html'],{base:'./'});
await import('./build-pwa.mjs');
await import('./build-seo.mjs');
console.log('Browser QR bundle and CSP-compatible Metrika counter built.');
