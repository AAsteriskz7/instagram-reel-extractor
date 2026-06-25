// Saved Page Module — Gemini Extractor v5
// Injects a selection toolbar + checkboxes onto Instagram's saved posts grid.
// Supports both video reels and carousel image posts.

(function () {
    'use strict';

    // ── Guard: only run on saved pages ──
    function isSavedPage() {
        return /\/saved\//.test(window.location.pathname);
    }

    if (!isSavedPage()) return;

    // ── State ──
    let selectModeActive = false;
    let processingActive = false;
    let toolbar = null;
    let checkboxObserver = null;

    // ── Toolbar injection ──
    function injectToolbar() {
        if (document.getElementById('gemini-saved-toolbar')) return;

        toolbar = document.createElement('div');
        toolbar.id = 'gemini-saved-toolbar';
        toolbar.className = 'gemini-saved-toolbar';
        toolbar.innerHTML = `
            <div class="gemini-toolbar-left">
                <button id="gemini-select-mode-btn" class="gemini-tb-btn gemini-tb-primary">
                    <span class="gemini-tb-icon">☐</span>
                    <span>Select Mode</span>
                </button>
                <button id="gemini-select-all-btn" class="gemini-tb-btn gemini-tb-secondary" style="display:none;">
                    Select All
                </button>
                <button id="gemini-deselect-all-btn" class="gemini-tb-btn gemini-tb-secondary" style="display:none;">
                    Deselect All
                </button>
                <span id="gemini-selection-count" class="gemini-count-badge" style="display:none;">0 selected</span>
            </div>
            <div class="gemini-toolbar-right">
                <div id="gemini-batch-progress" class="gemini-progress-container" style="display:none;">
                    <div class="gemini-progress-bar-track">
                        <div class="gemini-progress-bar-fill" id="gemini-progress-fill" style="width:0%"></div>
                    </div>
                    <span id="gemini-progress-text">Processing...</span>
                </div>
                <label id="gemini-auto-unsave-label" class="gemini-tb-btn gemini-tb-secondary" style="display:none; cursor:pointer; margin-right: 10px; align-items: center; color: var(--gemini-text);">
                    <input type="checkbox" id="gemini-auto-unsave-checkbox" style="margin-right: 6px; cursor: pointer;">
                    Auto-Unsave
                </label>
                <button id="gemini-process-btn" class="gemini-tb-btn gemini-tb-action" style="display:none;" disabled>
                    <span class="gemini-tb-icon">⚡</span>
                    <span id="gemini-process-label">Process Selected</span>
                </button>
            </div>
        `;

        document.body.insertAdjacentElement('afterbegin', toolbar);

        document.getElementById('gemini-select-mode-btn').addEventListener('click', toggleSelectMode);
        document.getElementById('gemini-select-all-btn').addEventListener('click', selectAll);
        document.getElementById('gemini-deselect-all-btn').addEventListener('click', deselectAll);
        document.getElementById('gemini-process-btn').addEventListener('click', processSelected);
    }

    // ── Select Mode toggle ──
    function toggleSelectMode() {
        selectModeActive = !selectModeActive;
        const btn = document.getElementById('gemini-select-mode-btn');
        const selAllBtn = document.getElementById('gemini-select-all-btn');
        const deselAllBtn = document.getElementById('gemini-deselect-all-btn');
        const countBadge = document.getElementById('gemini-selection-count');
        const processBtn = document.getElementById('gemini-process-btn');
        const autoUnsaveLabel = document.getElementById('gemini-auto-unsave-label');

        if (selectModeActive) {
            btn.classList.add('active');
            btn.querySelector('.gemini-tb-icon').textContent = '☑';
            btn.querySelector('span:last-child').textContent = 'Exit Select';
            selAllBtn.style.display = '';
            deselAllBtn.style.display = '';
            countBadge.style.display = '';
            processBtn.style.display = '';
            autoUnsaveLabel.style.display = 'inline-flex';
            injectCheckboxes();
        } else {
            btn.classList.remove('active');
            btn.querySelector('.gemini-tb-icon').textContent = '☐';
            btn.querySelector('span:last-child').textContent = 'Select Mode';
            selAllBtn.style.display = 'none';
            deselAllBtn.style.display = 'none';
            countBadge.style.display = 'none';
            processBtn.style.display = 'none';
            autoUnsaveLabel.style.display = 'none';
            removeCheckboxes();
        }
    }

    // ── Inject checkboxes on all post thumbnails ──
    function injectCheckboxes() {
        // Instagram grid: each cell is an <a href="/p/{shortcode}/"> inside a div
        const postLinks = document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]');
        postLinks.forEach(addCheckboxToLink);
    }

    function removeCheckboxes() {
        document.querySelectorAll('.gemini-post-checkbox-wrap').forEach(el => el.remove());
        document.querySelectorAll('.gemini-post-cell').forEach(el => {
            el.classList.remove('gemini-post-selected');
        });
        updateCount();
    }

    function addCheckboxToLink(link) {
        // Don't double-add
        if (link.querySelector('.gemini-post-checkbox-wrap')) return;

        // Extract shortcode
        const scMatch = link.href.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (!scMatch) return;
        const shortcode = scMatch[1];

        // Get the caption from the image alt text (Instagram puts captions there)
        const img = link.querySelector('img');
        const caption = img ? img.alt : '';

        // Determine post type from SVG aria-label
        const typeIcon = link.querySelector('svg[aria-label]');
        const postType = typeIcon ? typeIcon.getAttribute('aria-label') : 'Clip'; // "Clip", "Carousel", etc.

        // Mark the link wrapper for styling
        const cell = link.closest('.x1lliihq') || link.parentElement;
        cell.classList.add('gemini-post-cell');
        cell.dataset.shortcode = shortcode;
        cell.dataset.caption = caption;
        cell.dataset.postType = postType;

        // Create checkbox overlay
        const wrap = document.createElement('div');
        wrap.className = 'gemini-post-checkbox-wrap';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'gemini-post-checkbox';
        checkbox.dataset.shortcode = shortcode;
        checkbox.dataset.caption = caption;
        checkbox.dataset.postType = postType;

        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                cell.classList.add('gemini-post-selected');
            } else {
                cell.classList.remove('gemini-post-selected');
            }
            updateCount();
        });

        // Clicking the cell wrapper should toggle the checkbox without navigating
        link.addEventListener('click', (e) => {
            if (selectModeActive) {
                e.preventDefault();
                e.stopPropagation();
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        }, true);

        wrap.appendChild(checkbox);
        link.appendChild(wrap);
    }

    // ── Select / Deselect All ──
    function selectAll() {
        document.querySelectorAll('.gemini-post-checkbox').forEach(cb => {
            cb.checked = true;
            cb.closest('.gemini-post-cell')?.classList.add('gemini-post-selected');
        });
        updateCount();
    }

    function deselectAll() {
        document.querySelectorAll('.gemini-post-checkbox').forEach(cb => {
            cb.checked = false;
            cb.closest('.gemini-post-cell')?.classList.remove('gemini-post-selected');
        });
        updateCount();
    }

    // ── Update count badge and process button ──
    function updateCount() {
        const checked = document.querySelectorAll('.gemini-post-checkbox:checked');
        const count = checked.length;
        const countBadge = document.getElementById('gemini-selection-count');
        const processBtn = document.getElementById('gemini-process-btn');
        const label = document.getElementById('gemini-process-label');

        if (countBadge) countBadge.textContent = `${count} selected`;
        if (processBtn) {
            processBtn.disabled = count === 0 || processingActive;
            if (label) label.textContent = count > 0 ? `Process Selected (${count})` : 'Process Selected';
        }
    }

    // ── Get selected reels data ──
    function getSelectedItems() {
        return Array.from(document.querySelectorAll('.gemini-post-checkbox:checked')).map(cb => ({
            shortcode: cb.dataset.shortcode,
            caption: cb.dataset.caption || '',
            postType: cb.dataset.postType || 'Clip'
        }));
    }

    // ── Main: Process Selected ──
    async function processSelected() {
        if (processingActive) return;
        const items = getSelectedItems();
        if (items.length === 0) return;

        const autoUnsaveEnabled = document.getElementById('gemini-auto-unsave-checkbox')?.checked;

        processingActive = true;
        const processBtn = document.getElementById('gemini-process-btn');
        const progressContainer = document.getElementById('gemini-batch-progress');
        const progressFill = document.getElementById('gemini-progress-fill');
        const progressText = document.getElementById('gemini-progress-text');

        if (processBtn) processBtn.disabled = true;
        if (progressContainer) progressContainer.style.display = '';

        let doneCount = 0;
        let successCount = 0;
        let failCount = 0;
        const total = items.length;

        for (const item of items) {
            if (progressText) progressText.textContent = `Processing ${doneCount + 1} of ${total}…`;
            if (progressFill) progressFill.style.width = `${Math.round((doneCount / total) * 100)}%`;

            let videoUrl = null;
            let imageUrls = null;

            try {
                if (item.postType === 'Carousel') {
                    console.log(`[Gemini Saved] Fetching embed page for carousel: ${item.shortcode}`);
                    const res = await fetch(`https://www.instagram.com/p/${item.shortcode}/embed/captioned/`);
                    if (res.ok) {
                        const embedHtml = await res.text();
                        imageUrls = [];
                        const imgMatches = [...embedHtml.matchAll(/(?:src|data-src)="(https:\/\/(?:scontent[^"]+\.(?:jpg|jpeg|png|webp))[^"]*)"/g)];
                        for (const m of imgMatches) {
                            const url = m[1].replace(/&amp;/g, '&');
                            if (!imageUrls.includes(url)) imageUrls.push(url);
                        }
                        console.log(`[Gemini Saved] Found ${imageUrls.length} images for carousel: ${item.shortcode}`);
                    }
                } else {
                    console.log(`[Gemini Saved] Attempting to fetch video URL from reel page HTML: ${item.shortcode}`);
                    try {
                        const pageRes = await fetch(`https://www.instagram.com/reel/${item.shortcode}/`);
                        if (pageRes.ok) {
                            const pageHtml = await pageRes.text();
                            const match = pageHtml.match(/"video_url":"(https:\/\/[^"]+)"/);
                            if (match) {
                                videoUrl = JSON.parse('"' + match[1] + '"');
                                console.log(`[Gemini Saved] Successfully extracted videoUrl from reel HTML for ${item.shortcode}`);
                            }
                        }
                    } catch (e) {
                        console.error(`[Gemini Saved] Failed to fetch reel HTML for ${item.shortcode}:`, e);
                    }

                    if (!videoUrl) {
                        console.log(`[Gemini Saved] Requesting background tab capture for video: ${item.shortcode}`);
                        const captureRes = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ action: 'openAndCaptureVideo', shortcode: item.shortcode }, resolve);
                        });
                        if (captureRes && captureRes.success) {
                            videoUrl = captureRes.videoUrl;
                            console.log(`[Gemini Saved] Successfully captured videoUrl via background tab for ${item.shortcode}`);
                        } else {
                            console.warn(`[Gemini Saved] Background capture failed for ${item.shortcode}:`, captureRes?.error);
                        }
                    }
                }
            } catch (e) {
                console.error(`[Gemini Saved] Media extraction error for ${item.shortcode}:`, e);
            }

            try {
                const processSuccess = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'analyzeUrl',
                        videoUrl: videoUrl,
                        imageUrls: imageUrls,
                        caption: item.caption,
                        shortcode: item.shortcode,
                        postType: item.postType
                    }, (response) => {
                        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                        if (response && response.success) {
                            markPostDone(item.shortcode, 'success');
                            successCount++;
                            resolve(true); // Return true for success
                        } else {
                            markPostDone(item.shortcode, 'error');
                            failCount++;
                            resolve(false); // Return false for failure
                        }
                    });
                });

                if (processSuccess && autoUnsaveEnabled) {
                    try {
                        console.log(`[Gemini Saved] Auto-unsaving ${item.shortcode}...`);
                        await unsavePost(item.shortcode);
                    } catch (e) {
                        console.error(`[Gemini Saved] Failed to unsave ${item.shortcode}:`, e);
                    }
                }
            } catch (err) {
                console.error(`[Gemini Batch] Error processing ${item.shortcode}:`, err);
                markPostDone(item.shortcode, 'error');
                failCount++;
            }

            doneCount++;
        }

        // Final state
        if (progressFill) progressFill.style.width = '100%';
        if (progressText) {
            progressText.textContent = `✅ Done! ${successCount} processed${failCount > 0 ? `, ${failCount} failed` : ''} — check dashboard`;
        }

        processingActive = false;
        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
        }, 8000);

        updateCount();
    }

    // ── Mark a post cell as done/errored ──
    function markPostDone(shortcode, status) {
        const cell = document.querySelector(`.gemini-post-cell[data-shortcode="${shortcode}"]`);
        if (!cell) return;
        cell.classList.remove('gemini-post-selected');
        cell.classList.add(status === 'success' ? 'gemini-post-processed' : 'gemini-post-failed');

        // Uncheck the checkbox
        const cb = cell.querySelector('.gemini-post-checkbox');
        if (cb) cb.checked = false;

        // Add overlay indicator
        const existing = cell.querySelector('.gemini-post-status-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.className = 'gemini-post-status-overlay';
        overlay.textContent = status === 'success' ? '✅' : '❌';
        cell.querySelector('a')?.appendChild(overlay);
    }

    // ── Helper: Unsave Post via UI automation ──
    async function unsavePost(shortcode) {
        const link = document.querySelector(`a[href*="/${shortcode}/"]`);
        if (!link) return false;
        
        // 1. Open the post modal
        link.click();
        
        // 2. Wait for the Remove button
        const removeBtn = await new Promise(resolve => {
            let attempts = 0;
            const interval = setInterval(() => {
                const btn = document.querySelector('svg[aria-label="Remove"]');
                if (btn || attempts > 30) { // 3 seconds timeout
                    clearInterval(interval);
                    resolve(btn);
                }
                attempts++;
            }, 100);
        });

        // 3. Click the Remove button if found
        if (removeBtn) {
            const clickable = removeBtn.closest('[role="button"]') || removeBtn.closest('button');
            if (clickable) {
                clickable.click();
                console.log(`[Gemini Saved] Clicked unsave button for ${shortcode}`);
            }
        } else {
            console.warn(`[Gemini Saved] Could not find 'Remove' button for ${shortcode}`);
        }
        
        // Brief delay to allow unsave request to fire
        await new Promise(r => setTimeout(r, 400));

        // 4. Close the modal
        const closeBtn = document.querySelector('svg[aria-label="Close"]');
        if (closeBtn) {
            const cb = closeBtn.closest('[role="button"]') || closeBtn.closest('button') || closeBtn.closest('.x1i10hfl');
            if (cb) cb.click();
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        
        // Wait for modal to disappear
        await new Promise(r => setTimeout(r, 500));
        return true;
    }

    // ── MutationObserver: pick up lazily-loaded posts ──
    function startCheckboxObserver() {
        if (checkboxObserver) return;
        checkboxObserver = new MutationObserver(() => {
            if (!selectModeActive) return;
            const postLinks = document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]');
            postLinks.forEach(addCheckboxToLink);
        });
        if (document.body) {
            checkboxObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    // ── SPA navigation: re-check if we're still on saved page ──
    function watchNavigation() {
        let lastPath = window.location.pathname;
        setInterval(() => {
            if (window.location.pathname !== lastPath) {
                lastPath = window.location.pathname;
                if (isSavedPage()) {
                    setTimeout(init, 800); // small delay for DOM to settle
                } else {
                    // Navigated away — clean up toolbar
                    document.getElementById('gemini-saved-toolbar')?.remove();
                    toolbar = null;
                    selectModeActive = false;
                    processingActive = false;
                }
            }
        }, 500);
    }

    // ── Init ──
    function init() {
        if (!isSavedPage()) return;
        injectToolbar();
        startCheckboxObserver();
        console.log('[Gemini Saved] Toolbar injected on saved page.');
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    watchNavigation();

})();
