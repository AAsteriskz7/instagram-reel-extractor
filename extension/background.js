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

const pendingCaptures = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'analyzeUrl') {
        handleAnalyzeUrl(message, sendResponse);
        return true;
    }
    if (message.action === 'analyzeFile') {
        handleAnalyzeFile(message, sendResponse);
        return true;
    }
    if (message.action === 'videoCaptured') {
        const { shortcode, videoUrl } = message;
        if (shortcode && pendingCaptures.has(shortcode)) {
            console.log(`[BG] Resolving pending capture for ${shortcode}`);
            pendingCaptures.get(shortcode).resolve(videoUrl);
        }
    }
    if (message.action === 'openAndCaptureVideo') {
        captureVideoUrl(message.shortcode)
            .then(videoUrl => sendResponse({ success: true, videoUrl }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

async function captureVideoUrl(shortcode) {
    return new Promise((resolve, reject) => {
        let timeoutId;
        let targetTabId;

        const cleanup = () => {
            clearTimeout(timeoutId);
            pendingCaptures.delete(shortcode);
            if (targetTabId) {
                chrome.tabs.remove(targetTabId).catch(() => {});
            }
        };

        const onCaptured = (videoUrl) => {
            cleanup();
            resolve(videoUrl);
        };

        pendingCaptures.set(shortcode, { resolve: onCaptured, reject });

        // Timeout after 10 seconds
        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for video URL for ${shortcode}`));
        }, 10000);

        // Open reel in a background tab
        chrome.tabs.create({ url: `https://www.instagram.com/reel/${shortcode}/`, active: false }, (tab) => {
            targetTabId = tab.id;
        });
    });
}

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

        const videoUrl = message.videoUrl || null;
        const imageUrls = message.imageUrls || null;
        const shortcode = message.shortcode;
        const postType = message.postType || 'Clip';

        let endpoint = '/api/analyze-remote-video';
        let requestBody = { videoUrl, caption: message.caption, shortcode };

        if (postType === 'Carousel') {
            endpoint = '/api/analyze-carousel';
            requestBody = { imageUrls, caption: message.caption, shortcode };
        }

        console.log(`[BG] Routing to ${endpoint}. shortcode: ${shortcode}`);
        const response = await fetch(`${config.backendUrl}${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
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
