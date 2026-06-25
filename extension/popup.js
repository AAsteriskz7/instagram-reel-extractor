// Instagram Reel Insight Extractor - Extension Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const unsaveToggle = document.getElementById('unsaveToggle');
    const saveBtn = document.getElementById('saveBtn');
    const openDashboardBtn = document.getElementById('openDashboardBtn');
    const status = document.getElementById('status');

    // Load saved settings
    chrome.storage.local.get(['gemini_api_key', 'gemini_model', 'unsave_after_process'], (items) => {
        if (items.gemini_api_key) apiKeyInput.value = items.gemini_api_key;
        if (items.gemini_model) modelSelect.value = items.gemini_model;
        // Default: unsave is OFF (user must explicitly enable)
        unsaveToggle.checked = items.unsave_after_process === true;
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const unsave = unsaveToggle.checked;

        chrome.storage.local.set({
            gemini_api_key: apiKey,
            gemini_model: model,
            unsave_after_process: unsave
        }, () => {
            status.classList.add('show');
            setTimeout(() => status.classList.remove('show'), 2000);
        });
    });

    // Open Dashboard Button
    openDashboardBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'dashboard.html' });
    });
});
