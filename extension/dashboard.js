// Standalone Dashboard Script — Gemini Extractor v5
// Interacts with chrome.storage.local and triggers background worker tasks

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettings');
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const processingState = document.getElementById('processingState');
const historyGrid = document.getElementById('historyGrid');
const clearAllBtn = document.getElementById('clearAllBtn');

const insightModal = document.getElementById('insightModal');
const closeInsightBtn = document.getElementById('closeInsight');
const insightTitle = document.getElementById('insightTitle');
const insightBody = document.getElementById('insightBody');
const copyInsightBtn = document.getElementById('copyInsightBtn');

let currentMarkdown = '';
let currentConfig = { apiKey: '', model: 'auto' };

// Load saved settings
function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gemini_api_key', 'gemini_model'], (items) => {
            currentConfig.apiKey = items.gemini_api_key || '';
            currentConfig.model = items.gemini_model || 'auto';
            apiKeyInput.value = currentConfig.apiKey;
            modelSelect.value = currentConfig.model;
            resolve();
        });
    });
}

// Save settings
saveSettingsBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;
    chrome.storage.local.set({
        gemini_api_key: key,
        gemini_model: model
    }, () => {
        currentConfig.apiKey = key;
        currentConfig.model = model;
        settingsModal.classList.add('hidden');
        loadHistory();
    });
});

// Settings Modal Toggles
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

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
    if (!currentConfig.apiKey) {
        alert("Please set your Gemini API Key in Settings first.");
        settingsModal.classList.remove('hidden');
        return;
    }

    const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.mov');
    if (!isVideo) {
        alert(`Please upload a valid video file. (Detected type: ${file.type}, name: ${file.name})`);
        return;
    }

    const captionText = document.getElementById('captionInput').value.trim();

    // Update UI to loading state
    dropZone.classList.add('hidden');
    document.getElementById('captionGroup').classList.add('hidden');
    processingState.classList.remove('hidden');
    const originalText = document.getElementById('processingText').innerText;
    document.getElementById('processingText').innerText = "Reading file content...";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        document.getElementById('processingText').innerText = "Uploading to Gemini & analyzing (this takes a few seconds)...";
        
        // Pass file raw bytes to background worker to upload to Gemini API
        chrome.runtime.sendMessage({
            action: 'analyzeFile',
            videoData: Array.from(uint8Array), // convert to standard array for message JSON serialization safety
            filename: file.name,
            caption: captionText
        }, (response) => {
            if (chrome.runtime.lastError) {
                alert("Extension communication failed: " + chrome.runtime.lastError.message);
                resetUI(originalText);
                return;
            }
            if (response && response.success) {
                loadHistory().then(() => {
                    openInsightModal(response.insight);
                });
            } else {
                alert("Analysis failed: " + (response?.error || "Unknown error"));
            }
            resetUI(originalText);
        });
    } catch (error) {
        console.error("Upload preparation error:", error);
        alert("Failed to read the file. See console for details.");
        resetUI(originalText);
    }
}

function resetUI(originalText) {
    dropZone.classList.remove('hidden');
    document.getElementById('captionGroup').classList.remove('hidden');
    processingState.classList.add('hidden');
    document.getElementById('processingText').innerText = originalText;
    fileInput.value = '';
    document.getElementById('captionInput').value = '';
}

// History Management
async function loadHistory() {
    chrome.storage.local.get(['history'], (result) => {
        const history = result.history || [];
        renderHistory(history);
    });
}

function renderHistory(data) {
    historyGrid.innerHTML = '';
    if (data.length === 0) {
        historyGrid.innerHTML = '<p class="subtitle">No insights yet. Upload a reel to begin.</p>';
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        return;
    }

    if (clearAllBtn) clearAllBtn.style.display = 'block';

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
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm("Delete this insight?")) {
                chrome.storage.local.get(['history'], (res) => {
                    const history = res.history || [];
                    const newHistory = history.filter(itemObj => itemObj.id !== item.id);
                    chrome.storage.local.set({ history: newHistory }, () => {
                        loadHistory();
                    });
                });
            }
        });

        historyGrid.appendChild(card);
    });
}

// Modal handling
function openInsightModal(item) {
    insightTitle.textContent = item.originalFilename;
    currentMarkdown = item.markdown;
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

// Clear All History Action
if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear all insights? This action cannot be undone.")) {
            chrome.storage.local.set({ history: [] }, () => {
                loadHistory();
            });
        }
    });
}

// Debug Logs Modal handling
const viewLogsBtn = document.getElementById('viewLogsBtn');
const logsModal = document.getElementById('logsModal');
const logsArea = document.getElementById('logsArea');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const closeLogsBtn = document.getElementById('closeLogs');

if (viewLogsBtn) {
    viewLogsBtn.addEventListener('click', () => {
        // Fetch logs from storage
        chrome.storage.local.get(['debug_logs'], (result) => {
            const logs = result.debug_logs || [];
            if (logs.length === 0) {
                logsArea.value = "No debug logs found. Go back and process a post to generate logs.";
            } else {
                logsArea.value = logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
            }
            // Auto scroll to bottom
            logsArea.scrollTop = logsArea.scrollHeight;
        });
        settingsModal.classList.add('hidden'); // Close settings modal
        logsModal.classList.remove('hidden'); // Open logs modal
    });
}

if (closeLogsBtn) {
    closeLogsBtn.addEventListener('click', () => {
        logsModal.classList.add('hidden');
    });
}

if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
        if (confirm("Clear all debug logs?")) {
            chrome.storage.local.set({ debug_logs: [] }, () => {
                logsArea.value = "Logs cleared.";
            });
        }
    });
}

// Initialize
loadSettings().then(() => {
    loadHistory();
});
