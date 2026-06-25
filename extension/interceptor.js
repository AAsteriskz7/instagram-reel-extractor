// interceptor.js — Runs in MAIN WORLD (page context)
// Intercepts URL.createObjectURL to capture video blob URLs before they're used by the player
// Also intercepts fetch/XHR to try to grab direct CDN video URLs from Instagram's API responses

(function() {
    'use strict';

    function isInstagramVideoCDN(url) {
        return typeof url === 'string' &&
            (url.includes('cdninstagram.com') || url.includes('fbcdn.net')) &&
            (url.includes('/v/') || url.includes('/o1/') || url.includes('.mp4') || url.includes('video'));
    }

    function dispatch(url) {
        // Strip bytestart/byteend — those are DASH segment requests.
        // We want the full video URL, so remove the byte range params.
        if (url.includes('bytestart') || url.includes('byteend')) {
            try {
                const urlObj = new URL(url);
                urlObj.searchParams.delete('bytestart');
                urlObj.searchParams.delete('byteend');
                url = urlObj.toString();
            } catch (e) {
                // If it fails to parse, just ignore
                return;
            }
        }
        window.dispatchEvent(new CustomEvent('__gemini_cdn_url__', { detail: { videoUrl: url } }));
    }

    // ── 1. Intercept URL.createObjectURL to capture blob: URLs for video ──
    const _createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(blob) {
        const url = _createObjectURL(blob);
        if (blob && blob.type && blob.type.startsWith('video')) {
            window.dispatchEvent(new CustomEvent('__gemini_blob_url__', { detail: { blobUrl: url, type: blob.type } }));
        }
        return url;
    };

    // ── 2. Intercept fetch to capture CDN video URLs from Instagram's API responses ──
    const _fetch = window.fetch.bind(window);
    window.fetch = async function(...args) {
        const response = await _fetch(...args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';

        // Look for Instagram's internal API responses that contain video_url
        if (url.includes('instagram.com')) {
            try {
                const clone = response.clone();
                clone.json().then(data => {
                    const json = JSON.stringify(data);
                    // Match video_url with any CDN URL
                    const match = json.match(/"video_url":"(https:[^"]+cdninstagram[^"]+|https:[^"]+fbcdn[^"]+)"/); 
                    if (match) {
                        const videoUrl = match[1].replace(/\\\//g, '/');
                        dispatch(videoUrl);
                    }
                }).catch(() => {});
            } catch (e) {}
        }

        // Also capture direct CDN fetch requests
        if (isInstagramVideoCDN(url)) {
            dispatch(url);
        }

        return response;
    };

    // ── 3. Intercept XMLHttpRequest for CDN URLs (video segments, mp4, any video path) ──
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (isInstagramVideoCDN(url)) {
            dispatch(url);
        }
        return _open.apply(this, [method, url, ...rest]);
    };

    console.log('[Gemini Interceptor] Installed in main world. Watching for video URLs...');
})();
