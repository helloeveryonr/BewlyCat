document.addEventListener('DOMContentLoaded', () => {
  const toggleIp = document.getElementById('toggleIp');
  const togglePure = document.getElementById('togglePure');

  chrome.storage.local.get({ enableIp: true, enablePure: true }, (res) => {
    toggleIp.checked = res.enableIp;
    togglePure.checked = res.enablePure;
  });

  toggleIp.addEventListener('change', (e) => {
    chrome.storage.local.set({ enableIp: e.target.checked });
  });

  togglePure.addEventListener('change', (e) => {
    chrome.storage.local.set({ enablePure: e.target.checked });
  });
});