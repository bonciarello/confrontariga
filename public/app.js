/* global io */

// ─── DOM references ────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
const socket = io({
  // sub-path: il default '/socket.io' punta alla radice del dominio (404)
  path: location.pathname.replace(/\/+$/, '') + '/socket.io',
});

// ─── State ─────────────────────────────────────────────────────────────────────
let activePanel = 'compare';
let currentResultId = null;

// ─── Navigation ────────────────────────────────────────────────────────────────
function switchPanel(name) {
  activePanel = name;
  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`#panel-${name}`).classList.add('active');

  $$('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  const btn = $(`.nav-btn[data-panel="${name}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
  }

  // Update URL hash without reload
  if (history.pushState) {
    history.pushState(null, '', `#${name}`);
  }
}

$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

// Handle initial hash
function handleHash() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'queue' || hash === 'compare') switchPanel(hash);
}
window.addEventListener('hashchange', handleHash);
handleHash();

// ─── Connection status ─────────────────────────────────────────────────────────
const connStatus = $('#connection-status');

socket.on('connect', () => {
  connStatus.textContent = 'Connesso al server';
  connStatus.className = 'connected';
});

socket.on('disconnect', () => {
  connStatus.textContent = 'Disconnesso dal server — riconnessione in corso…';
  connStatus.className = 'disconnected';
});

// ─── Upload handling ───────────────────────────────────────────────────────────
const fileAInput = $('#file-a');
const fileBInput = $('#file-b');
const submitBtn = $('#submit-btn');
const formError = $('#form-error');
const fileAHelp = $('#file-a-help');
const fileBHelp = $('#file-b-help');

let fileA = null;
let fileB = null;

function updateFileDisplay(input, display) {
  if (input.files && input.files.length > 0) {
    display.textContent = input.files[0].name;
  } else {
    display.textContent = 'Nessun file selezionato';
  }
}

function validateForm() {
  fileA = fileAInput.files && fileAInput.files[0];
  fileB = fileBInput.files && fileBInput.files[0];

  if (fileA && fileB) {
    submitBtn.disabled = false;
    formError.textContent = '';
  } else {
    submitBtn.disabled = true;
  }
}

fileAInput.addEventListener('change', () => {
  updateFileDisplay(fileAInput, fileAHelp);
  validateForm();
});

fileBInput.addEventListener('change', () => {
  updateFileDisplay(fileBInput, fileBHelp);
  validateForm();
});

// Drag and drop
['a', 'b'].forEach(suffix => {
  const zone = $(`#drop-zone-${suffix}`);
  const input = $(`#file-${suffix}`);
  const display = $(`#file-${suffix}-help`);

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      input.files = e.dataTransfer.files;
      updateFileDisplay(input, display);
      validateForm();
    }
  });
});

// ─── Form submit ───────────────────────────────────────────────────────────────
$('#compare-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!fileA || !fileB) {
    formError.textContent = 'Seleziona entrambi i file prima di avviare il confronto.';
    return;
  }

  if (!fileA.name.endsWith('.txt') && fileA.type !== 'text/plain') {
    formError.textContent = `"${fileA.name}" non è un file .txt valido. Scegli un file di testo.`;
    return;
  }
  if (!fileB.name.endsWith('.txt') && fileB.type !== 'text/plain') {
    formError.textContent = `"${fileB.name}" non è un file .txt valido. Scegli un file di testo.`;
    return;
  }

  formError.textContent = '';
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
    Analisi in corso…
  `;

  const formData = new FormData();
  formData.append('fileA', fileA);
  formData.append('fileB', fileB);

  try {
    const resp = await fetch('api/compare', {
      method: 'POST',
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Errore durante il confronto');
    }

    const data = await resp.json();
    currentResultId = data.id;

    // The result will come via Socket.IO, but we also try fetching immediately
    setTimeout(() => fetchAndDisplayResult(data.id), 300);

  } catch (err) {
    formError.textContent = err.message;
    resetSubmitBtn();
  }
});

function resetSubmitBtn() {
  submitBtn.disabled = false;
  submitBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    Avvia confronto
  `;
}

