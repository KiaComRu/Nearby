(() => {
  const section = document.getElementById('transfer-statistics');
  if (!section) return;
  const files = document.getElementById('stats-files');
  const volume = document.getElementById('stats-volume');
  const exact = document.getElementById('stats-exact');
  const status = document.getElementById('stats-state');
  const numbers = new Intl.NumberFormat('ru-RU');
  let pending = false;
  const format = bytes => {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let value = bytes, unit = 0;
    while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
    if (unit < units.length - 1 && Math.round(value * 10) >= 10000) { value /= 1000; unit++; }
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
  };
  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const method = section.dataset.statisticsMethod || 'POST';
      const response = await fetch(section.dataset.statisticsEndpoint, { method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000),
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stats' }) } : {}) });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Number.isSafeInteger(data.files) || data.files < 0 || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || !Number.isFinite(Date.parse(data.startedAt))) throw new Error('Invalid statistics');
      files.textContent = numbers.format(data.files); volume.textContent = format(data.bytes); volume.disabled = false;
      volume.setAttribute('aria-label', `Передано ${format(data.bytes)}. Точное число байтов`);
      exact.textContent = `${numbers.format(data.bytes)} байт · 1 КБ = 1 000 байт`;
      status.textContent = 'Браузерная версия и Windows · обновление раз в минуту';
    } catch {
      files.textContent = '—'; volume.textContent = '—'; volume.disabled = true;
      exact.hidden = true; volume.setAttribute('aria-expanded', 'false');
      status.textContent = 'Общая статистика временно недоступна. Передавать файлы по локальной сети можно без неё.';
    } finally { pending = false; }
  }
  volume.addEventListener('click', () => { exact.hidden = !exact.hidden; volume.setAttribute('aria-expanded', String(!exact.hidden)); });
  document.addEventListener('nearby-transfer-complete', () => { void refresh(); });
  void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
})();
