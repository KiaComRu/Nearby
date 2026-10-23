import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
export const downloadCopy = {
  ru: { choose: 'Скачать для Windows', group: 'Выберите сборку для вашей Windows', desktop: 'Для обычного компьютера', download: 'Скачать', note: 'Тестовые сборки без цифровой подписи. Интерфейс приложения — на русском языке.' },
  en: { choose: 'Download for Windows', group: 'Choose the build for your Windows', desktop: 'For desktop PCs and laptops', download: 'Download', note: 'Unsigned test builds. The application interface is in Russian.' },
  es: { choose: 'Descargar para Windows', group: 'Elige la compilación para tu Windows', desktop: 'Para ordenadores y portátiles', download: 'Descargar', note: 'Compilaciones de prueba sin firma digital. La interfaz de la aplicación está en ruso.' },
  hi: { choose: 'Windows के लिए डाउनलोड करें', group: 'अपने Windows के लिए बिल्ड चुनें', desktop: 'डेस्कटॉप और लैपटॉप के लिए', download: 'डाउनलोड करें', note: 'बिना डिजिटल हस्ताक्षर की परीक्षण बिल्ड। ऐप का इंटरफ़ेस रूसी में है।' },
  'zh-CN': { choose: '下载 Windows 版', group: '选择适合您的 Windows 的版本', desktop: '适用于台式电脑和笔记本电脑', download: '下载', note: '未签名的测试版本。应用程序界面为俄语。' },
};
export function downloadChoices(root, locale) {
  const u = downloadCopy[locale];
  const metadata = JSON.parse(readFileSync(resolve(root, 'downloads/windows-build.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!/^Nearby-\d+\.\d+\.\d+-windows-x64-setup\.exe$/.test(metadata.installer)) throw new Error('Invalid Windows installer');
  const path = resolve(root, 'downloads', metadata.installer);
  const size = existsSync(path) ? ` · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(statSync(path).size / 1024 ** 2)} ${locale === 'ru' ? 'МиБ' : 'MiB'}` : '';
  return `<div class="windows-download-choices"><div class="windows-download-choice"><h3>Windows 10/11</h3><p>${escape(u.desktop)}</p><p class="windows-build-info">${escape(metadata.version)} · x64 · EXE${size}</p><a class="btn primary" data-installer="windows" href="/downloads/${metadata.installer}" download="${metadata.installer}" aria-label="${escape(u.download + ' Windows 10/11')}">${u.download} .exe ↓</a><small>.NET Framework 4.8 + WebView2</small></div></div><p class="windows-download-note">${escape(u.note)}</p>`;
}
