// Background Service Worker v3
// Handles routing messages from content script to backend

async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gemini_api_key', 'gemini_model', 'backend_url', 'use_vertex'], (items) => {
            resolve({
                apiKey: items.gemini_api_key || '',
                model: items.gemini_model || 'auto',
                backendUrl: items.backend_url || 'http://localhost:3000',
                useVertex: items.use_vertex === 'true'
            });
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'analyzeUrl') {
        handleAnalyzeUrl(message, sendResponse);
        return true;
    }
    if (message.action === 'analyzeFile') {
        handleAnalyzeFile(message, sendResponse);
        return true;
    }
});

async function handleAnalyzeUrl(message, sendResponse) {
    try {
        const config = await getConfig();
        if (!config.apiKey && !config.useVertex) {
            sendResponse({ success: false, error: 'Gemini API Key not set. Click extension icon → Settings.' });
            return;
        }

        const headers = {
            'Content-Type': 'application/json',
            'x-gemini-model': config.model
        };
        if (config.useVertex) {
            headers['x-use-vertex'] = 'true';
            headers['x-vertex-project'] = 'smart-seat-m8ttk';
            headers['x-vertex-location'] = 'us-central1';
        } else {
            headers['x-gemini-api-key'] = config.apiKey;
        }

        console.log('[BG] Sending to backend. videoUrl:', message.videoUrl ? message.videoUrl.substring(0,60)+'...' : 'null', '| shortcode:', message.shortcode, '| vertex:', config.useVertex);
        const response = await fetch(`${config.backendUrl}/api/analyze-remote-video`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                videoUrl: message.videoUrl || null,
                caption: message.caption,
                shortcode: message.shortcode
            })
        });

        const result = await response.json();
        sendResponse(result);
    } catch (error) {
        console.error('[BG] Backend error:', error);
        sendResponse({ success: false, error: 'Could not connect to server: ' + error.message });
    }
}

async function handleAnalyzeFile(message, sendResponse) {
    try {
        const config = await getConfig();
        if (!config.apiKey) {
            sendResponse({ success: false, error: 'Gemini API Key is not set.' });
            return;
        }

        const uint8Array = new Uint8Array(message.videoData);
        const fileBlob = new Blob([uint8Array], { type: 'video/mp4' });
        const formData = new FormData();
        formData.append('video', fileBlob, message.filename || 'video.mp4');
        if (message.caption) formData.append('caption', message.caption);

        const response = await fetch(`${config.backendUrl}/api/analyze-file`, {
            method: 'POST',
            headers: { 'x-gemini-api-key': config.apiKey, 'x-gemini-model': config.model },
            body: formData
        });

        const result = await response.json();
        sendResponse(result);
    } catch (error) {
        sendResponse({ success: false, error: 'Upload failed: ' + error.message });
    }
}
