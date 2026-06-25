import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Database initialization
const dataDir = path.join(__dirname, 'data');
const historyFile = path.join(dataDir, 'history.json');

async function initDB() {
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
    }
    
    try {
        await fs.access(historyFile);
    } catch {
        await fs.writeFile(historyFile, JSON.stringify([]));
    }
}
initDB();

// Reusable analysis function
async function processAndAnalyzeVideo({ filePath, originalFilename, captionText, apiKey, requestedModel, useVertex, vertexProject, vertexLocation }) {
    // Initialize Gemini Client — Vertex AI (ADC) or API key mode
    let ai;
    if (useVertex) {
        console.log(`[Vertex AI] Using project: ${vertexProject || 'smart-seat-m8ttk'}, location: ${vertexLocation || 'us-central1'}`);
        ai = new GoogleGenAI({
            vertexai: true,
            project: vertexProject || 'smart-seat-m8ttk',
            location: vertexLocation || 'us-central1'
        });
    } else {
        ai = new GoogleGenAI({ apiKey: apiKey });
    }

    console.log("Uploading file to Gemini File API...");
    const uploadResult = await ai.files.upload({
        file: filePath,
        config: { mimeType: 'video/mp4' }
    });
    console.log(`Upload complete. File URI: ${uploadResult.uri}. Polling for ACTIVE state...`);
    
    // Poll until file is ACTIVE
    let fileState = uploadResult.state || 'PROCESSING';
    let pollAttempts = 0;
    while (fileState !== 'ACTIVE' && pollAttempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const fileInfo = await ai.files.get({ name: uploadResult.name });
            fileState = fileInfo.state || 'PROCESSING';
            console.log(`File state: ${fileState} (poll ${pollAttempts + 1})`);
        } catch (e) {
            console.warn('Could not poll file state, continuing...', e.message);
            break;
        }
        pollAttempts++;
    }

    let prompt = `
You are an expert tech analyzer. I am providing you with an Instagram Reel video (and potentially its audio and on-screen text).
Your task is to extract all the key informational points mentioned in the video.
Typically, these videos list things like "Top 10 projects to build", "Best 5 certifications", "Tools you need to know", or "GitHub repositories that do X".

Please provide a highly structured Markdown response that includes:
1. **Summary:** A 1-2 sentence summary of what this video is about.
2. **Key Items:** A structured list (using bullet points or numbered lists) of the exact items mentioned (projects, tools, certifications, repos). For each item, include any context or details provided in the video.
3. **Links & Repos:** If any websites, GitHub repos, or specific search terms are mentioned, list them clearly.
4. **Actionable Steps:** If the video provides a tutorial or steps, list them chronologically.

Only output the markdown. Make it beautiful, clean, and easy to read.`;

    if (captionText) {
        prompt += `\n\nThe user also provided the Instagram caption for this video. Please explicitly include its information and links in your analysis:\n\n### INSTAGRAM CAPTION ###\n${captionText}\n#########################\n`;
    }

    let modelsToTry = [];
    if (requestedModel === 'auto') {
        modelsToTry = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'];
    } else {
        modelsToTry = [requestedModel];
    }
    let response = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
        console.log(`Attempting generation with model: ${modelName}`);
        let modelSuccess = false;
        let retries = 3;

        for (let i = 0; i < retries; i++) {
            try {
                response = await ai.models.generateContent({
                    model: modelName,
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    fileData: {
                                        fileUri: uploadResult.uri,
                                        mimeType: uploadResult.mimeType || 'video/mp4'
                                    }
                                },
                                { text: prompt }
                            ]
                        }
                    ]
                });
                modelSuccess = true;
                break; // Success, break out of retry loop
            } catch (err) {
                lastError = err;
                const errString = (err.message || '') + JSON.stringify(err);
                console.warn(`Attempt ${i + 1} with ${modelName} failed: ${err.message || 'Unknown'}`);
                
                if (errString.includes('503') || errString.includes('UNAVAILABLE') || errString.includes('high demand')) {
                    console.log(`Server overloaded. Waiting 3s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else if (errString.includes('429') || errString.includes('RESOURCE_EXHAUSTED')) {
                    const delaySec = parseInt(errString.match(/retryDelay[":\s]+["']?(\d+)s/)?.[1] || '15');
                    console.log(`Rate limited (429). Waiting ${delaySec}s then retrying...`);
                    await new Promise(resolve => setTimeout(resolve, Math.min(delaySec * 1000, 35000)));
                } else {
                    console.log(`Non-retriable error on ${modelName}. Moving to next model.`);
                    break;
                }
            }
        }

        if (modelSuccess) {
            console.log(`Successfully generated content using ${modelName}!`);
            break;
        } else {
            console.log(`Failed to use ${modelName}. Trying next fallback model...`);
        }
    }

    if (!response || !response.text) {
        throw new Error(`All models failed or returned empty. Last error: ${lastError ? (lastError.message || JSON.stringify(lastError)) : 'Unknown'}`);
    }

    const markdownResult = response.text;
    
    // Clean up the local uploaded file
    await fs.unlink(filePath).catch(console.error);

    // Save to history
    const insightId = uuidv4();
    const newInsight = {
        id: insightId,
        timestamp: new Date().toISOString(),
        originalFilename: originalFilename,
        markdown: markdownResult
    };

    const historyData = JSON.parse(await fs.readFile(historyFile, 'utf-8'));
    historyData.unshift(newInsight); // Add to beginning
    await fs.writeFile(historyFile, JSON.stringify(historyData, null, 2));

    return newInsight;
}

// API Endpoint: Analyze Uploaded File
app.post('/api/analyze-file', upload.single('video'), async (req, res) => {
    console.log("--> POST /api/analyze-file hit");
    try {
        const apiKey = req.headers['x-gemini-api-key'] || '';
        const useVertex = req.headers['x-use-vertex'] === 'true';
        if (!apiKey && !useVertex) {
            return res.status(401).json({ error: 'Missing Gemini API Key. Configure it in Settings, or enable Vertex AI mode.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided.' });
        }

        const result = await processAndAnalyzeVideo({
            filePath: req.file.path,
            originalFilename: req.file.originalname,
            captionText: req.body.caption || '',
            apiKey,
            requestedModel: req.headers['x-gemini-model'] || 'auto',
            useVertex,
            vertexProject: req.headers['x-vertex-project'] || 'smart-seat-m8ttk',
            vertexLocation: req.headers['x-vertex-location'] || 'us-central1'
        });

        res.json({ success: true, insight: result });
    } catch (error) {
        console.error('Error in /api/analyze-file:', error);
        res.status(500).json({ error: error.message || 'An error occurred during analysis.' });
        if (req.file && req.file.path) fs.unlink(req.file.path).catch(() => {});
    }
});


// API Endpoint: Analyze Remote Video URL
app.post('/api/analyze-remote-video', async (req, res) => {
    console.log("--> POST /api/analyze-remote-video hit");
    let tempFilePath = null;
    try {
        const apiKey = req.headers['x-gemini-api-key'] || '';
        const useVertex = req.headers['x-use-vertex'] === 'true';
        if (!apiKey && !useVertex) {
            return res.status(401).json({ error: 'Missing Gemini API Key. Configure it in Settings, or enable Vertex AI mode.' });
        }

        let { videoUrl, caption, shortcode } = req.body;
        
        // If videoUrl is missing or is a blob URL, try to extract it server-side using the shortcode
        if (!videoUrl || videoUrl.startsWith('blob:')) {
            if (!shortcode) {
                return res.status(400).json({ error: 'No valid videoUrl or shortcode provided.' });
            }
            console.log(`[Server] Attempting to extract video URL for shortcode: ${shortcode} via embed page...`);
            try {
                const embedRes = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
                const embedHtml = await embedRes.text();
                const match = embedHtml.match(/"video_url":"([^"]+)"/);
                if (match) {
                    videoUrl = JSON.parse('"' + match[1] + '"'); // unescape unicode
                    console.log(`[Server] Successfully extracted video URL: ${videoUrl}`);
                } else {
                    throw new Error("Could not find video_url in embed HTML.");
                }
            } catch (err) {
                console.error("[Server] Server-side extraction failed:", err);
                return res.status(400).json({ error: 'Could not extract video URL automatically. Instagram may be blocking the request.' });
            }
        }

        console.log(`Downloading video from URL: ${videoUrl}`);
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Dest': 'video',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download video from CDN. Status: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.ok ? await response.arrayBuffer() : null;
        if (!arrayBuffer) {
            throw new Error('Failed to retrieve video bytes from CDN.');
        }

        const buffer = Buffer.from(arrayBuffer);
        const filename = shortcode ? `instagram_${shortcode}.mp4` : `${uuidv4()}.mp4`;
        tempFilePath = path.join(__dirname, 'uploads', filename);

        // Ensure uploads directory exists
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
        await fs.writeFile(tempFilePath, buffer);
        console.log(`Successfully saved remote video to: ${tempFilePath} (${buffer.length} bytes)`);

        const result = await processAndAnalyzeVideo({
            filePath: tempFilePath,
            originalFilename: shortcode ? `Instagram Reel (${shortcode})` : 'Instagram Reel',
            captionText: caption || '',
            apiKey,
            requestedModel: req.headers['x-gemini-model'] || 'auto',
            useVertex,
            vertexProject: req.headers['x-vertex-project'] || 'smart-seat-m8ttk',
            vertexLocation: req.headers['x-vertex-location'] || 'us-central1'
        });

        res.json({ success: true, insight: result });

    } catch (error) {
        console.error('Error in /api/analyze-remote-video:', error);
        res.status(500).json({ error: error.message || 'An error occurred during remote video analysis.' });
        if (tempFilePath) {
            fs.unlink(tempFilePath).catch(() => {});
        }
    }
});

// API Endpoint: Get History
app.get('/api/history', async (req, res) => {
    try {
        const historyData = JSON.parse(await fs.readFile(historyFile, 'utf-8'));
        res.json(historyData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read history.' });
    }
});

// API Endpoint: Delete History Item
app.delete('/api/history/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const historyData = JSON.parse(await fs.readFile(historyFile, 'utf-8'));
        const newHistory = historyData.filter(item => item.id !== id);
        await fs.writeFile(historyFile, JSON.stringify(newHistory, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete history item.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
