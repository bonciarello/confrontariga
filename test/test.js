// Test suite for DiffLab
// Tests the diff algorithm and API endpoints

// ─── Utils ─────────────────────────────────────────────────────────────────────

// Copy of the diff algorithm from server.js for unit testing
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

// ─── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  ✗ ERROR in "${name}": ${err.message}`);
  }
}

// ─── Unit tests: Diff algorithm ─────────────────────────────────────────────────
describe('🧪 Diff Algorithm', () => {
  it('Detects identical files', () => {
    const a = ['linea uno', 'linea due', 'linea tre'];
    const b = ['linea uno', 'linea due', 'linea tre'];
    const diff = computeDiff(a, b);
    assert(diff.every(d => d.type === 'same'), 'All lines should be same');
    assert(diff.length === 3, 'Should have 3 lines');
  });

  it('Detects added lines', () => {
    const a = ['linea uno'];
    const b = ['linea uno', 'linea due', 'linea tre'];
    const diff = computeDiff(a, b);
    const added = diff.filter(d => d.type === 'added');
    assert(added.length === 2, 'Should have 2 added lines');
  });

  it('Detects removed lines', () => {
    const a = ['linea uno', 'linea due', 'linea tre'];
    const b = ['linea uno'];
    const diff = computeDiff(a, b);
    const removed = diff.filter(d => d.type === 'removed');
    assert(removed.length === 2, 'Should have 2 removed lines');
  });

  it('Merges similar lines as modified', () => {
    const a = ['questo è un piccolo cambiamento nella frase'];
    const b = ['questo è un grande cambiamento nella frase'];
    const diff = computeDiff(a, b);
    const modified = diff.filter(d => d.type === 'modified');
    assert(modified.length === 1, 'Should merge as 1 modified line');
  });

  it('Handles empty files', () => {
    const diffA = computeDiff([], ['a', 'b']);
    assert(diffA.every(d => d.type === 'added'), 'Empty A should produce all added');
    assert(diffA.length === 2, 'Should have 2 added lines');

    const diffB = computeDiff(['a', 'b'], []);
    assert(diffB.every(d => d.type === 'removed'), 'Empty B should produce all removed');
    assert(diffB.length === 2, 'Should have 2 removed lines');

    const diffC = computeDiff([], []);
    assert(diffC.length === 0, 'Both empty should produce empty diff');
  });

  it('Handles mixed changes', () => {
    const a = ['keep me', 'remove me', 'modify me old'];
    const b = ['keep me', 'added line', 'modify me new'];
    const diff = computeDiff(a, b);

    const same = diff.filter(d => d.type === 'same');
    const added = diff.filter(d => d.type === 'added');
    const removed = diff.filter(d => d.type === 'removed');
    const modified = diff.filter(d => d.type === 'modified');

    assert(same.length >= 1, 'Should have at least 1 same line');
    assert(added.length >= 1, 'Should have at least 1 added line');
    assert(removed.length >= 1 || modified.length >= 1, 'Should have removed or modified lines');
  });

  it('Levenshtein distance is correct', () => {
    assert(levenshtein('kitten', 'sitting') === 3, 'kitten→sitting = 3');
    assert(levenshtein('', 'abc') === 3, 'empty→abc = 3');
    assert(levenshtein('abc', 'abc') === 0, 'abc→abc = 0');
    assert(levenshtein('a', '') === 1, 'a→empty = 1');
  });

  it('Similarity ratio is correct', () => {
    const s1 = similarity('abc', 'abc');
    assert(s1 === 1, `identical = 1.0 (got ${s1})`);
    const s2 = similarity('abc', 'abx');
    assert(s2 > 0.5, `similar > 0.5 (got ${s2})`);
    const s3 = similarity('abc', 'xyz');
    assert(s3 < 0.5, `dissimilar < 0.5 (got ${s3})`);
    const s4 = similarity('', '');
    assert(s4 === 1, `both empty = 1.0 (got ${s4})`);
  });
});

// ─── Integration tests: API ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4599;
const BASE = `http://localhost:${PORT}`;

