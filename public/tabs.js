(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[role="tab"][data-pane]')];
  const settings = document.getElementById('connection-settings'), settingsButton = document.getElementById('open-settings');
  if (settings?.tagName === 'DIALOG' && settingsButton) {
    settingsButton.addEventListener('click', () => { if (!settings.open) settings.showModal(); });
    for (const button of settings.querySelectorAll('[data-close-settings]')) button.addEventListener('click', () => settings.close());
    settings.addEventListener('click', event => {
      if (event.target !== settings) return;
      const box = settings.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) settings.close();
    });
    settings.addEventListener('close', () => settingsButton.focus({ preventScroll: true }));
  }
  let connected = false, hadConnection = false;
  function selectTab(name, focus = false) {
    const selected = tabs.find(tab => tab.dataset.pane === name);
    if (!selected || selected.disabled || selected.hidden) return;
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    document.body.dataset.activePane = name;
    if (focus) selected.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.pane));
    tab.addEventListener('keydown', event => {
      const available = tabs.filter(item => !item.disabled && !item.hidden), index = available.indexOf(tab);
      const target = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1)
        : ['ArrowRight', 'ArrowDown'].includes(event.key) ? available[(index + 1) % available.length]
        : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? available[(index - 1 + available.length) % available.length] : null;
      if (target) { event.preventDefault(); selectTab(target.dataset.pane, true); }
    });
  }
  window.NearbyWorkspace = {
    selectTab,
    openReceived() {
      hadConnection = true;
      const transfer = tabs.find(tab => tab.dataset.pane === 'transfer');
      transfer.disabled = false;
      selectTab('transfer');
    },
    setDevices(count) {
      const devices = tabs.find(tab => tab.dataset.pane === 'devices');
      if (!devices) return;
      devices.hidden = count < 2; devices.disabled = count < 2;
      if (devices.hidden && document.body.dataset.activePane === 'devices') selectTab(hadConnection ? 'transfer' : 'connection');
    },
    setConnected(value) {
      const firstConnection = value && !hadConnection;
      connected = value; hadConnection ||= value;
      const transfer = tabs.find(tab => tab.dataset.pane === 'transfer');
      transfer.disabled = !hadConnection;
      document.body.classList.toggle('has-connection', value);
      if (firstConnection) selectTab('transfer');
    },
    incoming() { if (connected && document.body.dataset.activePane !== 'devices') selectTab('transfer'); },
  };
  selectTab('connection');
})();
