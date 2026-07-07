const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 4599;
const HOST = '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + '-' + file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Solo file .txt sono accettati'));
    }
  },
});

// ─── In-memory queue ───────────────────────────────────────────────────────────
const comparisons = new Map(); // id -> { id, fileA, fileB, nameA, nameB, status, result, createdAt }

function createComparison(fileA, fileB, nameA, nameB) {
  const id = uuidv4();
  const comp = {
    id,
    fileA,
    fileB,
    nameA,
    nameB,
    status: 'pending',
    result: null,
    createdAt: new Date().toISOString(),
  };
  comparisons.set(id, comp);
  return comp;
}

// ─── Diff algorithm (LCS-based) ────────────────────────────────────────────────
function lcsTable(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function backtrack(dp, a, b) {
  const result = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'same', lineA: i, lineB: j, text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', lineA: null, lineB: j, text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', lineA: i, lineB: null, text: a[i - 1] });
      i--;
    }
  }
  return result;
}

function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = (longer === a) ? b : a;
  if (longer.length === 0) return 1;
  const dist = levenshtein(longer, shorter);
  return (longer.length - dist) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) curr[j] = prev[j - 1];
      else curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function computeDiff(linesA, linesB) {
  const dp = lcsTable(linesA, linesB);
  const raw = backtrack(dp, linesA, linesB);

  // Merge consecutive removed+added pairs into "modified" when similarity >= 0.3
  const merged = [];
  let i = 0;
  while (i < raw.length) {
    if (
      i + 1 < raw.length &&
      raw[i].type === 'removed' &&
      raw[i + 1].type === 'added'
    ) {
      const sim = similarity(raw[i].text, raw[i + 1].text);
      if (sim >= 0.3) {
        merged.push({
          type: 'modified',
          lineA: raw[i].lineA,
          lineB: raw[i + 1].lineB,
          textA: raw[i].text,
          textB: raw[i + 1].text,
          similarity: Math.round(sim * 100),
        });
        i += 2;
        continue;
      }
    }
    merged.push(raw[i]);
    i++;
  }
  return merged;
}

function runComparison(comp) {
  try {
    const linesA = comp.fileA.replace(/\r\n/g, '\n').split('\n');
    const linesB = comp.fileB.replace(/\r\n/g, '\n').split('\n');

    const diff = computeDiff(linesA, linesB);

    const stats = {
      same: 0,
      added: 0,
      removed: 0,
      modified: 0,
    };
    for (const d of diff) stats[d.type] = (stats[d.type] || 0) + 1;

    comp.result = { diff, stats, totalLinesA: linesA.length, totalLinesB: linesB.length };
    comp.status = 'completed';
  } catch (err) {
    comp.status = 'error';
    comp.result = { error: err.message };
  }
}

// ─── API routes ────────────────────────────────────────────────────────────────
app.post('/api/compare', upload.fields([
  { name: 'fileA', maxCount: 1 },
  { name: 'fileB', maxCount: 1 },
]), (req, res) => {
  try {
    if (!req.files || !req.files.fileA || !req.files.fileB) {
      return res.status(400).json({ error: 'Devi caricare entrambi i file.' });
    }

    const fileA = fs.readFileSync(req.files.fileA[0].path, 'utf-8');
    const fileB = fs.readFileSync(req.files.fileB[0].path, 'utf-8');
    const nameA = req.files.fileA[0].originalname;
    const nameB = req.files.fileB[0].originalname;

    const comp = createComparison(fileA, fileB, nameA, nameB);

    // Run diff asynchronously (but it's fast for text files)
    setImmediate(() => {
      runComparison(comp);
      io.emit('comparison-updated', sanitizeComparison(comp));
    });

    // Clean up uploaded files
    try { fs.unlinkSync(req.files.fileA[0].path); } catch (_) {}
    try { fs.unlinkSync(req.files.fileB[0].path); } catch (_) {}

    io.emit('queue-updated', getQueueList());
    res.json({ id: comp.id, status: comp.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comparisons', (req, res) => {
  res.json(getQueueList());
});

app.get('/api/comparisons/:id', (req, res) => {
  const comp = comparisons.get(req.params.id);
  if (!comp) return res.status(404).json({ error: 'Confronto non trovato' });
  res.json(sanitizeComparison(comp));
});

app.delete('/api/comparisons/:id', (req, res) => {
  const existed = comparisons.delete(req.params.id);
  if (!existed) return res.status(404).json({ error: 'Confronto non trovato' });
  io.emit('queue-updated', getQueueList());
  res.json({ ok: true });
});

app.delete('/api/comparisons', (req, res) => {
  comparisons.clear();
  io.emit('queue-updated', getQueueList());
  res.json({ ok: true });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeComparison(comp) {
  const { fileA, fileB, ...rest } = comp;
  return rest;
}

function getQueueList() {
  const list = [];
  for (const comp of comparisons.values()) {
    list.push({
      id: comp.id,
      nameA: comp.nameA,
      nameB: comp.nameB,
      status: comp.status,
      createdAt: comp.createdAt,
      stats: comp.result ? comp.result.stats : null,
    });
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current queue state
  socket.emit('queue-updated', getQueueList());

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ─── Start server ──────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`DiffLab server running at http://${HOST}:${PORT}`);
});
