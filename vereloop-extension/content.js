// Detect if running inside the options page
if (window.location.pathname.endsWith("options.html")) {
  document.addEventListener('DOMContentLoaded', () => {
    const nameEl = document.getElementById('fullName');
    const saveEl = document.getElementById('save');
    const status = document.getElementById('status');

    // Load
    chrome.storage.local.get(['fullName'], ({ fullName }) => {
      nameEl.value = fullName || '';
    });

    // Save
    saveEl.addEventListener('click', async () => {
      const fullName = nameEl.value.trim();
      await chrome.storage.local.set({ fullName });
      status.textContent = 'Saved ✓';
      setTimeout(() => (status.textContent = ''), 1200);
    });
  });
}
