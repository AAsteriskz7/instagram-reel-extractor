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

        // Relay to background.js so it can resolve pending tab-based captures
        const shortcode = getShortcode();
        console.log('[Gemini v5] 📤 Preparing to relay to background. shortcode:', shortcode, 'pathname:', window.location.pathname);
        if (shortcode) {
            chrome.runtime.sendMessage({ action: 'videoCaptured', videoUrl: url, shortcode }, (response) => {
                console.log('[Gemini v5] 📥 Background response:', response, chrome.runtime.lastError?.message);
            });
        } else {
            // Suppress warning on saved pages where prefetching is normal
            if (!window.location.pathname.includes('/saved/')) {
                console.warn('[Gemini v5] ⚠️ Could not get shortcode from URL:', window.location.href);
            }
        }
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
    const match = window.location.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
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

// ── Helper: Wait for background task to update status in storage ──
function waitForProcessing(shortcode) {
    return new Promise((resolve, reject) => {
        // First check if it's already done
        chrome.storage.local.get([`status_${shortcode}`], (res) => {
            const status = res[`status_${shortcode}`];
            if (status) {
                if (status.state === 'success') { resolve(status); return; }
                if (status.state === 'error') { reject(new Error(status.error)); return; }
            }
            
            // Otherwise, listen for changes
            const listener = (changes, namespace) => {
                if (namespace === 'local' && changes[`status_${shortcode}`]) {
                    const newStatus = changes[`status_${shortcode}`].newValue;
                    if (newStatus) {
                        if (newStatus.state === 'success') {
                            chrome.storage.onChanged.removeListener(listener);
                            resolve(newStatus);
                        } else if (newStatus.state === 'error') {
                            chrome.storage.onChanged.removeListener(listener);
                            reject(new Error(newStatus.error));
                        }
                    }
                }
            };
            chrome.storage.onChanged.addListener(listener);
        });
    });
}

async function sendToBackend(videoUrl, caption, shortcode) {
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'analyzeUrl',
                videoUrl: videoUrl,       // may be null — backend handles it via shortcode
                caption: caption,
                shortcode: shortcode
            }, (res) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(res);
                }
            });
        });

        if (!response || !response.success) {
            showToast('❌ Analysis failed to start: ' + (response?.error || 'Unknown error'), 'error', 8000);
            return;
        }

        showToast('📡 Analysis started! Processing in background...', 'info', 4000);

        // Wait for final completion
        await waitForProcessing(shortcode);
        showToast('✅ Done! Check your extension Insights Dashboard', 'success', 6000);
    } catch (err) {
        showToast('❌ ' + (err.message || 'Error processing URL'), 'error', 8000);
    } finally {
        // Clean up status key from local storage
        chrome.storage.local.remove([`status_${shortcode}`]);
    }
}

// ── Button injection ──
function injectButton() {
    if (window.location.pathname.includes('/saved/')) { removeButton(); return; }
    
    const shortcode = getShortcode();
    if (!shortcode) { removeButton(); return; }

    if (document.getElementById('gemini-extractor-btn')) return;

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

    // Periodically watch navigation changes to prevent race conditions on SPA URL changes
    let lastPath = window.location.pathname;
    setInterval(() => {
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            injectButton();
            if (!getShortcode()) {
                capturedVideoUrl = null;
                capturedBlobUrl = null;
            }
        }
    }, 200);

    console.log('[Gemini Extractor v5] DOM ready. Observer started.');
}

// Wait for body to exist (it's null at document_start)
if (document.body) {
    startObserver();
} else {
    document.addEventListener('DOMContentLoaded', startObserver);
}

console.log('[Gemini Extractor v5] Initialized. interceptor.js injected into main world.');
