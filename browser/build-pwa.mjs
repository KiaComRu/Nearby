import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url), hash = createHash('sha256');
for (const file of ['offline.html', 'pwa-offline.css', 'pwa-offline.js']) hash.update(file).update(await readFile(new URL(file, root)));
const template = await readFile(new URL('sw.template.js', root), 'utf8');
await writeFile(new URL('sw.js', root), template.replace('__OFFLINE_REVISION__', hash.digest('hex').slice(0, 20)));
