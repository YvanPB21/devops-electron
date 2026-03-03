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

// Check if a record or any descendant has a failed result
function hasFailed(record, byParent) {
  const status = (record.result || '').toLowerCase();
  if (status.includes('fail')) return true;
  const children = byParent[record.id] || [];
  return children.some(c => hasFailed(c, byParent));
}

function renderDetail(data) {
  const { run, timeline } = data || {};
  $runInfo.textContent = run ? `Run #${run.id}` : '';

  if (timeline && timeline.records && timeline.records.length) {
    $timeline.classList.remove('hidden');

    // group by parentId to render hierarchy
    const records = timeline.records;
    const byParent = {};
    records.forEach(r => { (byParent[r.parentId || '__root'] ||= []).push(r); });

    function renderRecords(list, level = 0) {
      return list.map(r => {
        const children = byParent[r.id] || [];
        const hasChildren = children.length > 0;
        const status = (r.result || r.state || 'unknown').toLowerCase();
        const statusIcon = status.includes('succeed') ? '✅'
          : status.includes('fail') ? '❌'
            : status.includes('cancel') ? '⛔'
              : status.includes('progress') || status.includes('running') ? '🔄'
                : status.includes('skipped') ? '⏭️'
                  : '⏳';
        const statusClass = status.includes('succeed') ? 'step-succeeded'
          : status.includes('fail') ? 'step-failed'
            : status.includes('cancel') ? 'step-canceled'
              : status.includes('progress') || status.includes('running') ? 'step-running'
                : 'step-pending';
        const dur = (r.startTime && r.finishTime) ? computeDuration(r.startTime, r.finishTime) : '—';
        const hasLog = r.log && r.log.id;
        const uniqueId = `step-${r.id}`;

        // Collapsible logic: auto-expand if failed, otherwise collapsed
        const shouldExpand = hasChildren ? hasFailed(r, byParent) : true;

        return `
          <div class="timeline-step ${statusClass}" style="margin-left:${level * 16}px" id="${uniqueId}">
            <div class="step-header${hasChildren ? ' collapsible' : ''}" ${hasChildren ? `data-target="children-${uniqueId}"` : ''}>
              <div class="step-info">
                ${hasChildren ? `<span class="step-caret" data-target="children-${uniqueId}">${shouldExpand ? '▾' : '▶'}</span>` : ''}
                <span class="step-icon">${statusIcon}</span>
                <div>
                  <div class="step-name">${escapeHtml(r.name || r.task || r.type)}</div>
                  <div class="step-meta">${escapeHtml(r.type || '')}${r.workerName ? ' • ' + escapeHtml(r.workerName) : ''}${hasChildren ? ` • ${children.length} steps` : ''}</div>
                </div>
              </div>
              <div class="step-actions">
                <span class="step-duration">${dur}</span>
                ${hasLog ? `<button class="btn-toggle-log" data-step-id="${uniqueId}" data-log-id="${r.log.id}">📋 Log</button>` : ''}
              </div>
            </div>
            ${hasLog ? `
            <div class="step-log-container hidden" id="log-${uniqueId}">
              <div class="step-log-toolbar">
                <span class="step-log-label">Log #${r.log.id}</span>
                <div class="step-log-actions">
                  <button class="btn-step-copy" title="Copiar">📋 Copy</button>
                  <button class="btn-step-download" data-log-id="${r.log.id}" title="Descargar">💾 Download</button>
                  <button class="btn-step-wrap" title="Toggle wrap">↩️ Wrap</button>
                </div>
              </div>
              <div class="step-log-loading">
                <div class="spinner-sm"></div> Cargando log…
              </div>
              <pre class="step-log-content hidden"></pre>
            </div>` : ''}
            ${hasChildren ? `<div class="step-children${shouldExpand ? '' : ' hidden'}" id="children-${uniqueId}">${renderRecords(children, level + 1)}</div>` : ''}
          </div>`;
      }).join('');
    }

    const root = byParent['__root'] || byParent['null'] || byParent[null] || [];
    $timelineBody.innerHTML = renderRecords(root, 0);

    // Attach collapse/expand handlers for steps with children
    $timelineBody.querySelectorAll('.step-header.collapsible').forEach(header => {
      header.addEventListener('click', (e) => {
        // Don't toggle if clicking on a button inside the header
        if (e.target.closest('.btn-toggle-log') || e.target.closest('.btn-step-copy') || e.target.closest('.btn-step-download') || e.target.closest('.btn-step-wrap')) return;

        const targetId = header.getAttribute('data-target');
        const childrenEl = document.getElementById(targetId);
        const caret = header.querySelector('.step-caret');
        if (!childrenEl) return;

        const isHidden = childrenEl.classList.contains('hidden');
        childrenEl.classList.toggle('hidden');
        if (caret) caret.textContent = isHidden ? '▾' : '▶';
      });
    });

    // Attach toggle handlers for inline logs
    $timelineBody.querySelectorAll('.btn-toggle-log').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent collapsible header toggle
        const stepId = btn.getAttribute('data-step-id');
        const logId = btn.getAttribute('data-log-id');
        const container = document.getElementById(`log-${stepId}`);
        if (!container) return;

        const isHidden = container.classList.contains('hidden');
        container.classList.toggle('hidden');

        // Update button appearance
        btn.classList.toggle('active', isHidden);

        // Load log content if opening and not yet loaded
        if (isHidden) {
          const pre = container.querySelector('.step-log-content');
          const loadingEl = container.querySelector('.step-log-loading');
          if (pre.dataset.loaded) {
            return;
          }
          loadingEl.classList.remove('hidden');
          pre.classList.add('hidden');
          try {
            const r = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logId)}`);
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              throw new Error(err.error || `HTTP ${r.status}`);
            }
            const j = await r.json();
            const text = j.data && j.data.content ? j.data.content : (typeof j.data === 'string' ? j.data : JSON.stringify(j.data, null, 2));
            pre.textContent = text;
            pre.dataset.loaded = '1';
            loadingEl.classList.add('hidden');
            pre.classList.remove('hidden');

            setupStepLogToolbar(container, text, logId);
          } catch (err) {
            loadingEl.innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(err.message)}</span>`;
          }
        }
      });
    });
  }
}

function setupStepLogToolbar(container, text, logId) {
  const btnCopy = container.querySelector('.btn-step-copy');
  const btnDownload = container.querySelector('.btn-step-download');
  const btnWrap = container.querySelector('.btn-step-wrap');
  const pre = container.querySelector('.step-log-content');

  if (btnCopy) {
    btnCopy.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        const orig = btnCopy.textContent;
        btnCopy.textContent = '✅ Copied';
        setTimeout(() => { btnCopy.textContent = orig; }, 1500);
      } catch (e) {
        alert('Copy failed');
      }
    };
  }
  if (btnDownload) {
    btnDownload.onclick = (e) => {
      e.stopPropagation();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `log-${logId}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
  }
  if (btnWrap) {
    btnWrap.onclick = (e) => {
      e.stopPropagation();
      pre.classList.toggle('wrap');
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
