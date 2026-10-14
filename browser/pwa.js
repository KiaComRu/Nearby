(() => {
  const panel = document.getElementById('pwa-install-panel'), button = document.getElementById('pwa-install'), status = document.getElementById('pwa-status');
  const media = matchMedia('(display-mode: standalone)');
  let prompt = null, installed = false, message = '', waiting = false;
  const text = {
    title: ['Nearby на главном экране', 'Nearby on your home screen', 'होम स्क्रीन पर Nearby', '将 Nearby 添加到主屏幕', 'Nearby en tu pantalla de inicio'],
    description: ['Добавьте значок на телефон и открывайте Nearby как отдельное приложение.', 'Add an icon to your phone and open Nearby as a separate app.', 'फ़ोन पर आइकन जोड़ें और Nearby को अलग ऐप की तरह खोलें।', '将图标添加到手机，像独立应用一样打开 Nearby。', 'Añade un icono al teléfono y abre Nearby como una aplicación.'],
    install: ['Установить Nearby', 'Install Nearby', 'Nearby इंस्टॉल करें', '安装 Nearby', 'Instalar Nearby'],
    help: ['Как установить на телефон', 'How to install on your phone', 'फ़ोन पर कैसे इंस्टॉल करें', '如何在手机上安装', 'Cómo instalar en el teléfono'],
    android: ['Android: откройте меню браузера ⋮ → «Установить приложение» или «Добавить на главный экран».', 'Android: open the browser menu ⋮ → Install app or Add to home screen.', 'Android: ब्राउज़र मेन्यू ⋮ → ऐप इंस्टॉल करें या होम स्क्रीन पर जोड़ें।', 'Android：打开浏览器菜单 ⋮ → 安装应用或添加到主屏幕。', 'Android: abre el menú del navegador ⋮ → Instalar aplicación o Añadir a pantalla de inicio.'],
    ios: ['iPhone / iPad: откройте сайт в Safari → «Поделиться» → «На экран “Домой”». Если доступен переключатель «Открывать как веб-приложение», включите его.', 'iPhone / iPad: open the site in Safari → Share → Add to Home Screen. Enable Open as Web App if offered.', 'iPhone / iPad: Safari में साइट खोलें → शेयर → होम स्क्रीन पर जोड़ें। उपलब्ध हो तो वेब ऐप के रूप में खोलें चालू करें।', 'iPhone / iPad：在 Safari 打开网站 → 分享 → 添加到主屏幕。如果有“作为网页 App 打开”选项，请开启。', 'iPhone / iPad: abre el sitio en Safari → Compartir → Añadir a pantalla de inicio. Activa Abrir como app web si aparece.'],
    limits: ['Для подключения нужен интернет. Во время передачи держите Nearby открытым и не блокируйте телефон.', 'Connecting requires internet access. Keep Nearby open and your phone unlocked during transfers.', 'कनेक्शन के लिए इंटरनेट चाहिए। ट्रांसफर के दौरान Nearby खुला रखें और फ़ोन लॉक न करें।', '连接需要互联网。传输时请保持 Nearby 打开，不要锁屏。', 'La conexión necesita internet. Mantén Nearby abierto y el teléfono desbloqueado durante las transferencias.'],
    offline: ['Нет интернета. Проверьте сеть перед созданием нового подключения.', 'You are offline. Check your network before creating a new connection.', 'इंटरनेट उपलब्ध नहीं है। नया कनेक्शन बनाने से पहले नेटवर्क जाँचें।', '当前离线，请检查网络后再创建连接。', 'Sin internet. Comprueba la red antes de crear otra conexión.'],
    update: ['Обновление Nearby готово. Завершите передачу, закройте все окна Nearby и откройте приложение снова.', 'An update is ready. Finish your transfers, close all Nearby windows, then reopen the app.', 'Nearby अपडेट तैयार है। ट्रांसफर पूरा करें, सभी Nearby विंडो बंद करके ऐप फिर खोलें।', 'Nearby 更新已就绪。请完成传输，关闭所有 Nearby 窗口后重新打开应用。', 'Hay una actualización. Termina las transferencias, cierra todas las ventanas de Nearby y vuelve a abrir la app.'],
    retry: ['Установка недоступна. Воспользуйтесь инструкцией для вашего браузера.', 'Installation is unavailable. Follow the instructions for your browser.', 'इंस्टॉल उपलब्ध नहीं है। अपने ब्राउज़र के निर्देश अपनाएँ।', '暂时无法安装，请按浏览器安装说明操作。', 'No se puede instalar ahora. Sigue las instrucciones de tu navegador.'],
    storage: ['Офлайн-экран недоступен в этом браузере. Передача онлайн по-прежнему доступна.', 'The offline screen is unavailable in this browser. Online transfers are still available.', 'इस ब्राउज़र में ऑफलाइन स्क्रीन उपलब्ध नहीं है। ऑनलाइन ट्रांसफर उपलब्ध है।', '此浏览器无法使用离线页面，在线传输仍可使用。', 'La pantalla sin conexión no está disponible en este navegador. Las transferencias online siguen disponibles.'],
  };
  function render() {
    const language = ['ru', 'en', 'hi', 'zh-CN', 'es'].indexOf(document.documentElement.lang), index = language < 0 ? 1 : language;
    for (const node of panel.querySelectorAll('[data-pwa]')) {
      const value = text[node.dataset.pwa][index]; if (node.textContent !== value) node.textContent = value;
    }
    panel.hidden = installed || media.matches || navigator.standalone === true;
    button.hidden = !prompt || panel.hidden;
    const key = !navigator.onLine ? 'offline' : waiting ? 'update' : message;
    status.hidden = !key; status.textContent = key ? text[key][index] : '';
  }
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; render(); });
  addEventListener('appinstalled', () => { installed = true; prompt = null; render(); });
  button.addEventListener('click', async () => {
    if (!prompt) return;
    const event = prompt; prompt = null; button.disabled = true; render();
    try { await event.prompt(); const choice = await event.userChoice; if (choice.outcome === 'accepted') installed = true; }
    catch { message = 'retry'; document.getElementById('pwa-help').open = true; }
    finally { button.disabled = false; render(); }
  });
  media.addEventListener?.('change', render);
  addEventListener('online', render); addEventListener('offline', render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register(new URL('sw.js', location.href), { scope: './', updateViaCache: 'none' }).then(registration => {
      waiting = Boolean(registration.waiting); render();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && registration.active) { waiting = true; render(); } });
      });
    }).catch(() => { message = 'storage'; render(); });
  }
})();
