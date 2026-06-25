const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

const vertexBlock = `
            <div class="form-group" style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.3);border-radius:12px;padding:14px;margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-weight:600;">
                    <input type="checkbox" id="useVertexToggle" style="width:18px;height:18px;accent-color:#a78bfa;cursor:pointer;">
                    <span>Use Vertex AI <span style="font-size:0.72rem;color:#a78bfa;font-weight:700;background:rgba(167,139,250,0.15);padding:2px 8px;border-radius:20px;">$5 Credit &bull; smart-seat-m8ttk</span></span>
                </label>
                <p class="help-text" style="margin-top:8px;">Bypasses API key quotas using your GCP project balance. Run <code>gcloud auth application-default login</code> once in your terminal.</p>
            </div>
`;

if (content.includes('<h3>Configuration</h3>')) {
    content = content.replace('<h3>Configuration</h3>', '<h3>Configuration</h3>' + vertexBlock);
    fs.writeFileSync('public/index.html', content, 'utf8');
    console.log('SUCCESS: Vertex AI toggle added to settings modal.');
} else {
    console.log('ERROR: Could not find Configuration heading in index.html');
}
