// Load header once (IDs must be unique; ensure only one #header-placeholder)
fetch("/reusables/header.html")
    .then(res => res.text())
    .then(html => { document.getElementById("header-placeholder").innerHTML = html; })
    .catch(console.error);

const formSection = document.getElementById('form-section');
const loadingScreen = document.getElementById('loading_screen');
formSection.style.display = 'block';

// ---------- Utilities ----------
const formatBytes = (n) => {
    if (n == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${(n < 10 && i > 0) ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const fmtDate = (d) => new Date(d).toLocaleString();

// ---------- Resume DB (vereloop/resumes) ----------
const resumeDB = (() => {
    const DB_NAME = 'vereloop';
    const STORE = 'resumes';
    let db;

    function open() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const _db = e.target.result;
                if (!_db.objectStoreNames.contains(STORE)) {
                    _db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => { db = req.result; resolve(db); };
            req.onerror = () => reject(req.error);
        });
    }

    function tx(mode = 'readonly') {
        const t = db.transaction(STORE, mode);
        return [t, t.objectStore(STORE)];
    }

    async function add({ name, mime, blob }) {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readwrite');
            const now = Date.now();
            const req = s.add({ name, mime, data: blob, created: now, updated: now });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAll() {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readonly');
            const r = s.getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
    }

    async function get(id) {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readonly');
            const r = s.get(id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    }

    return { open, add, getAll, get };
})();

// ---------- Responses DB (AI_response/responses) ----------
const responseDB = (() => {
    const DB_NAME = 'AI_response';
    const STORE = 'responses';
    let db;

    function open() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const _db = e.target.result;
                if (!_db.objectStoreNames.contains(STORE)) {
                    const os = _db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                    os.createIndex('created', 'created', { unique: false });
                }
            };
            req.onsuccess = () => { db = req.result; resolve(db); };
            req.onerror = () => reject(req.error);
        });
    }

    function tx(mode = 'readonly') {
        const t = db.transaction(STORE, mode);
        return [t, t.objectStore(STORE)];
    }

    async function add(payload, label) {
        await open();
        return new Promise((resolve, reject) => {
            const now = Date.now();
            const [t, s] = tx('readwrite');
            const rec = {
                label: label || deriveTitle(payload) || 'AI Response',
                created: now,
                data: payload
            };
            const req = s.add(rec);
            req.onsuccess = async () => { await trimToMax(10); resolve(req.result); };
            req.onerror = () => reject(req.error);
        });
    }

    async function all() {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readonly');
            const r = s.getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
    }

    async function get(id) {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readonly');
            const r = s.get(id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    }

    async function updateLabel(id, newLabel) {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readwrite');
            const getReq = s.get(id);
            getReq.onsuccess = () => {
                const rec = getReq.result;
                if (!rec) return reject(new Error('Not found'));
                rec.label = newLabel;
                const putReq = s.put(rec);
                putReq.onsuccess = () => resolve(true);
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    async function remove(id) {
        await open();
        return new Promise((resolve, reject) => {
            const [t, s] = tx('readwrite');
            const req = s.delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    async function trimToMax(max) {
        const items = await all();
        if (items.length <= max) return true;
        items.sort((a, b) => (a.created || 0) - (b.created || 0)); // oldest first
        await open();
        return new Promise((resolve) => {
            const [t, s] = tx('readwrite');
            const toDelete = items.length - max;
            for (let i = 0; i < toDelete; i++) s.delete(items[i].id);
            t.oncomplete = () => resolve(true);
        });
    }

    function deriveTitle(json) {
        if (json?.analysis?.overall_match) return json.analysis.overall_match.slice(0, 60);
        if (json?.title) return json.title;
        return `AI Response – ${new Date().toLocaleString()}`;
    }

    return { open, add, all, get, updateLabel, remove };
})();

// ---------- Resume UI ----------
const resumeBox = document.getElementById('resumeUploadBox');
const resumeFileInput = resumeBox.querySelector('#resumeFile');
const resumeSelect = resumeBox.querySelector('#resumeSelect');
const resumeRefreshBtn = document.getElementById('resumeRefreshBtn');
const resumeViewBtn = document.getElementById('resumeViewBtn');
const fileMeta = document.getElementById('fileMeta');
const choiceHint = document.getElementById('choiceHint');
const analyzeBtn = document.getElementById('analyzeBtn');

async function populateResumeDropdown() {
    await resumeDB.open();
    const items = await resumeDB.getAll();
    items.sort((a, b) => (b.updated || 0) - (a.updated || 0) || (b.created || 0) - (a.created || 0));
    resumeSelect.innerHTML = '<option value="" selected disabled>-- Select from saved resumes --</option>';
    for (const r of items) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        resumeSelect.appendChild(opt);
    }
    console.log(resumeSelect)
}

async function docxToText(file) {
    const arrayBuffer = await file.arrayBuffer();
    // Convert to HTML then strip tags to get plain text
    const { value: html } = await window.mammoth.convertToHtml({ arrayBuffer });
    const div = document.createElement('div'); div.innerHTML = html;
    return div.textContent.replace(/\s+\n/g, '\n').trim();
}

resumeFileInput.addEventListener('change', async () => {
    const f = resumeFileInput.files?.[0];
    if (f) {
        fileMeta.textContent = `Selected: ${f.name} • ${formatBytes(f.size)} • ${f.type || 'unknown'}`;
        if (choiceHint) choiceHint.textContent = 'This uploaded file will be used for analysis.';
    } else {
        fileMeta.textContent = '';
        if (choiceHint) choiceHint.textContent = 'Tip: If you select a file, it takes priority over the dropdown.';
        return;
    }
});

resumeRefreshBtn.addEventListener('click', populateResumeDropdown);

resumeViewBtn.addEventListener('click', async () => {
    const id = Number(resumeSelect.value);
    if (!id) return alert('Select a saved resume first.');
    const rec = await resumeDB.get(id);
    if (!rec || !rec.data) return alert('Resume not found.');
    const blob = rec.data instanceof Blob ? rec.data : new Blob([rec.data], { type: rec.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

async function getChosenResume() {
    const f = resumeFileInput.files?.[0];
    if (f) return { name: f.name, blob: f, source: 'upload' };
    const id = Number(resumeSelect.value);
    if (!id) return null;
    const rec = await resumeDB.get(id);
    if (!rec) return null;
    const blob = rec.data instanceof Blob ? rec.data : new Blob([rec.data], { type: rec.mime || 'application/octet-stream' });
    return { name: rec.name, blob, source: 'indexeddb', id };
    console.log('a' + rec)
}

analyzeBtn.addEventListener('click', async () => {
    const chosen = await getChosenResume();
    if (!chosen) { alert('Please upload a resume or choose one from the list.'); return; }

    console.log('chosen.blob.type ', chosen.blob.type);
    let restext = "";
    if (chosen.blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        let restext = await docxToText(chosen.blob);
        // console.log('Extracted text:', restext);
    }

    const formData = new FormData();
    formData.append('Upload Resume', chosen.blob);
    formData.append('Upload the Job description', document.getElementById('jobDescription').value.trim());
    formData.append('Resume2', restext);
    formData.append('type', chosen.blob.type);

    formSection.style.display = 'none';
    loadingScreen.style.display = 'block';

    try {
        const resp = await fetch('https://n8n.srv968815.hstgr.cloud/webhook/dea597e9-2b33-4067-a662-3087c45a956d', { method: 'POST', body: formData });
        const result = await resp.json().catch(() => ({}));

        // Save uploaded file to IndexedDB (don’t duplicate if it came from IDB)
        if (chosen.source === 'upload') {
            await resumeDB.add({ name: chosen.name, mime: chosen.blob.type || 'application/octet-stream', blob: chosen.blob });
            resumeFileInput.value = '';
            await populateResumeDropdown();
        }

        // Render (stub if not defined elsewhere)
        // (window.renderAnalysis || ((x) => console.log('analysis', x)))(result);

        const json = result;
        const newId = await responseDB.add(json);
        await renderResponsesDropdown(newId);

        // window.open(`/resume/resume/ai_response.html?id=${encodeURIComponent(newId)}`, '_blank');

        window.location.href = "/resume/resume/ai_response.html?id=${encodeURIComponent(newId)}";

        // show UI again
        loadingScreen.style.display = 'none';
        formSection.style.display = 'block';

    } catch (err) {
        loadingScreen.style.display = 'none';
        formSection.style.display = 'block';
        alert('Failed to analyze resume: ' + err);
    }
});

// ---------- Responses UI ----------
const respSelect = document.getElementById('respSelect');
const respViewBtn = document.getElementById('respViewBtn');
const respRenameBtn = document.getElementById('respRenameBtn');
const respDeleteBtn = document.getElementById('respDeleteBtn');
const respRefreshBtn = document.getElementById('respRefreshBtn');
const simulateBtn = document.getElementById('respSimulatePost');
const statusEl = document.getElementById('status');

async function renderResponsesDropdown(selectedId = null) {
    await responseDB.open();
    const rows = await responseDB.all();
    rows.sort((a, b) => (b.created || 0) - (a.created || 0));
    respSelect.innerHTML = '<option value="" selected disabled>-- Select a saved response --</option>';
    for (const r of rows) {
        const opt = document.createElement('option');
        opt.value = String(r.id);
        opt.textContent = `${r.label} • ${new Date(r.created).toLocaleString()}`;
        respSelect.appendChild(opt);
    }
    if (selectedId) {
        const found = [...respSelect.options].find(o => Number(o.value) === selectedId);
        if (found) found.selected = true;
    }
}

respViewBtn.addEventListener('click', async () => {
    const id = Number(respSelect.value);
    if (!id) return alert('Choose a saved response.');
    window.open(`/resume/resume/ai_response.html?id=${encodeURIComponent(id)}`, '_blank');
});

respRenameBtn.addEventListener('click', async () => {
    const id = Number(respSelect.value);
    if (!id) return alert('Select a response to rename.');
    const currentOpt = respSelect.options[respSelect.selectedIndex]?.textContent || '';
    const currentLabel = currentOpt.split(' • ')[0];
    const newLabel = prompt('New label:', currentLabel);
    if (!newLabel?.trim()) return;
    await responseDB.updateLabel(id, newLabel.trim());
    await renderResponsesDropdown(id);
});

respDeleteBtn.addEventListener('click', async () => {
    const id = Number(respSelect.value);
    if (!id) return alert('Select a response to delete.');
    if (!confirm('Delete this saved response? This cannot be undone.')) return;
    await responseDB.remove(id);
    await renderResponsesDropdown();
});

// simulateBtn.addEventListener('click', async () => {
//     statusEl.textContent = 'Submitting…';
//     try {
//         const json = {
//             analysis: { overall_match: 'Strong Azure + Spark alignment' },
//             match_percentage: Math.floor(Math.random() * 20) + 70,
//             created_at: new Date().toISOString()
//         };
//         const newId = await responseDB.add(json);
//         await renderResponsesDropdown(newId);
//         statusEl.textContent = 'Saved ✔';
//         setTimeout(() => (statusEl.textContent = ''), 1500);
//     } catch (e) {
//         console.error(e);
//         statusEl.textContent = 'Failed to save: ' + e;
//     }
// });

// ---------- Init ----------
(async () => {
    await resumeDB.open();
    await responseDB.open();
    await populateResumeDropdown();
    await renderResponsesDropdown();
})();