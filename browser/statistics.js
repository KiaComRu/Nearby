(() => {
  const section = document.getElementById('transfer-statistics');
  if (!section) return;
  const files = document.getElementById('stats-files'), uses = document.getElementById('stats-uses');
  const volume = document.getElementById('stats-volume'), exact = document.getElementById('stats-exact'), status = document.getElementById('stats-state');
  const label = document.getElementById('stats-uses-label'), help = document.getElementById('stats-uses-help');
  const languages = ['ru', 'en', 'hi', 'zh-CN', 'es'];
  const copy = {
    files: ['файлов передано','files transferred','फ़ाइलें भेजी गईं','已传输文件','archivos transferidos'],
    volume: ['данных · нажмите на объём','data · tap for bytes','डेटा · बाइट के लिए टैप करें','数据量 · 点击查看字节数','datos · pulsa para ver bytes'],
    uses: ['количество использований','number of uses','उपयोगों की संख्या','使用次数','número de usos'],
    help: ['Каждое подключение двух устройств, включая повторные.','Each connection between two devices, including repeat connections.','दो डिवाइसों का हर कनेक्शन, दोबारा जुड़ना भी।','每次连接两台设备都会计数，包括重复连接。','Cada conexión entre dos dispositivos, incluidas las repetidas.'],
    since: ['Учёт использований с','Uses counted since','उपयोग की गणना शुरू','使用次数统计始于','Usos contados desde'],
    ready: ['Браузерная версия и Windows · обновление раз в минуту','Web and Windows · updates every minute','वेब और Windows · हर मिनट अपडेट','网页版和 Windows · 每分钟更新','Web y Windows · actualización cada minuto'],
    loading: ['Загружаем общий итог…','Loading totals…','कुल आँकड़े लोड हो रहे हैं…','正在加载统计…','Cargando totales…'],
    error: ['Общая статистика временно недоступна.','Statistics are temporarily unavailable.','आँकड़े अभी उपलब्ध नहीं हैं।','统计暂时不可用。','Las estadísticas no están disponibles temporalmente.'],
    exact: ['Точное число байтов','Exact byte count','बाइट की सटीक संख्या','准确字节数','Número exacto de bytes'],
  };
  let pending = false, latest = null, failed = false;
  function render() {
    const preferred = languages.indexOf(document.documentElement.lang), index = preferred < 0 ? 1 : preferred;
    const locale = languages[index], numbers = new Intl.NumberFormat(locale);
    const text = key => copy[key][index];
    const format = bytes => {
      const units = index === 0 ? ['Б','КБ','МБ','ГБ','ТБ'] : ['B','KB','MB','GB','TB'];
      let value = bytes, unit = 0;
      while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
      if (unit < units.length - 1 && Math.round(value * 10) >= 10000) { value /= 1000; unit++; }
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
    };
    files.nextElementSibling.textContent = text('files'); volume.nextElementSibling.textContent = text('volume');
    if (label) label.textContent = text('uses');
    let explanation = text('help');
    if (latest?.usesStartedAt && Number.isFinite(Date.parse(latest.usesStartedAt))) explanation += ` ${text('since')} ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Europe/Moscow' }).format(new Date(latest.usesStartedAt))}.`;
    if (help) help.textContent = explanation;
    if (uses) { uses.textContent = Number.isSafeInteger(latest?.uses) ? numbers.format(latest.uses) : '—'; uses.title = explanation; }
    files.textContent = latest ? numbers.format(latest.files) : '—'; volume.textContent = latest ? format(latest.bytes) : '—'; volume.disabled = !latest;
    volume.setAttribute('aria-label', text('exact'));
    status.textContent = text(latest ? 'ready' : failed ? 'error' : 'loading');
    section.classList.toggle('unavailable', failed);
    if (latest) exact.textContent = `${numbers.format(latest.bytes)} ${index === 0 ? 'байт' : 'B'} · ${index === 0 ? '1 КБ = 1 000 байт' : '1 KB = 1 000 B'}`;
    else { exact.hidden = true; volume.setAttribute('aria-expanded', 'false'); }
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const method = section.dataset.statisticsMethod || 'POST';
      const response = await fetch(section.dataset.statisticsEndpoint, { method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000),
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) } : {}) });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Number.isSafeInteger(data.files) || data.files < 0 || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || !Number.isFinite(Date.parse(data.startedAt)) || (data.uses != null && (!Number.isSafeInteger(data.uses) || data.uses < 0))) throw new Error('Invalid statistics');
      latest = data; failed = false;
    } catch { latest = null; failed = true; }
    finally { pending = false; render(); }
  }
  volume.addEventListener('click', () => { exact.hidden = !exact.hidden; volume.setAttribute('aria-expanded', String(!exact.hidden)); });
  for (const event of ['nearby-transfer-complete','nearby-connection-complete']) document.addEventListener(event, () => { void refresh(); });
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render(); void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
})();
