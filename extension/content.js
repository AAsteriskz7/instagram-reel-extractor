// Content Script v5 — Injects interceptor.js into MAIN WORLD at document_start
// Then listens for captured video URLs and handles extraction

let floatingButton = null;
let capturedVideoUrl = null;
let capturedBlobUrl = null;

// ── Inject interceptor.js into MAIN WORLD at document_start ──
(function injectInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).prepend(script);
})();

// ── Listen for URL events from interceptor (main world → content script) ──
window.addEventListener('__gemini_cdn_url__', (e) => {
    const url = e.detail && e.detail.videoUrl;
    if (url) {
        try {
            const urlObj = new URL(url);
            const efg = urlObj.searchParams.get('efg');
            if (efg) {
                const decodedEfg = atob(decodeURIComponent(efg));
                // Ignore audio-only streams
                if (decodedEfg.includes('audio')) {
                    console.log('[Gemini v5] ⏭️ Ignored audio stream:', url);
                    return;
                }
            }
        } catch (err) {
            // If we can't parse it, just fall through and keep it
        }

        capturedVideoUrl = url;
        // Log the FULL URL, not truncated
        console.log('[Gemini v5] 🎯 Captured CDN video URL (full):', url);
    }
});

window.addEventListener('__gemini_blob_url__', (e) => {
    const url = e.detail && e.detail.blobUrl;
    if (url) {
        capturedBlobUrl = url;
        console.log('[Gemini v5] 🎯 Captured blob URL:', url);
    }
});

// ── Helper: Extract shortcode from URL ──
function getShortcode() {
    const match = window.location.pathname.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

// ── Helper: Show toast ──
function showToast(message, type = 'info', duration = 4000) {
    let toast = document.getElementById('gemini-extractor-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'gemini-extractor-toast';
        document.body.appendChild(toast);
    }
    toast.className = `gemini-toast ${type} show`;
    toast.innerHTML = `<div class="gemini-toast-content"><span class="gemini-toast-icon"></span><span class="gemini-toast-text">${message}</span></div>`;
    if (duration > 0) {
        setTimeout(() => {
            if (toast.classList.contains('show') && toast.querySelector('.gemini-toast-text')?.innerText === message) {
                toast.classList.remove('show');
            }
        }, duration);
    }
}

// ── Helper: Scrape caption from DOM ──
function scrapeCaption() {
    const selectors = ['article h1', 'div[role="dialog"] h1', 'span._ap3a', 'div._a9zs span'];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 2) return el.innerText.trim();
    }
    return '';
}

// ── Main extraction logic ──
async function extractAndSend() {
    const shortcode = getShortcode();
    if (!shortcode) {
        showToast('Please open a specific Reel or post first.', 'error');
        return;
    }

    console.log('[Gemini v5] Extract clicked. capturedVideoUrl:', capturedVideoUrl, '| capturedBlobUrl:', capturedBlobUrl);

    // If we have a direct CDN URL — perfect, send it to backend
    if (capturedVideoUrl) {
        showToast('📡 Got video URL! Sending to Gemini...', 'info', 0);
        sendToBackend(capturedVideoUrl, scrapeCaption(), shortcode);
        return;
    }

    // Fallback: No CDN URL captured. Tell backend to try server-side extraction via shortcode.
    showToast('🔍 No CDN URL captured yet. Trying server-side extraction...', 'info', 0);
    console.warn('[Gemini v5] No CDN URL captured. Falling back to server-side shortcode extraction.');
    sendToBackend(null, scrapeCaption(), shortcode);
}

function sendToBackend(videoUrl, caption, shortcode) {
    chrome.runtime.sendMessage({
        action: 'analyzeUrl',
        videoUrl: videoUrl,       // may be null — backend handles it via shortcode
        caption: caption,
        shortcode: shortcode
    }, handleResponse);
}

function handleResponse(response) {
    if (chrome.runtime.lastError) {
        showToast('Extension error: ' + chrome.runtime.lastError.message, 'error', 6000);
        return;
    }
    if (!response) {
        showToast('❌ No response. Is your server running? npm start at localhost:3000', 'error', 7000);
        return;
    }
    if (response.success) {
        showToast('✅ Done! Check your dashboard at localhost:3000', 'success', 6000);
    } else {
        showToast('❌ ' + (response.error || 'Unknown error'), 'error', 8000);
    }
}

// ── Button injection ──
function injectButton() {
    if (document.getElementById('gemini-extractor-btn')) return;
    const shortcode = getShortcode();
    if (!shortcode) { removeButton(); return; }

    floatingButton = document.createElement('button');
    floatingButton.id = 'gemini-extractor-btn';
    floatingButton.className = 'gemini-floating-btn';
    floatingButton.innerHTML = `
        <svg class="gemini-btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
        <span>Extract to Gemini</span>
    `;
    floatingButton.addEventListener('click', extractAndSend);
    document.body.appendChild(floatingButton);
}

function removeButton() {
    document.getElementById('gemini-extractor-btn')?.remove();
}

// ── SPA navigation observer ──
function startObserver() {
    const observer = new MutationObserver(() => {
        injectButton();
        const shortcode = getShortcode();
        if (!shortcode) {
            capturedVideoUrl = null;
            capturedBlobUrl = null;
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    injectButton();
    console.log('[Gemini Extractor v5] DOM ready. Observer started.');
}

// Wait for body to exist (it's null at document_start)
if (document.body) {
    startObserver();
} else {
    document.addEventListener('DOMContentLoaded', startObserver);
}

console.log('[Gemini Extractor v5] Initialized. interceptor.js injected into main world.');
