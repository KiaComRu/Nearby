/* Shared by the local Windows UI and the browser/PWA. No file content leaves the device. */
(() => {
  'use strict';
  const rasterTypes = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' });
  const maxPreviewBytes = 8 * 1024 * 1024;
  const extension = name => String(name).split('.').length > 1 ? String(name).split('.').at(-1).toLowerCase() : '';
  function preview(name) {
    const element = document.createElement('span'); element.className = 'file-preview'; element.setAttribute('aria-hidden', 'true');
    const ext = extension(name), badge = document.createElement('span'); badge.textContent = ext ? ext.slice(0, 5).toUpperCase() : 'FILE'; element.append(badge);
    let disposed = false, started = false;
    async function load(source) {
      if (disposed || started || !Object.hasOwn(rasterTypes, ext)) return;
      started = true;
      let sourceUrl;
      try {
        const blob = typeof source === 'function' ? await source() : source;
        if (disposed || !blob || !blob.size || blob.size > maxPreviewBytes) return;
        sourceUrl = URL.createObjectURL(blob.slice(0, blob.size, rasterTypes[ext]));
        const image = new Image(); image.src = sourceUrl; await image.decode();
        if (disposed || !image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) return;
        const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const thumbnail = new Image(); thumbnail.alt = ''; thumbnail.width = canvas.width; thumbnail.height = canvas.height; thumbnail.src = canvas.toDataURL('image/png');
        if (!disposed) { element.replaceChildren(thumbnail); element.classList.add('has-preview'); }
      } catch { /* Unsupported, moved, oversized and damaged images retain the file-type badge. */ }
      finally { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }
    }
    return { element, load, dispose() { disposed = true; element.replaceChildren(); } };
  }

  let sequence = 0, active = null, tooltip;
  function closeStatus() {
    if (!active) return;
    active.button.setAttribute('aria-expanded', 'false'); active.observer.disconnect(); active = null;
    tooltip.hidden = true; tooltip.replaceChildren();
  }
  function positionStatus() {
    if (!active?.button.isConnected) { closeStatus(); return; }
    const box = active.button.getBoundingClientRect(), bounds = tooltip.getBoundingClientRect(), gap = 8;
    tooltip.style.left = `${Math.max(12, Math.min(box.left + box.width / 2 - bounds.width / 2, innerWidth - bounds.width - 12))}px`;
    tooltip.style.top = `${Math.max(12, box.bottom + gap + bounds.height <= innerHeight - 12 ? box.bottom + gap : box.top - bounds.height - gap)}px`;
  }
  function showStatus(button, detail, pinned = false) {
    if (active?.button === button) { active.pinned ||= pinned; return; }
    closeStatus();
    if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = 'transfer-status-tooltip'; tooltip.setAttribute('role', 'tooltip'); document.body.append(tooltip); }
    tooltip.hidden = false;
    const update = () => { tooltip.textContent = detail.textContent; positionStatus(); };
    const observer = new MutationObserver(update); observer.observe(detail, { childList: true, characterData: true, subtree: true });
    active = { button, observer, pinned }; button.setAttribute('aria-expanded', 'true'); update();
  }
  function status(detail) {
    const cell = document.createElement('td'), button = document.createElement('button'); cell.className = 'transfer-status transfer-actions';
    button.type = 'button'; button.className = 'transfer-status-button transfer-icon'; button.setAttribute('aria-label', 'Статус передачи'); button.setAttribute('aria-expanded', 'false');
    detail.hidden = true; detail.id = `transfer-status-${++sequence}`; button.setAttribute('aria-describedby', detail.id);
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10.5v6M12 7v.5"/></svg>';
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showStatus(button, detail); });
    button.addEventListener('pointerleave', () => { if (active?.button === button && !active.pinned && document.activeElement !== button) closeStatus(); });
    button.addEventListener('focus', () => showStatus(button, detail));
    button.addEventListener('blur', () => { if (active?.button === button) closeStatus(); });
    button.addEventListener('click', () => { if (active?.button === button && active.pinned) closeStatus(); else showStatus(button, detail, true); });
    const group = document.createElement('div'), controls = document.createElement('span');
    group.className = 'transfer-commands'; controls.className = 'transfer-file-actions';
    group.append(button, detail, controls); cell.append(group); return cell;
  }
  function icon(control, action, label) {
    const paths = {
      open: '<path d="M14 3h7v7M21 3L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>'
    };
    control.classList.add('transfer-icon'); control.setAttribute('aria-label', label); control.title = label;
    control.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[action]}</svg>`;
    return control;
  }
  document.addEventListener('pointerdown', event => { if (active && !active.button.contains(event.target) && !tooltip.contains(event.target)) closeStatus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeStatus(); });
  window.addEventListener('resize', () => { if (active) positionStatus(); });
  document.addEventListener('scroll', () => { if (active) positionStatus(); }, true);
  window.addEventListener('pagehide', closeStatus);
  window.NearbyFilePresentation = Object.freeze({ preview, status, icon, closeStatus, rasterTypes, maxPreviewBytes });
})();
