// Standalone Chrome Extension Background Worker v5
// Directly downloads media, uploads to Gemini File API, polls state, and generates insights.
// Stores history inside chrome.storage.local.

const pendingCaptures = new Map();

// Helper: Retrieve configuration from local storage
async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gemini_api_key', 'gemini_model'], (items) => {
            resolve({
                apiKey: items.gemini_api_key || '',
                model: items.gemini_model || 'auto'
            });
        });
    });
}

// Helper: Save debug logs to storage for retrieval
async function debugLog(message) {
    console.log(message);
    return new Promise((resolve) => {
        chrome.storage.local.get(['debug_logs'], (result) => {
            const logs = result.debug_logs || [];
            logs.push({ timestamp: new Date().toISOString(), message });
            chrome.storage.local.set({ debug_logs: logs.slice(-200) }, resolve);
        });
    });
}

// ── Listener for extension messages ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ pong: true });
        return true;
    }
    if (message.action === 'analyzeUrl') {
        handleAnalyzeUrl(message);
        sendResponse({ success: true, status: 'started' });
        return false;
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
        sendResponse({ success: true });
        return false;
    }
    if (message.action === 'openAndCaptureVideo') {
        captureVideoUrl(message.shortcode)
            .then(videoUrl => sendResponse({ success: true, videoUrl }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// Helper: Open background tab to capture URL
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

// ── Gemini File API Multipart Upload ──
async function uploadToGeminiFileAPI(blob, filename, apiKey) {
    const metadata = JSON.stringify({ file: { displayName: filename } });
    const metadataBlob = new Blob([metadata], { type: 'application/json; charset=UTF-8' });
    
    const boundary = '-------' + Math.random().toString(36).substring(2);
    
    const multipartBlob = new Blob([
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        metadataBlob,
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${blob.type || 'video/mp4'}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--\r\n`
    ], { type: `multipart/related; boundary=${boundary}` });

    const uploadRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'multipart'
        },
        body: multipartBlob
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Gemini File API Upload failed: ${uploadRes.status} ${uploadRes.statusText} - ${errText}`);
    }

    return await uploadRes.json();
}

// ── Polling logic for ACTIVE state ──
async function pollFileState(fileResourceName, apiKey) {
    let state = 'PROCESSING';
    let attempts = 0;
    while (state !== 'ACTIVE' && attempts < 100) { // Up to 5.0 minutes
        await new Promise(r => setTimeout(r, 3000));
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`);
            if (!res.ok) throw new Error(`Polling HTTP error: ${res.status}`);
            const data = await res.json();
            state = data.state || 'PROCESSING';
            await debugLog(`[BG] File state: ${state} (attempt ${attempts + 1})`);
            if (state === 'FAILED') {
                throw new Error('Gemini video processing failed on Google servers.');
            }
        } catch (e) {
            await debugLog(`[BG] Polling error, retrying... ${e.message}`);
        }
        attempts++;
    }
    if (state !== 'ACTIVE') {
        throw new Error('Gemini File API processing timed out.');
    }
}

// ── Generate Content with Fallbacks ──
async function tryGenerateWithFallback(payload, apiKey, requestedModel) {
    let modelsToTry = [];
    if (requestedModel === 'auto') {
        modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-pro'];
    } else {
        modelsToTry = [requestedModel];
    }

    let lastError = null;
    for (const model of modelsToTry) {
        try {
            await debugLog(`[BG] Attempting content generation with model: ${model}`);
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const errMsg = errJson?.error?.message || res.statusText;
                throw new Error(`API Error (${res.status}): ${errMsg}`);
            }

            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
                throw new Error('Empty response from model.');
            }
            return text;
        } catch (e) {
            await debugLog(`[BG] Model ${model} failed: ${e.message}`);
            lastError = e;
        }
    }
    throw lastError || new Error('All fallback models failed.');
}

// ── Save Insight to chrome.storage.local ──
async function saveToHistory(title, markdown) {
    const randId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const newInsight = {
        id: randId,
        timestamp: new Date().toISOString(),
        originalFilename: title,
        markdown: markdown
    };

    return new Promise((resolve) => {
        chrome.storage.local.get(['history'], (result) => {
            const history = result.history || [];
            history.unshift(newInsight);
            chrome.storage.local.set({ history }, () => {
                resolve(newInsight);
            });
        });
    });
}

// ── Handler: Analyze URL (Reel or Carousel) ──
async function handleAnalyzeUrl(message) {
    let { videoUrl, imageUrls, caption, shortcode, postType } = message;
    try {
        await debugLog(`[BG] Start handleAnalyzeUrl for ${shortcode} (${postType})`);
        await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'processing', progress: 'started' } });

        const config = await getConfig();
        if (!config.apiKey) {
            await debugLog(`[BG] Error: Gemini API Key is not set.`);
            await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'error', error: 'Gemini API Key is not set. Open settings in dashboard.' } });
            return;
        }

        if (caption && caption.trim().length > 30) {
            await debugLog(`[BG] Caption detected for ${shortcode}. Running smart pre-check...`);
            const smartPrompt = `You are a content analyzer. Analyze this Instagram post caption:

"${caption}"

CRITICAL INSTRUCTION: Does this caption explicitly contain the actual payload of the post (e.g., the specific names of tools, resources, repositories, or URLs being promoted)? 
Many captions are just teasers (e.g. "send this to a live coder", "link in bio", "watch the video to find out"). If the caption is just a teaser/hook and DOES NOT list the specific substantive items, YOU MUST output exactly: INCOMPLETE

If the caption DOES contain the actual tools/links, format them into a structured markdown report:
1. **Title:** Catchy level 1 heading (first line).
2. **Summary:** 1-2 sentence summary.
3. **Key Items:** List of specific tools, repositories, etc.
4. **Links & Repos:** List of URLs/links mentioned.
5. **Actionable Steps:** List of steps if applicable.`;

            try {
                const smartPayload = { contents: [{ role: 'user', parts: [{ text: smartPrompt }] }] };
                const smartResult = await tryGenerateWithFallback(smartPayload, config.apiKey, config.model);
                
                const isComplete = smartResult 
                    && !smartResult.trim().toUpperCase().includes('INCOMPLETE')
                    && smartResult.length > 80
                    && !smartResult.includes('Key Items:** None')
                    && !smartResult.includes('Links & Repos:** None')
                    && (smartResult.includes('**Key Items:**') || smartResult.includes('**Links & Repos:**'));
                
                if (isComplete) {
                    await debugLog(`[BG] Smart pre-check successful! Caption contained substantive information.`);
                    let generatedTitle = `Instagram Post (${shortcode})`;
                    const titleMatch = smartResult.match(/^#\s+(.+)$/m);
                    if (titleMatch) generatedTitle = titleMatch[1].trim();
                    const newInsight = await saveToHistory(generatedTitle, smartResult);
                    await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'success', insightId: newInsight.id } });
                    return; // Early exit, completely bypassed media processing!
                } else {
                    await debugLog(`[BG] Caption pre-check returned INCOMPLETE or failed validation. Proceeding to media analysis.`);
                }
            } catch (smartErr) {
                await debugLog(`[BG] Smart pre-check failed (${smartErr.message}). Falling back to media analysis.`);
            }
        }

        const isCarousel = postType === 'Carousel';

        if (isCarousel) {
            // Process Carousel (Images)
            if (!imageUrls || imageUrls.length === 0) {
                console.log(`[BG] Fetching carousel embed HTML for: ${shortcode}`);
                const embedRes = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
                const embedHtml = await embedRes.text();
                imageUrls = [];
                const imgMatches = [...embedHtml.matchAll(/(?:src|data-src)="(https:\/\/(?:scontent[^"]+\.(?:jpg|jpeg|png|webp))[^"]*)"/g)];
                for (const m of imgMatches) {
                    const url = m[1].replace(/&amp;/g, '&');
                    if (!imageUrls.includes(url)) imageUrls.push(url);
                }
            }

            if (!imageUrls || imageUrls.length === 0) {
                sendResponse({ success: false, error: 'Could not extract images from Carousel post.' });
                return;
            }

            console.log(`[BG] Downloading images for carousel: ${shortcode}`);
            const imageParts = [];
            for (const url of imageUrls.slice(0, 10)) {
                try {
                    const imgRes = await fetch(url);
                    const buf = await imgRes.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                    imageParts.push({
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: base64
                        }
                    });
                } catch (err) {
                    console.warn(`[BG] Failed to download image slide: ${url}`, err.message);
                }
            }

            if (imageParts.length === 0) {
                sendResponse({ success: false, error: 'Failed to download carousel slide images.' });
                return;
            }

            let prompt = `You are an expert content analyzer. I am providing you with images from an Instagram carousel post (multiple slides).
Your task is to extract all the key informational points shown across all the slides.
Typically these carousel posts list things like "Top 10 tools", "Best practices", "Step-by-step guides", or informational resources.

Please provide a highly structured Markdown response that includes:
1. **Title:** A catchy, relevant, and short title as a level 1 heading (e.g. \`# 8 Quant Projects\`). It MUST be the very first line.
2. **Summary:** A 1-2 sentence summary of what this carousel is about.
3. **Key Items:** A structured list of the exact items, tips, tools, or steps shown across all slides.
4. **Links & Resources:** Any websites, GitHub repos, tools, or specific search terms mentioned — list them clearly.
5. **Actionable Steps:** If the carousel provides a tutorial or steps, list them chronologically.

Only output the markdown. Make it beautiful, clean, and easy to read.`;

            if (caption) {
                prompt += `\n\nThe Instagram caption for this post:\n### CAPTION ###\n${caption}\n###############\n`;
            }

            const payload = {
                contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }]
            };

            const markdownResult = await tryGenerateWithFallback(payload, config.apiKey, config.model);
            
            // Extract AI Title
            let generatedTitle = `Instagram Carousel (${shortcode})`;
            const titleMatch = markdownResult.match(/^#\s+(.+)$/m);
            if (titleMatch) generatedTitle = titleMatch[1].trim();

            const newInsight = await saveToHistory(generatedTitle, markdownResult);
            await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'success', insightId: newInsight.id } });

        } else {
            // Process Video (Reel)
            if (!videoUrl || videoUrl.startsWith('blob:')) {
                await debugLog(`[BG] Extracting video URL from reel HTML for ${shortcode}`);
                const pageRes = await fetch(`https://www.instagram.com/reel/${shortcode}/`);
                const pageHtml = await pageRes.text();
                const match = pageHtml.match(/"video_url":"(https:\/\/[^"]+)"/);
                if (match) {
                    videoUrl = JSON.parse('"' + match[1] + '"');
                    await debugLog(`[BG] Extracted videoUrl from HTML: ${videoUrl}`);
                } else {
                    // Fallback to background tab capture
                    await debugLog(`[BG] Falling back to background tab capture for ${shortcode}`);
                    videoUrl = await captureVideoUrl(shortcode);
                    await debugLog(`[BG] Captured videoUrl from tab: ${videoUrl}`);
                }
            }

            let videoBlob = null;
            if (message.videoData) {
                await debugLog(`[BG] Using pre-fetched video data`);
                let uint8;
                if (message.videoData instanceof Uint8Array) {
                    uint8 = message.videoData;
                } else if (Array.isArray(message.videoData)) {
                    uint8 = new Uint8Array(message.videoData);
                } else {
                    uint8 = new Uint8Array(Object.values(message.videoData));
                }
                videoBlob = new Blob([uint8], { type: 'video/mp4' });
            } else {
                if (!videoUrl) {
                    await debugLog(`[BG] Error: Could not resolve video URL`);
                    await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'error', error: 'Could not resolve Instagram video URL.' } });
                    return;
                }
                await debugLog(`[BG] Downloading video from CDN...`);
                const videoRes = await fetch(videoUrl);
                if (!videoRes.ok) {
                    throw new Error(`Failed to download video from CDN. Status: ${videoRes.status} ${videoRes.statusText}`);
                }
                videoBlob = await videoRes.blob();
                await debugLog(`[BG] Video downloaded. Size: ${videoBlob.size} bytes`);
            }

            await debugLog(`[BG] Uploading video to Gemini File API...`);
            const uploadResult = await uploadToGeminiFileAPI(videoBlob, `reel_${shortcode}.mp4`, config.apiKey);
            
            await debugLog(`[BG] File uploaded. URI: ${uploadResult.uri}. Polling state...`);
            let videoReady = false;
            try {
                await pollFileState(uploadResult.name, config.apiKey);
                videoReady = true;
                await debugLog(`[BG] Video processing active and ready.`);
            } catch (pollErr) {
                await debugLog(`[BG] Video processing timed out or failed. Fallback to caption-only: ${pollErr.message}`);
            }

            let prompt = `
You are an expert tech analyzer. I am providing you with an Instagram Reel video (and potentially its audio and on-screen text).
Your task is to extract all the key informational points mentioned in the video.
Typically, these videos list things like "Top 10 projects to build", "Best 5 certifications", "Tools you need to know", or "GitHub repositories that do X".

Please provide a highly structured Markdown response that includes:
1. **Title:** A catchy, relevant, and short title as a level 1 heading (e.g. \`# 5 Web Dev Tools\`). It MUST be the very first line.
2. **Summary:** A 1-2 sentence summary of what this video is about.
3. **Key Items:** A structured list (using bullet points or numbered lists) of the exact items mentioned (projects, tools, certifications, repos). For each item, include any context or details provided in the video.
4. **Links & Repos:** If any websites, GitHub repos, or specific search terms are mentioned, list them clearly.
5. **Actionable Steps:** If the video provides a tutorial or steps, list them chronologically.

Only output the markdown. Make it beautiful, clean, and easy to read.`;

            if (!videoReady) {
                prompt = `[NOTE: The video file for this post could not be processed. Please analyze the following Instagram caption and extract any useful resources, tools, or tips mentioned within it.]\n\n` + prompt;
            }

            if (caption) {
                prompt += `\n\n### INSTAGRAM CAPTION ###\n${caption}\n#########################\n`;
            }

            const parts = [];
            if (videoReady) {
                parts.push({ fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType || 'video/mp4' } });
            }
            parts.push({ text: prompt });

            const payload = {
                contents: [{
                    role: 'user',
                    parts: parts
                }]
            };

            await debugLog(`[BG] Sending request to Gemini API...`);
            const markdownResult = await tryGenerateWithFallback(payload, config.apiKey, config.model);
            
            // Extract AI Title
            let generatedTitle = `Instagram Reel (${shortcode})`;
            const titleMatch = markdownResult.match(/^#\s+(.+)$/m);
            if (titleMatch) generatedTitle = titleMatch[1].trim();

            await debugLog(`[BG] Content generated. Saving to history...`);
            const newInsight = await saveToHistory(generatedTitle, markdownResult);
            await debugLog(`[BG] Analysis complete for ${shortcode}`);
            await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'success', insightId: newInsight.id } });
        }
    } catch (err) {
        await debugLog(`[BG] Exception in handleAnalyzeUrl: ${err.message}\nStack: ${err.stack}`);
        console.error('[BG] Analyze URL Error:', err);
        await chrome.storage.local.set({ [`status_${shortcode}`]: { state: 'error', error: err.message || 'Error processing URL' } });
    }
}

