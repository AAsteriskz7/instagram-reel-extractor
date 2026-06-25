// UI Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettings');
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const useVertexToggle = document.getElementById('useVertexToggle');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const processingState = document.getElementById('processingState');
const historyGrid = document.getElementById('historyGrid');

const insightModal = document.getElementById('insightModal');
const closeInsightBtn = document.getElementById('closeInsight');
const insightTitle = document.getElementById('insightTitle');
const insightBody = document.getElementById('insightBody');
const copyInsightBtn = document.getElementById('copyInsightBtn');

let currentMarkdown = '';

// Settings helpers
function getApiKey() { return localStorage.getItem('gemini_api_key') || ''; }
function getSelectedModel() { return localStorage.getItem('gemini_model') || 'auto'; }
function isVertexMode() { return localStorage.getItem('use_vertex') === 'true'; }

// Build common Gemini request headers
function geminiHeaders() {
    const h = { 'x-gemini-model': getSelectedModel() };
    if (isVertexMode()) {
        h['x-use-vertex'] = 'true';
        h['x-vertex-project'] = 'smart-seat-m8ttk';
        h['x-vertex-location'] = 'us-central1';
    } else {
        h['x-gemini-api-key'] = getApiKey();
    }
    return h;
}

// Load saved settings into modal
apiKeyInput.value = getApiKey();
if (modelSelect) modelSelect.value = getSelectedModel();
if (useVertexToggle) useVertexToggle.checked = isVertexMode();


// Settings Modal
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

saveSettingsBtn.addEventListener('click', () => {
    localStorage.setItem('gemini_api_key', apiKeyInput.value.trim());
    if (modelSelect) localStorage.setItem('gemini_model', modelSelect.value);
    if (useVertexToggle) localStorage.setItem('use_vertex', useVertexToggle.checked ? 'true' : 'false');
    settingsModal.classList.add('hidden');
    loadHistory();
});

// Drag and Drop Handlers
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

async function handleFileUpload(file) {
    console.log("File selected:", file.name, "Type:", file.type, "Size:", file.size);
    if (!isVertexMode() && !getApiKey()) {
        alert("Please set your Gemini API Key in Settings, or enable Vertex AI mode.");
        settingsModal.classList.remove('hidden');
        return;
    }

    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.mov');
    if (!isVideo) {
        alert(`Please upload a valid video file. (Detected type: ${file.type}, name: ${file.name})`);
        return;
    }

    const formData = new FormData();
    formData.append('video', file);
    
    const captionText = document.getElementById('captionInput').value.trim();
    if (captionText) {
        formData.append('caption', captionText);
    }

    // Update UI
    dropZone.classList.add('hidden');
    document.getElementById('captionGroup').classList.add('hidden');
    processingState.classList.remove('hidden');
    const originalText = document.getElementById('processingText').innerText;
    document.getElementById('processingText').innerText = "Uploading to server...";

    try {
        console.log("Sending POST request to /api/analyze-file...");
        const response = await fetch('/api/analyze-file', {
            method: 'POST',
            headers: geminiHeaders(),
            body: formData
        });

        console.log("Response received with status:", response.status);
        const result = await response.json();

        if (response.ok && result.success) {
            await loadHistory();
            openInsightModal(result.insight);
        } else {
            alert("Analysis failed: " + (result.error || "Unknown error"));
        }
    } catch (error) {
        console.error("Upload error:", error);
        alert("Failed to upload and analyze the file. See console for details.");
    } finally {
        dropZone.classList.remove('hidden');
        document.getElementById('captionGroup').classList.remove('hidden');
        processingState.classList.add('hidden');
        document.getElementById('processingText').innerText = originalText;
        fileInput.value = ''; // Reset
        document.getElementById('captionInput').value = ''; // Reset caption
    }
}

// History Management
async function loadHistory() {
    try {
        const res = await fetch('/api/history');
        if (!res.ok) return;
        const data = await res.json();
        renderHistory(data);
    } catch (error) {
        console.error("Failed to load history:", error);
    }
}

function renderHistory(data) {
    historyGrid.innerHTML = '';
    if (data.length === 0) {
        historyGrid.innerHTML = '<p class="subtitle">No insights yet. Upload a reel to begin.</p>';
        return;
    }

    data.forEach(item => {
        const card = document.createElement('div');
        card.className = 'insight-card';
        card.innerHTML = `
            <h4>${item.originalFilename}</h4>
            <div class="date">${new Date(item.timestamp).toLocaleString()}</div>
            <div class="preview">${item.markdown}</div>
            <div class="card-actions">
                <button class="btn btn-icon delete-btn" title="Delete">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-btn')) {
                openInsightModal(item);
            }
        });

        const deleteBtn = card.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm("Delete this insight?")) {
                await fetch(`/api/history/${item.id}`, { method: 'DELETE' });
                loadHistory();
            }
        });

        historyGrid.appendChild(card);
    });
}

// Modal handling
function openInsightModal(item) {
    insightTitle.textContent = item.originalFilename;
    currentMarkdown = item.markdown;
    
    // Convert markdown to HTML using marked.js
    insightBody.innerHTML = marked.parse(item.markdown);
    
    insightModal.classList.remove('hidden');
}

closeInsightBtn.addEventListener('click', () => {
    insightModal.classList.add('hidden');
});

copyInsightBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentMarkdown).then(() => {
        const oldColor = copyInsightBtn.style.color;
        copyInsightBtn.style.color = '#10b981'; // Green success
        setTimeout(() => { copyInsightBtn.style.color = oldColor; }, 2000);
    });
});

// Init
loadHistory();