async function fetchUrl(urlPath, options = {}) {
  const resp = await fetch(`${BASE}${urlPath}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: resp.status, body };
}

async function multipartFetch(urlPath, files) {
  const formData = new FormData();
  for (const [fieldName, fileData] of Object.entries(files)) {
    const blob = new Blob([fileData.content], { type: 'text/plain' });
    formData.append(fieldName, blob, fileData.name);
  }
  const resp = await fetch(`${BASE}${urlPath}`, {
    method: 'POST',
    body: formData,
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: resp.status, body };
}

describe('🌐 API Endpoints', () => {
  it('GET /api/comparisons returns empty array initially', async () => {
    // First clear everything
    await fetchUrl('/api/comparisons', { method: 'DELETE' });
    const res = await fetchUrl('/api/comparisons');
    assert(res.status === 200, 'Status should be 200');
    assert(Array.isArray(res.body), 'Response should be an array');
  });

  it('POST /api/compare with two files returns id', async () => {
    const res = await multipartFetch('/api/compare', {
      fileA: { name: 'a.txt', content: 'riga 1\nriga 2\nriga 3' },
      fileB: { name: 'b.txt', content: 'riga 1\nriga 2 mod\nriga 3' },
    });
    assert(res.status === 200, `Status should be 200, got ${res.status}`);
    assert(typeof res.body.id === 'string', 'Response should have an id');
  });

  it('POST /api/compare without files returns 400', async () => {
    const res = await fetchUrl('/api/compare', { method: 'POST' });
    assert(res.status === 400, 'Status should be 400 for missing files');
  });

  it('Queue is populated after comparison', async () => {
    // Wait a moment for the comparison to process
    await new Promise(r => setTimeout(r, 800));
    const res = await fetchUrl('/api/comparisons');
    assert(res.status === 200, 'Status should be 200');
    assert(Array.isArray(res.body), 'Response should be an array');
    if (res.body.length > 0) {
      const first = res.body[0];
      assert(typeof first.id === 'string', 'Item should have id');
      assert(typeof first.nameA === 'string', 'Item should have nameA');
      assert(typeof first.nameB === 'string', 'Item should have nameB');
      assert(['pending', 'completed', 'error'].includes(first.status), 'Status should be valid');
    }
  });

  it('GET /api/comparisons/:id returns single comparison', async () => {
    const listRes = await fetchUrl('/api/comparisons');
    if (listRes.body.length > 0) {
      const id = listRes.body[0].id;
      const res = await fetchUrl(`/api/comparisons/${id}`);
      assert(res.status === 200, 'Status should be 200');
      assert(res.body.id === id, 'Should return the requested comparison');
      assert(res.body.result !== undefined, 'Should have a result (or null)');
    }
  });

  it('DELETE /api/comparisons/:id removes item', async () => {
    // Create a new one
    const createRes = await multipartFetch('/api/compare', {
      fileA: { name: 'x.txt', content: 'aaa' },
      fileB: { name: 'y.txt', content: 'bbb' },
    });
    if (createRes.status === 200 && createRes.body.id) {
      const id = createRes.body.id;
      const delRes = await fetchUrl(`/api/comparisons/${id}`, { method: 'DELETE' });
      assert(delRes.status === 200, 'Delete should return 200');
      assert(delRes.body.ok === true, 'Should confirm deletion');
    }
  });

  it('Static files are served', async () => {
    const res = await fetchUrl('/');
    assert(res.status === 200, 'Root should return 200');
    assert(typeof res.body === 'string' && res.body.includes('<!DOCTYPE html>'), 'Should serve HTML');
  });

  it('robots.txt is served', async () => {
    const res = await fetchUrl('/robots.txt');
    assert(res.status === 200, 'robots.txt should return 200');
    assert(typeof res.body === 'string' && res.body.includes('User-agent'), 'Should contain robots directives');
  });
});

// ─── Run ───────────────────────────────────────────────────────────────────────
// Give async tests time to complete
setTimeout(() => {
  console.log(`\n${'='.repeat(44)}`);
  console.log(`  Risultati: ${passed} passati, ${failed} falliti`);
  console.log(`${'='.repeat(44)}\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}, 2500);
