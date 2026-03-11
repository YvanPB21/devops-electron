// ── Default branch per environment ──────────────────────────────────────────
const ENV_BRANCH_MAP = { dev: 'master', uat: 'main', stg: 'master' };

function getDefaultBranch(pipelineName) {
  const hay = (pipelineName || '').toLowerCase();
  const m = hay.match(/(dev|uat|stg)/);
  return m ? (ENV_BRANCH_MAP[m[1]] || 'master') : 'master';
}

// read query params
function qs(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const id = qs('id');
const name = qs('name') || 'Pipeline';
let skip = 0;
const PAGE = 20;

const $pipelineInfo = document.getElementById('pipeline-info');
const $error = document.getElementById('error');
const $loading = document.getElementById('loading');
const $runsList = document.getElementById('runs-list');
const $runsBody = document.getElementById('runs-body');
const $btnRun = document.getElementById('btn-run');
const $runBranch = document.getElementById('run-branch');

if (!id) {
  $error.textContent = 'ID de pipeline faltante en la URL.';
  $error.classList.remove('hidden');
  $loading.classList.add('hidden');
} else {
  $pipelineInfo.textContent = decodeURIComponent(name);
  // Set default branch based on pipeline environment
  if ($runBranch) $runBranch.value = getDefaultBranch(decodeURIComponent(name));
  fetchRuns();
}

// Run pipeline directly using the inline branch input
if ($btnRun) {
  $btnRun.addEventListener('click', async () => {
    const branchVal = ($runBranch && $runBranch.value) || '';

    $btnRun.disabled = true;
    try {
      const body = {};
      if (branchVal) body.branch = branchVal;

      const res = await fetch(`/api/pipelines/${encodeURIComponent(id)}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      // optimistic insert: if API returned run id, prepend it
      const created = j.data || j;
      if (created && created.id) {
        const r = created;
        const row = `\n<tr>\n  <td class="px-4 py-3">#${r.id}${r.pipelineVersion ? ' (v' + r.pipelineVersion + ')' : ''}</td>\n  <td class="px-4 py-3">${makeBadge(r.state)}</td>\n  <td class="px-4 py-3">${makeBadge(r.result)}</td>\n  <td class="px-4 py-3">${formatDate(r.createdDate)}</td>\n  <td class="px-4 py-3">${r.finishedDate ? computeDuration(r.createdDate, r.finishedDate) : '—'}</td>\n  <td class="px-4 py-3"><a class="text-slate-100 bg-slate-700 px-2 py-1 rounded text-sm" href="run.html?pipelineId=${encodeURIComponent(id)}&runId=${encodeURIComponent(r.id)}">Detalles</a></td>\n  <td class="px-4 py-3">${r.webUrl ? `<a class="run-link text-sky-400" href="${r.webUrl}" target="_blank" rel="noopener">Ver ↗</a>` : '—'}</td>\n</tr>\n`;
        $runsBody.insertAdjacentHTML('afterbegin', row);
      }

      alert('Run iniciado');
      // refresh list beginning (reset pagination)
      skip = 0;
      $runsBody.innerHTML = '';
      fetchRuns();
    } catch (err) {
      alert('Error iniciando run: ' + err.message);
      console.error('run pipeline error', err);
    } finally {
      $btnRun.disabled = false;
    }
  });
}

async function fetchRuns() {
  try {
    const res = await fetch(`/api/pipelines/${encodeURIComponent(id)}/runs?top=${PAGE}&skip=${skip}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    renderRuns(json.data || []);
    // show load more if we received a full page
    const loadMore = document.getElementById('load-more');
    if (json.data && json.data.length === PAGE) {
      if (!loadMore) {
        const btn = document.createElement('button');
        btn.id = 'load-more';
        btn.className = 'mt-4 bg-sky-500 text-white px-3 py-1.5 rounded';
        btn.textContent = 'Cargar más';
        btn.addEventListener('click', () => {
          skip += PAGE;
          fetchRuns();
        });
        document.getElementById('runs-container').appendChild(btn);
      }
    } else if (loadMore) {
      loadMore.remove();
    }
    $loading.classList.add('hidden');
    $runsList.classList.remove('hidden');
  } catch (err) {
    $error.textContent = `Error: ${err.message}`;
    $error.classList.remove('hidden');
    $loading.classList.add('hidden');
    console.error('fetchRuns error:', err);
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function makeBadge(value) {
  if (!value) return '<span class="badge badge-unknown">—</span>';
  const v = (value || '').toLowerCase();
  if (v.includes('succeed')) return '<span class="badge badge-succeeded">✅ Succeeded</span>';
  if (v.includes('fail')) return '<span class="badge badge-failed">❌ Failed</span>';
  if (v.includes('cancel')) return '<span class="badge badge-canceled">⛔ Canceled</span>';
  return `<span class="badge badge-inprogress">${value}</span>`;
}

function renderRuns(runs) {
  if (!runs || runs.length === 0) {
    $runsBody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 p-6">No runs found</td></tr>';
    return;
  }

  const rowsHtml = runs.map(r => `
    <tr>
      <td class="px-4 py-3">#${r.id}${r.pipelineVersion ? ' (v' + r.pipelineVersion + ')' : ''}</td>
      <td class="px-4 py-3">${makeBadge(r.state)}</td>
      <td class="px-4 py-3">${makeBadge(r.result)}</td>
      <td class="px-4 py-3">${formatDate(r.createdDate)}</td>
      <td class="px-4 py-3">${r.finishedDate ? computeDuration(r.createdDate, r.finishedDate) : '—'}</td>
      <td class="px-4 py-3"><a class="text-slate-100 bg-slate-700 px-2 py-1 rounded text-sm" href="run.html?pipelineId=${encodeURIComponent(r.pipelineId)}&runId=${encodeURIComponent(r.id)}">Detalles</a></td>
      <td class="px-4 py-3">${r.webUrl ? `<a class="run-link text-sky-400" href="${r.webUrl}" target="_blank" rel="noopener">Ver ↗</a>` : '—'}</td>
    </tr>
  `).join('');

  if (skip > 0) {
    // append
    $runsBody.insertAdjacentHTML('beforeend', rowsHtml);
  } else {
    $runsBody.innerHTML = rowsHtml;
  }
}

function computeDuration(startIso, endIso) {
  if (!startIso) return null;
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const diffMs = end - start;
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
