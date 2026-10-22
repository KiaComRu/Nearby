(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[role="tab"][data-pane]')];
  const settings = document.getElementById('connection-settings'), settingsButton = document.getElementById('open-settings');
  const mobileMenu = document.getElementById('mobile-navigation'), mobileSettings = document.getElementById('mobile-settings');
  const mobileQuery = matchMedia('(max-width:550px), (max-width:950px) and (pointer:coarse)');
  const isMobile = () => Boolean(mobileMenu && mobileQuery.matches);
  let settingsOpener = settingsButton, unread = 0;
  function updateMenu() {
    if (!mobileMenu) return;
    const pane = document.body.dataset.activePane || 'connection';
    const current = settings.open ? 'settings' : pane === 'connection' ? 'connection' : pane === 'devices' ? 'send' : document.body.dataset.mobileScreen || 'send';
    for (const button of mobileMenu.querySelectorAll('button')) {
      if ((button.dataset.mobileScreen || 'settings') === current) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    const badge = document.getElementById('mobile-received-badge');
    badge.textContent = unread > 99 ? '99+' : String(unread); badge.hidden = unread === 0;
  }
  function openSettings(opener) { settingsOpener = opener; if (!settings.open) settings.showModal(); updateMenu(); }
  if (settings?.tagName === 'DIALOG' && settingsButton) {
    settingsButton.addEventListener('click', () => openSettings(settingsButton));
    mobileSettings?.addEventListener('click', () => openSettings(mobileSettings));
    for (const button of settings.querySelectorAll('[data-close-settings]')) button.addEventListener('click', () => settings.close());
    settings.addEventListener('click', event => {
      if (event.target !== settings) return;
      const box = settings.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) settings.close();
    });
    settings.addEventListener('close', () => { updateMenu(); (settingsOpener?.getClientRects().length ? settingsOpener : isMobile() ? mobileSettings : settingsButton).focus({ preventScroll: true }); });
  }
  let connected = false, hadConnection = false;
  function selectTab(name, focus = false, screen = 'send') {
    const selected = tabs.find(tab => tab.dataset.pane === name);
    if (!selected || (selected.disabled && !(name === 'transfer' && isMobile())) || selected.hidden) return;
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    document.body.dataset.activePane = name;
    if (name === 'transfer') {
      document.body.dataset.mobileScreen = screen === 'received' ? 'received' : 'send';
      if (isMobile() && screen === 'received') unread = 0;
    }
    updateMenu();
    if (focus) (isMobile() ? document.getElementById(name === 'connection' ? 'mobile-connection' : 'mobile-' + (screen === 'received' ? 'received' : 'send')) : selected).focus();
  }
  for (const button of mobileMenu?.querySelectorAll('[data-mobile-screen]') || []) button.addEventListener('click', () => {
    const screen = button.dataset.mobileScreen;
    selectTab(screen === 'connection' ? 'connection' : 'transfer', false, screen);
  });
  mobileQuery.addEventListener('change', () => {
    if (!isMobile() && !hadConnection && document.body.dataset.activePane === 'transfer') selectTab('connection');
    updateMenu();
  });
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
    selectTab, isMobile,
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
      if (firstConnection && !(isMobile() && document.body.dataset.mobileScreen === 'received' && document.body.dataset.activePane === 'transfer')) selectTab('transfer');
    },
    incoming() {
      if (isMobile()) {
        if (document.body.dataset.activePane !== 'transfer' || document.body.dataset.mobileScreen !== 'received') { unread++; updateMenu(); }
      } else if (connected && document.body.dataset.activePane !== 'devices') selectTab('transfer');
    },
  };
  selectTab('connection');
})();
