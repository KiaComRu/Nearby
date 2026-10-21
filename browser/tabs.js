(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[role="tab"][data-pane]')];
  let connected = false, hadConnection = false;
  function selectTab(name, focus = false) {
    const selected = tabs.find(tab => tab.dataset.pane === name);
    if (!selected || selected.disabled) return;
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
      const available = tabs.filter(item => !item.disabled), index = available.indexOf(tab);
      const target = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1)
        : ['ArrowRight', 'ArrowDown'].includes(event.key) ? available[(index + 1) % available.length]
        : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? available[(index - 1 + available.length) % available.length] : null;
      if (target) { event.preventDefault(); selectTab(target.dataset.pane, true); }
    });
  }
  window.NearbyWorkspace = {
    selectTab,
    setConnected(value) {
      const newlyConnected = value && !connected;
      connected = value; hadConnection ||= value;
      const transfer = tabs.find(tab => tab.dataset.pane === 'transfer');
      transfer.disabled = !hadConnection;
      document.body.classList.toggle('has-connection', value);
      if (newlyConnected) selectTab('transfer');
    },
    incoming() { if (connected) selectTab('transfer'); },
  };
  selectTab('connection');
})();
