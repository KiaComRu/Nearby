(() => {
  const $ = id => document.getElementById(id), dialog = $('shell-send');
  if (!dialog) return;
  let entries = [], targets = [], busy = false, controller, refreshing = false, selectedId = '', selectionVersion = 0;
  const token = () => sessionStorage.getItem('nearby-token') || '';
  const size = bytes => {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let value = bytes, unit = 0;
    while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
    return `${new Intl.NumberFormat('ru', { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
  };
  async function request(url, { data, target, signal } = {}) {
    const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', signal: signal || AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token()}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(target ? { 'X-Nearby-Peer': target.id } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Не удалось выполнить отправку.');
    return body;
  }
  function render() {
    $('shell-reopen').hidden = entries.length === 0;
    $('shell-reopen').textContent = `Файлы из Проводника (${entries.length})`;
    $('shell-target').disabled = busy;
    $('shell-start').disabled = busy || !targets.some(target => target.id === $('shell-target').value && target.ready !== false) || !entries.some(entry => ['ready','failed'].includes(entry.state));
    $('shell-clear').disabled = busy;
    $('shell-cancel').hidden = !busy;
    $('shell-queue').replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'shell-file';
      const info = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = entry.file.name;
      detail.textContent = `${size(entry.file.size)} · ${entry.message || 'Готов к отправке'}`;
      info.append(name, detail);
      if (entry.state === 'sending') { const progress = document.createElement('progress'); progress.max = entry.file.size || 1; progress.value = entry.loaded || 0; info.append(progress); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Убрать'; remove.disabled = busy;
      remove.addEventListener('click', () => { entries = entries.filter(item => item !== entry); render(); });
      row.append(info, remove); $('shell-queue').append(row);
    }
  }
  async function sendTargets(signal) {
    const result = await request('/api/send-targets',{signal});
    return {targets:[...result.targets,...(window.NearbyGetInternetTargets?.()||[])]};
  }
  async function refreshTargets() {
    if (refreshing || busy || !dialog.open) return;
    refreshing = true;
    try {
      const result = await sendTargets(), selected = selectedId;
      targets = result.targets;
      $('shell-target').replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = targets.length ? 'Выберите устройство' : 'Нет подключённых устройств'; $('shell-target').append(placeholder);
      for (const target of targets) {
        const option = document.createElement('option'); option.value = target.id; option.textContent = `${target.name} · ${target.kind === 'internet' ? target.transport === 'direct' ? 'напрямую' : 'интернет' : target.secure ? 'TLS' : 'локальная сеть'}`; $('shell-target').append(option);
      }
      // Never substitute a new device when a previously selected one disconnects.
      if (targets.some(target => target.id === selected)) $('shell-target').value = selected;
      else if (!selected && targets.length === 1) { $('shell-target').value = targets[0].id; selectedId = targets[0].id; }
      $('shell-status').textContent = targets.length ? 'Файлы получит только выбранное устройство.' : 'Подключите устройство в Nearby. Выбранные файлы останутся в этом окне.';
    } catch (error) { targets = []; $('shell-status').textContent = error.message; }
    finally { refreshing = false; render(); }
  }
  function open() { if (!dialog.open) dialog.showModal(); void refreshTargets(); render(); }
  document.addEventListener('nearby-shell-selection', () => {
    const files = Array.from($('shell-files').files);
    if (files.length + entries.length > 100) { open(); $('shell-status').textContent = 'Можно выбрать до 100 файлов за раз. Уберите прежние файлы или выберите меньше новых.'; return; }
    const version = ++selectionVersion;
    for (const [nativeIndex,file] of files.entries()) entries.push({ file, state: 'ready', nativeIndex, selectionVersion:version });
    open();
  });
  $('shell-reopen').addEventListener('click', open);
  $('shell-close').addEventListener('click', () => dialog.close());
  $('shell-target').addEventListener('change', () => { selectedId = $('shell-target').value; render(); });
  $('shell-clear').addEventListener('click', () => { entries = []; render(); dialog.close(); });
  $('shell-cancel').addEventListener('click', () => controller?.abort());
  function upload(url, entry, target, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const cleanup = () => signal.removeEventListener('abort', abort);
      xhr.open('POST', url); xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
      if (target?.kind === 'peer') xhr.setRequestHeader('X-Nearby-Peer', target.id);
      xhr.upload.onprogress = event => { entry.loaded = event.loaded; render(); };
      xhr.onload = () => { cleanup(); try { const data = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error); resolve(data); } catch (error) { reject(error); } };
      xhr.onerror = () => { cleanup(); reject(new Error('Передача прервана. Проверьте соединение.')); };
      xhr.onabort = () => { cleanup(); reject(new DOMException('Отправка остановлена', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { cleanup(); reject(new DOMException('Отправка остановлена', 'AbortError')); return; }
      xhr.send(entry.file);
    });
  }
  const pause = signal => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Отправка остановлена', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  $('shell-start').addEventListener('click', async () => {
    if (busy) return;
    const target = targets.find(item => item.id === $('shell-target').value);
    if (!target) return;
    const batch = entries.filter(entry => ['ready','failed'].includes(entry.state));
    busy = true; controller = new AbortController(); const signal = controller.signal;
    render();
    for (const entry of batch) {
      if (signal.aborted) break;
      try {
        const current = await sendTargets(signal);
        if (!current.targets.some(item => item.id === target.id && item.kind === target.kind)) throw new Error('Устройство отключилось. Выберите получателя ещё раз.');
        if (entry.file.size > target.maxSize) throw new Error('Файл превышает лимит получателя.');
        if (target.kind === 'internet') {
          entry.state='sending';entry.message=`Передаём через интернет «${target.name}»`;render();
          await window.NearbySendInternet(target,entry.file,{signal,nativeIndex:entry.selectionVersion===selectionVersion?entry.nativeIndex:undefined,onProgress:bytes=>{entry.loaded=bytes;render();}});
          entry.message=`Получено и сохранено на «${target.name}»`;
        } else if (target.kind === 'client') {
          entry.state = 'sending'; entry.message = `Предлагаем «${target.name}»`; render();
          const uploaded = await upload(`/api/shares?recipient=${encodeURIComponent(target.id)}&name=${encodeURIComponent(entry.file.name)}&size=${entry.file.size}`, entry, target, signal);
          entry.message = `Доступен только «${target.name}» — ожидает скачивания`;
          document.dispatchEvent(new CustomEvent('nearby-shell-transfer', { detail: { file: entry.file, uploaded, target } }));
        } else {
          const prefix = '/api/peer/remote';
          const offer = await request(prefix + '/api/offers', { data: { name: entry.file.name, size: entry.file.size }, target, signal });
          entry.state = 'waiting'; entry.message = `Подготавливаем приём у «${target.name}»`; render();
          const deadline = Date.now() + 5 * 60_000;
          while (true) {
            if (Date.now() >= deadline) throw new Error('Время ожидания истекло. Отправьте файл ещё раз.');
            const remote = await request(prefix + '/api/state', { target, signal });
            const status = remote.offers.find(item => item.id === offer.id)?.state;
            if (status === 'accepted') break;
            if (['rejected','expired','failed'].includes(status) || !status) throw new Error(status === 'rejected' ? 'Получатель отклонил файл.' : 'Запрос больше не доступен.');
            await pause(signal);
          }
          entry.state = 'sending'; entry.message = `Передаём «${target.name}»`; render();
          const uploaded = await upload(prefix + `/api/offers/${offer.id}/upload`, entry, target, signal);
          document.dispatchEvent(new CustomEvent('nearby-shell-transfer', { detail: { file: entry.file, uploaded, target } }));
          entry.message = `Получено и сохранено на «${target.name}»`;
        }
        entry.state = 'done';
        document.dispatchEvent(new Event('nearby-transfer-complete'));
      } catch (error) { entry.state = 'failed'; entry.message = signal.aborted ? 'Отправка остановлена. Можно повторить.' : error.message; }
      render();
    }
    busy = false; controller = null; render();
    $('shell-status').textContent = signal.aborted ? 'Отправка остановлена.' : 'Обработка выбранных файлов завершена. Результат показан рядом с каждым файлом.';
  });
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(() => { if (!document.hidden) void refreshTargets(); }, 1500);
})();
