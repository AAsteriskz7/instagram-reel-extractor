// Instagram Reel Insight Extractor - Extension Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const backendUrlInput = document.getElementById('backendUrl');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');

    // Load saved settings
    chrome.storage.local.get(['gemini_api_key', 'gemini_model', 'backend_url'], (items) => {
        if (items.gemini_api_key) {
            apiKeyInput.value = items.gemini_api_key;
        }
        if (items.gemini_model) {
            modelSelect.value = items.gemini_model;
        }
        if (items.backend_url) {
            backendUrlInput.value = items.backend_url;
        }
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const backendUrl = backendUrlInput.value.trim() || 'http://localhost:3000';

        chrome.storage.local.set({
            gemini_api_key: apiKey,
            gemini_model: model,
            backend_url: backendUrl
        }, () => {
            // Show status toast
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 2000);
        });
    });
});
