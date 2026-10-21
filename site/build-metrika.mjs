import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = path.dirname(fileURLToPath(import.meta.url));

export async function installMetrika(root, files, { base = '/' } = {}) {
  const hash = createHash('sha256');
  for (const name of ['metrika.js','metrika.css']) { hash.update(await readFile(path.join(source,name))); await copyFile(path.join(source,name),path.join(root,name)); }
  const revision = hash.digest('hex').slice(0,12);
  for (const name of files) {
    let html = await readFile(path.join(root,name),'utf8');
    html = html.replace(/<!-- Nearby Metrika assets -->[\s\S]*?<!-- \/Nearby Metrika assets -->\s*/g,'')
      .replace(/<!-- Yandex\.Metrika counter -->[\s\S]*?<!-- \/Yandex\.Metrika counter -->\s*/g,'');
    const assets = `<!-- Nearby Metrika assets --><link rel="stylesheet" href="${base}metrika.css?v=${revision}"><script type="module" src="${base}metrika.js?v=${revision}"></script><!-- /Nearby Metrika assets -->`;
    const pixel = '<!-- Yandex.Metrika counter --><noscript><div><img src="https://mc.yandex.ru/watch/113717603" class="nearby-metrika-pixel" referrerpolicy="no-referrer" alt=""></div></noscript><!-- /Yandex.Metrika counter -->';
    html = html.replace('</head>',assets+'\n</head>').replace(/<body\b[^>]*>/, match=>match+'\n'+pixel);
    await writeFile(path.join(root,name),html);
  }
}