// ─── Fetch and display result ──────────────────────────────────────────────────
async function fetchAndDisplayResult(id) {
  try {
    const resp = await fetch(`api/comparisons/${id}`);
    if (!resp.ok) return;
    const comp = await resp.json();

    if (comp.status === 'completed' && comp.result) {
      displayDiff(comp);
      resetSubmitBtn();
    } else if (comp.status === 'pending') {
      // Wait and retry
      setTimeout(() => fetchAndDisplayResult(id), 500);
    } else if (comp.status === 'error') {
      formError.textContent = comp.result?.error || 'Errore sconosciuto';
      resetSubmitBtn();
    }
  } catch (err) {
    formError.textContent = err.message;
    resetSubmitBtn();
  }
}

function displayDiff(comp) {
  const container = $('#result-container');
  container.hidden = false;

  $('#result-title').textContent = `${comp.nameA} → ${comp.nameB}`;

  const stats = comp.result.stats;
  const statChips = [];
  if (stats.added > 0) statChips.push(`<span class="stat-chip added">+${stats.added} aggiunte</span>`);
  if (stats.removed > 0) statChips.push(`<span class="stat-chip removed">−${stats.removed} rimosse</span>`);
  if (stats.modified > 0) statChips.push(`<span class="stat-chip modified">~${stats.modified} modificate</span>`);
  if (stats.same > 0) statChips.push(`<span class="stat-chip same">=${stats.same} uguali</span>`);
  $('#result-stats').innerHTML = statChips.join('');

  const diffView = $('#diff-view');
  diffView.innerHTML = '';

  const diff = comp.result.diff;
  let lineNumA = 1, lineNumB = 1;

  for (const d of diff) {
    const lineEl = document.createElement('div');
    lineEl.className = `diff-line ${d.type}`;

    const tag = { added: '+', removed: '−', modified: '~', same: '' }[d.type];

    if (d.type === 'same') {
      lineEl.innerHTML = `
        <span class="diff-line-num">${lineNumA}</span>
        <span class="diff-line-num">${lineNumB}</span>
        <span class="diff-line-content">${escapeHtml(d.text)}</span>
      `;
      lineNumA++; lineNumB++;
    } else if (d.type === 'added') {
      lineEl.innerHTML = `
        <span class="diff-line-num"></span>
        <span class="diff-line-num">${lineNumB}</span>
        <span class="diff-line-content"><span class="tag">${tag}</span>${escapeHtml(d.text)}</span>
      `;
      lineNumB++;
    } else if (d.type === 'removed') {
      lineEl.innerHTML = `
        <span class="diff-line-num">${lineNumA}</span>
        <span class="diff-line-num"></span>
        <span class="diff-line-content"><span class="tag">${tag}</span>${escapeHtml(d.text)}</span>
      `;
      lineNumA++;
    } else if (d.type === 'modified') {
      lineEl.innerHTML = `
        <span class="diff-line-num">${lineNumA}</span>
        <span class="diff-line-num">${lineNumB}</span>
        <span class="diff-line-content"><span class="tag">${tag}</span><span class="text-old">${escapeHtml(d.textA)}</span> → <span class="text-new">${escapeHtml(d.textB)}</span></span>
      `;
      lineNumA++; lineNumB++;
    }

    diffView.appendChild(lineEl);
  }

  // Scroll to result
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Queue updates (Socket.IO) ─────────────────────────────────────────────────
socket.on('queue-updated', (queue) => {
  renderQueue(queue);
});

socket.on('comparison-updated', (comp) => {
  // If this is the one the current user just submitted, display it
  if (comp.id === currentResultId && comp.status === 'completed') {
    displayDiff(comp);
    resetSubmitBtn();
  }
});

function renderQueue(queue) {
  const list = $('#queue-list');
  const empty = $('#queue-empty');
  const count = $('#queue-count');

  count.textContent = queue.length;

  if (queue.length === 0) {
    list.innerHTML = '';
    list.appendChild(createEmptyMessage());
    return;
  }

  // Remove empty message if present
  if (empty) empty.remove();

  // Build new list
  const existingIds = new Set();
  $$('.queue-item').forEach(item => existingIds.add(item.dataset.id));

  list.innerHTML = '';

  for (const item of queue) {
    const el = document.createElement('div');
    el.className = 'queue-item';
    if (!existingIds.has(item.id)) el.classList.add('new-item');
    el.dataset.id = item.id;
    el.setAttribute('role', 'listitem');

    const time = new Date(item.createdAt);
    const timeStr = time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    let statsHtml = '';
    if (item.stats) {
      const parts = [];
      if (item.stats.added > 0) parts.push(`<span class="stat-dot added" title="${item.stats.added} aggiunte"></span>`);
      if (item.stats.removed > 0) parts.push(`<span class="stat-dot removed" title="${item.stats.removed} rimosse"></span>`);
      if (item.stats.modified > 0) parts.push(`<span class="stat-dot modified" title="${item.stats.modified} modificate"></span>`);
      statsHtml = parts.join('');
    }

    el.innerHTML = `
      <div class="queue-item-main">
        <div class="queue-files">
          <span class="file-name" title="${escapeHtml(item.nameA)}">${escapeHtml(item.nameA)}</span>
          <span class="arrow">→</span>
          <span class="file-name" title="${escapeHtml(item.nameB)}">${escapeHtml(item.nameB)}</span>
        </div>
        <span class="queue-status ${item.status}">${item.status === 'pending' ? 'In corso' : item.status === 'completed' ? 'Completato' : 'Errore'}</span>
        <span class="queue-stats">${statsHtml}</span>
        <span class="queue-time">${timeStr}</span>
      </div>
      <div class="queue-item-actions">
        <button class="btn-icon view-btn" title="Visualizza risultato" aria-label="Visualizza confronto ${escapeHtml(item.nameA)} → ${escapeHtml(item.nameB)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="btn-icon delete-btn" title="Rimuovi dalla coda" aria-label="Rimuovi confronto ${escapeHtml(item.nameA)} → ${escapeHtml(item.nameB)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    // Event listeners
    el.querySelector('.view-btn').addEventListener('click', async () => {
      try {
        const resp = await fetch(`api/comparisons/${item.id}`);
        if (!resp.ok) throw new Error('Confronto non trovato');
        const comp = await resp.json();
        if (comp.status === 'completed') {
          switchPanel('compare');
          displayDiff(comp);
        }
      } catch (err) {
        alert('Impossibile caricare il confronto: ' + err.message);
      }
    });

    el.querySelector('.delete-btn').addEventListener('click', async () => {
      try {
        await fetch(`api/comparisons/${item.id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Delete failed:', err);
      }
    });

    list.appendChild(el);
  }
}

function createEmptyMessage() {
  const p = document.createElement('p');
  p.className = 'queue-empty';
  p.id = 'queue-empty';
  p.textContent = 'Nessun confronto in coda. Carica due file per iniziare.';
  return p;
}

// ─── Clear all queue ───────────────────────────────────────────────────────────
$('#clear-queue-btn').addEventListener('click', async () => {
  if (confirm('Vuoi davvero svuotare l\'intera coda? Questa azione è visibile a tutti gli utenti connessi.')) {
    try {
      await fetch('api/comparisons', { method: 'DELETE' });
    } catch (err) {
      console.error('Clear failed:', err);
    }
  }
});

// ─── Global keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl+1 or Alt+1: switch to Compare
  if ((e.ctrlKey || e.metaKey) && e.key === '1') {
    e.preventDefault();
    switchPanel('compare');
  }
  // Ctrl+2 or Alt+2: switch to Queue
  if ((e.ctrlKey || e.metaKey) && e.key === '2') {
    e.preventDefault();
    switchPanel('queue');
  }
});