// ── Handler: Analyze local upload file ──
async function handleAnalyzeFile(message, sendResponse) {
    try {
        const config = await getConfig();
        if (!config.apiKey) {
            sendResponse({ success: false, error: 'Gemini API Key is not set.' });
            return;
        }

        const uint8Array = new Uint8Array(message.videoData);
        const fileBlob = new Blob([uint8Array], { type: 'video/mp4' });

        console.log(`[BG] Uploading local file to Gemini File API... (${fileBlob.size} bytes)`);
        const uploadResult = await uploadToGeminiFileAPI(fileBlob, message.filename || 'video.mp4', config.apiKey);

        console.log(`[BG] File uploaded. URI: ${uploadResult.uri}. Polling state...`);
        await pollFileState(uploadResult.name, config.apiKey);

        let prompt = `
You are an expert tech analyzer. I am providing you with an Instagram Reel video (and potentially its audio and on-screen text).
Your task is to extract all the key informational points mentioned in the video.
Typically, these videos list things like "Top 10 projects to build", "Best 5 certifications", "Tools you need to know", or "GitHub repositories that do X".

Please provide a highly structured Markdown response that includes:
1. **Title:** A catchy, relevant, and short title as a level 1 heading (e.g. \`# 5 Web Dev Tools\`). It MUST be the very first line.
2. **Summary:** A 1-2 sentence summary of what this video is about.
3. **Key Items:** A structured list (using bullet points or numbered lists) of the exact items mentioned (projects, tools, certifications, repos). For each item, include any context or details provided in the video.
4. **Links & Repos:** If any websites, GitHub repos, or specific search terms are mentioned, list them clearly.
5. **Actionable Steps:** If the video provides a tutorial or steps, list them chronologically.

Only output the markdown. Make it beautiful, clean, and easy to read.`;

        if (message.caption) {
            prompt += `\n\n### INSTAGRAM CAPTION ###\n${message.caption}\n#########################\n`;
        }

        const payload = {
            contents: [{
                role: 'user',
                parts: [
                    { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType || 'video/mp4' } },
                    { text: prompt }
                ]
            }]
        };

        const markdownResult = await tryGenerateWithFallback(payload, config.apiKey, config.model);
        
        let generatedTitle = message.filename || 'Uploaded Reel';
        const titleMatch = markdownResult.match(/^#\s+(.+)$/m);
        if (titleMatch) generatedTitle = titleMatch[1].trim();

        const newInsight = await saveToHistory(generatedTitle, markdownResult);
        sendResponse({ success: true, insight: newInsight });
    } catch (err) {
        console.error('[BG] Analyze File Error:', err);
        sendResponse({ success: false, error: err.message || 'Error processing local file' });
    }
}
