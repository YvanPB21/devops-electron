function qs(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const pipelineId = qs('pipelineId');
const runId = qs('runId');

const $runInfo = document.getElementById('run-info');
const $error = document.getElementById('error');
const $loading = document.getElementById('loading');
const $timeline = document.getElementById('timeline');
const $timelineBody = document.getElementById('timeline-body');
const $logs = document.getElementById('logs');
const $logsList = document.getElementById('logs-list');
const $logContent = document.getElementById('log-content');
const $logText = document.getElementById('log-text');

if (!pipelineId || !runId) {
  $error.textContent = 'Faltan parámetros pipelineId o runId en la URL.';
  $error.classList.remove('hidden');
  $loading.classList.add('hidden');
} else {
  fetchRunDetail();
}

async function fetchRunDetail() {
  try {
    const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    renderDetail(json.data);
    $loading.classList.add('hidden');
  } catch (err) {
    $error.textContent = `Error: ${err.message}`;
    $error.classList.remove('hidden');
    $loading.classList.add('hidden');
    console.error('fetchRunDetail error:', err);
  }
}

function renderDetail(data) {
  const { run, timeline, logs } = data || {};
  $runInfo.textContent = run ? `Run #${run.id}` : '';
  // Timeline rendering: better visual cards with expand/collapse and status
  if (timeline && timeline.records && timeline.records.length) {
    $timeline.classList.remove('hidden');
    // group by parentId to render hierarchy
    const records = timeline.records;
    const byParent = {};
    records.forEach(r => { (byParent[r.parentId || '__root'] ||= []).push(r); });

    function renderRecords(list, level = 0) {
      return list.map(r => {
        const children = byParent[r.id] || [];
        const status = (r.result || r.state || 'unknown').toLowerCase();
        const statusClass = status.includes('succeed') ? 'bg-emerald-600 text-white' : status.includes('fail') ? 'bg-red-600 text-white' : status.includes('cancel') ? 'bg-gray-500 text-white' : 'bg-sky-600 text-white';
        const dur = (r.startTime && r.finishTime) ? computeDuration(r.startTime, r.finishTime) : '—';
        return `
          <div class="timeline-step bg-slate-800 rounded p-3" style="margin-left:${level*12}px">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full ${statusClass}"></div>
                <div>
                  <div class="font-medium">${r.name || r.task || r.type}</div>
                  <div class="text-xs text-slate-400">${r.type || ''} • ${r.workerName || ''}</div>
                </div>
              </div>
              <div class="flex items-center gap-2 text-sm text-slate-400">
                <div>${dur}</div>
                <button data-record-id="${r.id}" class="toggle-step px-2 py-1 bg-slate-700 rounded text-xs">Detalles</button>
              </div>
            </div>
            <div class="step-details hidden mt-2 text-sm text-slate-300">
              <div>State: ${r.state || '—'}</div>
              <div>Result: ${r.result || '—'}</div>
              <div>Start: ${r.startTime || '—'}</div>
              <div>Finish: ${r.finishTime || '—'}</div>
              ${r.log ? `<div>Log id: ${r.log.id || ''} <button data-log-id="${r.log.id}" class="btn-log-inline text-xs ml-2 bg-slate-700 px-2 py-1 rounded">Ver log</button></div>` : ''}
            </div>
            ${children.length ? renderRecords(children, level+1) : ''}
          </div>`;
      }).join('');
    }

    const root = byParent['__root'] || byParent['null'] || byParent[null] || [];
    $timelineBody.innerHTML = renderRecords(root, 0);

    // attach toggle handlers
    $timelineBody.querySelectorAll('.toggle-step').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.timeline-step');
        const details = parent.querySelector('.step-details');
        if (details) details.classList.toggle('hidden');
      });
    });

    // inline log buttons
    $timelineBody.querySelectorAll('.btn-log-inline').forEach(b => {
      b.addEventListener('click', async () => {
        const lid = b.getAttribute('data-log-id');
        if (!lid) return;
        await loadLogContent(lid, `log #${lid}`);
      });
    });
  }

  // Logs rendering: improved list + viewer toolbar
  if (logs && logs.value && logs.value.length) {
    $logs.classList.remove('hidden');
    $logsList.innerHTML = logs.value.map(l => {
      const id = l.id || l.logId || l.key;
      const name = l.name || `log ${id}`;
      return `<div class="bg-slate-800 p-2 rounded flex items-center justify-between">
        <div>
          <div class="font-medium text-sm">${escapeHtml(name)}</div>
          <div class="text-xs text-slate-400">id: ${id}</div>
        </div>
        <div>
          <button data-log-id="${id}" class="btn-log text-sm bg-slate-700 px-2 py-1 rounded">Ver</button>
        </div>
      </div>`;
    }).join('');

    // wire log buttons
    $logsList.querySelectorAll('.btn-log').forEach(btn => {
      btn.addEventListener('click', async () => {
        const logId = btn.getAttribute('data-log-id');
        await loadLogContent(logId, `Log ${logId}`);
      });
    });
  }
}

async function loadLogContent(logId, displayName) {
  $logContent.classList.add('hidden');
  $logText.textContent = '';
  try {
    const r = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logId)}`);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    const text = j.data && j.data.content ? j.data.content : (typeof j.data === 'string' ? j.data : JSON.stringify(j.data, null, 2));
    $logText.textContent = text;
    // show toolbar
    document.getElementById('log-name').textContent = displayName || '';
    document.getElementById('log-toolbar').classList.remove('hidden');
    $logContent.classList.remove('hidden');
    setupLogToolbar(text, logId);
  } catch (err) {
    $error.textContent = `Error cargando log: ${err.message}`;
    $error.classList.remove('hidden');
  }
}

function setupLogToolbar(text, logId) {
  const btnCopy = document.getElementById('btn-copy-log');
  const btnWrap = document.getElementById('btn-toggle-wrap');
  const btnDownload = document.getElementById('btn-download-log');
  const btnOpen = document.getElementById('btn-open-log');

  if (btnCopy) {
    btnCopy.onclick = async () => {
      try { await navigator.clipboard.writeText(text); alert('Copied'); } catch (e) { alert('Copy failed'); }
    };
  }
  if (btnWrap) {
    btnWrap.onclick = () => { $logText.classList.toggle('whitespace-pre-wrap'); $logText.classList.toggle('whitespace-pre'); };
  }
  if (btnDownload) {
    btnDownload.onclick = () => {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `log-${logId}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
  }
  if (btnOpen) {
    btnOpen.onclick = () => {
      const w = window.open();
      w.document.write(`<pre>${escapeHtml(text)}</pre>`);
      w.document.close();
    };
  }
}

// helpers
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
