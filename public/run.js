// ── Query params & DOM refs ─────────────────────────────────────────────────
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

const pipelineId = qs('pipelineId');
const runId = qs('runId');

const $runInfo = document.getElementById('run-info');
const $runStatus = document.getElementById('run-status-badge');
const $error = document.getElementById('error');
const $loading = document.getElementById('loading');
const $layout = document.getElementById('run-layout');
const $sidebarTitle = document.getElementById('sidebar-title');
const $sidebarPName = document.getElementById('sidebar-pipeline-name');
const $sidebarBody = document.getElementById('sidebar-body');
const $logTitle = document.getElementById('log-job-name');
const $logIcon = document.getElementById('log-job-icon');
const $logPlaceholder = document.getElementById('log-placeholder');
const $logLoading = document.getElementById('log-loading');
const $logContent = document.getElementById('log-content');
const $logPanelBody = document.getElementById('log-panel-body');
const $btnCopy = document.getElementById('btn-log-copy');
const $btnDownload = document.getElementById('btn-log-download');
const $btnWrap = document.getElementById('btn-log-wrap');
const $btnFollow = document.getElementById('btn-log-follow');
const $btnTimestamp = document.getElementById('btn-log-timestamp');

// ── State ───────────────────────────────────────────────────────────────────
const POLL_INTERVAL = 5000;
const LOG_POLL_INTERVAL = 3000;

let pollTimer = null;
let logTimer = null;
let runState = null;
let selectedId = null;  // record id currently shown in log panel (job OR step)
let autoFollow = true;
let logText = '';
let currentLogId = null;
let showTimestamps = false;
let lastRecords = [];
let jobQueuePositions = {}; // Map of { jobId -> position }
const expandedJobs = new Set(); // track which jobs are expanded in sidebar

// ── Init ────────────────────────────────────────────────────────────────────
if (!pipelineId || !runId) {
  $error.textContent = 'Faltan parámetros pipelineId o runId en la URL.';
  $error.classList.remove('hidden');
  $loading.classList.add('hidden');
} else {
  start();
}

async function start() {
  await fetchAndRender();
  if (!isRunCompleted()) {
    pollTimer = setInterval(pollTimeline, POLL_INTERVAL);
  }
}

function isRunCompleted() {
  if (!runState) return false;
  const s = runState.toLowerCase();
  return s === 'completed' || s === 'canceled' || s === 'cancelling';
}

// ── Fetch run detail (first load) ──────────────────────────────────────────
async function fetchAndRender() {
  try {
    const res = await fetch(`/api/pipelines/${enc(pipelineId)}/runs/${enc(runId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    const { run, timeline } = json.data || {};

    runState = run?.state || null;
    $runInfo.textContent = run ? `Run #${run.id}` : '';
    renderRunStatus(run);

    if (timeline && timeline.records && timeline.records.length) {
      lastRecords = timeline.records;
      renderSidebar(timeline.records);
      $loading.classList.add('hidden');
      $layout.classList.remove('hidden');
      autoSelectJob(timeline.records);
    } else {
      $loading.classList.add('hidden');
      $layout.classList.remove('hidden');
    }
  } catch (err) {
    $error.textContent = `Error: ${err.message}`;
    $error.classList.remove('hidden');
    $loading.classList.add('hidden');
    console.error('fetchAndRender error:', err);
  }
}

// ── Poll timeline ──────────────────────────────────────────────────────────
async function pollTimeline() {
  try {
    const res = await fetch(`/api/pipelines/${enc(pipelineId)}/runs/${enc(runId)}`);
    if (!res.ok) return;
    const json = await res.json();
    const { run, timeline } = json.data || {};

    runState = run?.state || null;
    renderRunStatus(run);

    if (timeline && timeline.records) {
      lastRecords = timeline.records;
      
      // Check if there are any jobs in pending state, if so, fetch job queue positions
      const hasPendingJobs = lastRecords.some(r => 
        (r.type || '').toLowerCase() === 'job' && 
        ((r.state || '').toLowerCase() === 'pending' || (r.state || '').toLowerCase() === 'notstarted' || (r.state || '').toLowerCase() === 'queued')
      );
      if (hasPendingJobs) {
        try {
          const jqRes = await fetch(`/api/pipelines/${enc(pipelineId)}/runs/${enc(runId)}/jobrequests`);
          if (jqRes.ok) {
            const jqJson = await jqRes.json();
            jobQueuePositions = jqJson.data || {};
          }
        } catch(e) { console.warn('Could not fetch job queue positions', e); }
      } else {
        jobQueuePositions = {}; // Clear if no longer pending
      }

      updateSidebarStatuses(timeline.records);
      // Also update step list for expanded jobs (new steps may have appeared)
      updateExpandedJobSteps(timeline.records);
      if (autoFollow) autoSelectJob(timeline.records);
    }

    if (isRunCompleted()) {
      clearInterval(pollTimer);
      pollTimer = null;
      if (timeline && timeline.records) updateSidebarStatuses(timeline.records);
    }
  } catch (err) {
    console.error('pollTimeline error:', err);
  }
}

// ── Run status badge ───────────────────────────────────────────────────────
function renderRunStatus(run) {
  if (!run) return;
  const state = (run.state || '').toLowerCase();
  const result = (run.result || '').toLowerCase();
  let badge = '';
  if (state === 'completed') {
    if (result.includes('succeed')) badge = '<span class="badge badge-succeeded">✅ Succeeded</span>';
    else if (result.includes('fail')) badge = '<span class="badge badge-failed">❌ Failed</span>';
    else if (result.includes('cancel')) badge = '<span class="badge badge-canceled">⛔ Canceled</span>';
    else badge = `<span class="badge badge-succeeded">${esc(run.result || 'Completed')}</span>`;
  } else if (state.includes('progress')) {
    badge = '<span class="badge badge-inprogress"><span class="status-spinner"></span> In Progress</span>';
  } else if (state === 'cancelling') {
    badge = '<span class="badge badge-canceled">⏳ Cancelling</span>';
  } else if (state === 'notstarted' || state === 'queued' || state === 'postponed') {
    const qStr = run.queuePosition != null ? ` (Pos: ${run.queuePosition})` : '';
    badge = `<span class="badge badge-queued">🕒 Queued${qStr}</span>`;
  } else {
    badge = `<span class="badge badge-unknown">${esc(run.state || '—')}</span>`;
  }
  $runStatus.innerHTML = badge;
}

// ── Sidebar rendering ──────────────────────────────────────────────────────
function renderSidebar(records) {
  const byParent = {};
  records.forEach(r => { (byParent[r.parentId || '__root'] ||= []).push(r); });

  const typeOf = r => (r.type || '').toLowerCase();
  const stages = records.filter(r => typeOf(r) === 'stage');
  const jobs = records.filter(r => typeOf(r) === 'job');
  const phases = records.filter(r => typeOf(r) === 'phase');

  // Build a lookup: for each stage, find its jobs (possibly through a Phase layer)
  function getStageJobs(stageId) {
    // Direct children that are Jobs
    let result = jobs.filter(j => j.parentId === stageId);
    // Also check through Phase children
    const stagePhases = phases.filter(p => p.parentId === stageId);
    stagePhases.forEach(phase => {
      result = result.concat(jobs.filter(j => j.parentId === phase.id));
    });
    result.sort((a, b) => (a.order || 0) - (b.order || 0));
    return result;
  }

  let html = '';

  if (stages.length > 0) {
    stages.sort((a, b) => (a.order || 0) - (b.order || 0));
    stages.forEach(stage => {
      const stageJobs = getStageJobs(stage.id);
      html += `<div class="sidebar-stage">
        <div class="sidebar-stage-label">${statusDot(stage)} STAGE: ${esc(stage.name)}</div>
        ${stageJobs.map(j => renderSidebarJob(j, records)).join('')}
      </div>`;
    });
  } else {
    jobs.sort((a, b) => (a.order || 0) - (b.order || 0));
    html = jobs.map(j => renderSidebarJob(j, records)).join('');
  }

  $sidebarBody.innerHTML = html;
  $sidebarTitle.textContent = `Jobs in run #${runId}`;

  wireSidebarHandlers();
}

// Types to exclude from the step list (they are structural, not actual steps)
const STRUCTURAL_TYPES = new Set(['stage', 'phase', 'job', 'checkpoint']);

function getJobSteps(jobId, records) {
  return records
    .filter(r => r.parentId === jobId && !STRUCTURAL_TYPES.has((r.type || '').toLowerCase()))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function renderSidebarJob(j, records) {
  const isSelected = j.id === selectedId;
  const isExpanded = expandedJobs.has(j.id);
  const steps = getJobSteps(j.id, records);
  const hasSteps = steps.length > 0;

  return `<div class="sidebar-job-group" data-job-group-id="${j.id}">
    <div class="sidebar-job ${isSelected ? 'selected' : ''}" data-job-id="${j.id}" data-has-steps="${hasSteps}">
      ${hasSteps ? `<span class="sidebar-job-caret ${isExpanded ? 'expanded' : ''}" data-toggle-job="${j.id}">▶</span>` : '<span class="sidebar-job-caret-spacer"></span>'}
      <span class="sidebar-job-icon" data-record-id="${j.id}">${statusIcon(j, true)}</span>
      <span class="sidebar-job-name">JOB: ${esc(j.name)}</span>
      <span class="sidebar-job-queue-pos" data-queue-job-id="${j.id}">${jobQueuePositions[j.id] ? `<span class="badge badge-queued" style="font-size: 0.65rem; padding: 1px 4px; margin-left: 6px;">Pos: ${jobQueuePositions[j.id]}</span>` : ''}</span>
    </div>
    ${hasSteps ? `<div class="sidebar-steps ${isExpanded ? '' : 'hidden'}" id="steps-${j.id}">
      ${steps.map(s => renderSidebarStep(s)).join('')}
    </div>` : ''}
  </div>`;
}

function renderSidebarStep(s) {
  const isSelected = s.id === selectedId;
  const hasLog = s.log && s.log.id;
  return `<div class="sidebar-step ${isSelected ? 'selected' : ''} ${hasLog ? '' : 'no-log'}" data-step-id="${s.id}" data-log-id="${hasLog ? s.log.id : ''}">
    <span class="sidebar-step-icon" data-record-id="${s.id}">${statusIcon(s)}</span>
    <span class="sidebar-step-name" title="${esc(s.name || s.task || s.type)}">${esc(s.name || s.task || s.type)}</span>
  </div>`;
}

function wireSidebarHandlers() {
  // Job click → show composite log for this job
  $sidebarBody.querySelectorAll('.sidebar-job').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger if clicking the caret
      if (e.target.closest('.sidebar-job-caret')) return;
      const jobId = el.getAttribute('data-job-id');
      autoFollow = false;
      $btnFollow.classList.remove('active');
      selectRecord(jobId, 'job');
    });
  });

  // Caret click → toggle step list
  $sidebarBody.querySelectorAll('.sidebar-job-caret').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = el.getAttribute('data-toggle-job');
      toggleJobSteps(jobId);
    });
  });

  // Step click → show individual step log
  $sidebarBody.querySelectorAll('.sidebar-step').forEach(el => {
    el.addEventListener('click', () => {
      const stepId = el.getAttribute('data-step-id');
      const logId = el.getAttribute('data-log-id');
      if (!logId) return; // no log available for this step
      autoFollow = false;
      $btnFollow.classList.remove('active');
      selectRecord(stepId, 'step');
    });
  });
}

function toggleJobSteps(jobId) {
  const stepsEl = document.getElementById(`steps-${jobId}`);
  const caretEl = $sidebarBody.querySelector(`.sidebar-job-caret[data-toggle-job="${jobId}"]`);
  if (!stepsEl) return;

  const isHidden = stepsEl.classList.contains('hidden');
  stepsEl.classList.toggle('hidden');
  if (caretEl) caretEl.classList.toggle('expanded', isHidden);

  if (isHidden) {
    expandedJobs.add(jobId);
  } else {
    expandedJobs.delete(jobId);
  }
}

function updateExpandedJobSteps(records) {
  // For expanded jobs, refresh their step lists in case new steps appeared
  expandedJobs.forEach(jobId => {
    const stepsEl = document.getElementById(`steps-${jobId}`);
    if (!stepsEl) return;
    const steps = getJobSteps(jobId, records);
    steps.sort((a, b) => (a.order || 0) - (b.order || 0));
    stepsEl.innerHTML = steps.map(s => renderSidebarStep(s)).join('');
    // Re-wire step handlers for the new elements
    stepsEl.querySelectorAll('.sidebar-step').forEach(el => {
      el.addEventListener('click', () => {
        const stepId = el.getAttribute('data-step-id');
        const logId = el.getAttribute('data-log-id');
        if (!logId) return;
        autoFollow = false;
        $btnFollow.classList.remove('active');
        selectRecord(stepId, 'step');
      });
    });
  });
}

function updateSidebarStatuses(records) {
  const byId = {};
  records.forEach(r => { byId[r.id] = r; });

  // Update all icons (jobs and steps)
  $sidebarBody.querySelectorAll('[data-record-id]').forEach(el => {
    const rid = el.getAttribute('data-record-id');
    const r = byId[rid];
    if (!r) return;
    // Stage dots
    if (el.classList.contains('stage-dot')) {
      el.outerHTML = statusDot(r);
    } else {
      el.innerHTML = statusIcon(r, true);
    }
  });

  // Update job queue positions
  $sidebarBody.querySelectorAll('.sidebar-job-queue-pos').forEach(el => {
    const rid = el.getAttribute('data-queue-job-id');
    if (jobQueuePositions[rid]) {
      el.innerHTML = `<span class="badge badge-queued" style="font-size: 0.65rem; padding: 1px 4px; margin-left: 6px;">Pos: ${jobQueuePositions[rid]}</span>`;
    } else {
      el.innerHTML = '';
    }
  });
}

function statusIcon(record, isSidebar = false) {
  const s = ((record.result || record.state || 'pending').toLowerCase());
  if (s.includes('succeed')) return '<span class="si si-ok">✅</span>';
  if (s.includes('fail')) return '<span class="si si-fail">❌</span>';
  if (s.includes('cancel')) return '<span class="si si-cancel">⛔</span>';
  if (s.includes('progress') || s.includes('running'))
    return '<span class="si si-running"><span class="status-spinner"></span></span>';
  if (s.includes('skipped')) return '<span class="si si-skip">⏭️</span>';
  
  if (s === 'notstarted' || s === 'queued' || s === 'pending') {
    return '<span class="si si-queued">🕒</span>';
  }
  
  return '<span class="si si-pending">○</span>';
}

function statusDot(record) {
  const s = ((record.result || record.state || 'pending').toLowerCase());
  let cls = 'dot-pending';
  if (s.includes('succeed')) cls = 'dot-ok';
  else if (s.includes('fail')) cls = 'dot-fail';
  else if (s.includes('cancel')) cls = 'dot-cancel';
  else if (s.includes('progress') || s.includes('running')) cls = 'dot-running';
  else if (s === 'notstarted' || s === 'queued') cls = 'dot-queued';
  return `<span class="stage-dot ${cls}" data-record-id="${record.id}"></span>`;
}

// ── Record selection & log display ─────────────────────────────────────────
function autoSelectJob(records) {
  if (!autoFollow) return;

  // Find first inProgress job
  const inProgressJob = records.find(r =>
    (r.type || '').toLowerCase() === 'job' &&
    ((r.state || '').toLowerCase().includes('progress') || (r.state || '').toLowerCase().includes('running'))
  );

  if (inProgressJob) {
    if (inProgressJob.id !== selectedId) selectRecord(inProgressJob.id, 'job');
    // Auto-expand the in-progress job
    if (!expandedJobs.has(inProgressJob.id)) toggleJobSteps(inProgressJob.id);
    return;
  }

  // If no in-progress, find first failed job
  const failedJob = records.find(r =>
    (r.type || '').toLowerCase() === 'job' &&
    (r.result || '').toLowerCase().includes('fail')
  );
  if (failedJob && failedJob.id !== selectedId) {
    selectRecord(failedJob.id, 'job');
    if (!expandedJobs.has(failedJob.id)) toggleJobSteps(failedJob.id);
    return;
  }

  // If nothing selected yet, select first job
  if (!selectedId) {
    const firstJob = records.find(r => (r.type || '').toLowerCase() === 'job');
    if (firstJob) {
      selectRecord(firstJob.id, 'job');
      if (!expandedJobs.has(firstJob.id)) toggleJobSteps(firstJob.id);
    }
  }
}

function selectRecord(recordId, type) {
  selectedId = recordId;

  // Update sidebar selection highlighting
  $sidebarBody.querySelectorAll('.sidebar-job, .sidebar-step').forEach(el => {
    const id = el.getAttribute('data-job-id') || el.getAttribute('data-step-id');
    el.classList.toggle('selected', id === recordId);
  });

  const record = lastRecords.find(r => r.id === recordId);
  if (!record) return;

  // Update log panel header
  const label = type === 'step' ? (record.name || record.task || record.type) : `JOB: ${record.name}`;
  $logTitle.textContent = label;
  $logIcon.innerHTML = statusIcon(record);

  // Clear previous log
  logText = '';
  $logContent.textContent = '';
  $logContent.dataset.hash = '';
  $logContent.classList.add('hidden');
  $logPlaceholder.classList.add('hidden');

  // Stop previous log polling
  if (logTimer) { clearInterval(logTimer); logTimer = null; }

  if (type === 'step') {
    // Show individual step log
    if (record.log && record.log.id) {
      currentLogId = record.log.id;
      fetchAndShowLog(record.log.id);
      startLogPollingIfActive(record, record.log.id);
    } else {
      showWaitingForLogs(record);
    }
  } else {
    // type === 'job': show composite log of all child tasks
    const jobTasks = lastRecords.filter(r => r.parentId === recordId && r.log && r.log.id);

    if (record.log && record.log.id) {
      // Job has its own direct log
      currentLogId = record.log.id;
      fetchAndShowLog(record.log.id);
      startLogPollingIfActive(record, record.log.id);
    } else if (jobTasks.length > 0) {
      fetchCompositeLog(jobTasks);
      startCompositePollingIfActive(record, recordId);
    } else {
      showWaitingForLogs(record);
    }
  }
}

function startLogPollingIfActive(record, logId) {
  const state = (record.state || '').toLowerCase();
  if (state.includes('progress') || state.includes('running')) {
    logTimer = setInterval(() => fetchAndShowLog(logId), LOG_POLL_INTERVAL);
  }
}

function startCompositePollingIfActive(record, jobId) {
  const state = (record.state || '').toLowerCase();
  if (state.includes('progress') || state.includes('running')) {
    logTimer = setInterval(() => {
      const tasks = lastRecords.filter(r => r.parentId === jobId && r.log && r.log.id);
      if (tasks.length > 0) fetchCompositeLog(tasks);
    }, LOG_POLL_INTERVAL);
  }
}

function showWaitingForLogs(record) {
  $logPlaceholder.innerHTML = '<p>⏳ Esperando logs…</p>';
  $logPlaceholder.classList.remove('hidden');

  const state = (record.state || '').toLowerCase();
  if (state.includes('progress') || state.includes('running') || state === 'notstarted') {
    const recId = record.id;
    logTimer = setInterval(() => {
      const updated = lastRecords.find(r => r.id === recId);
      if (updated && updated.log && updated.log.id) {
        clearInterval(logTimer);
        currentLogId = updated.log.id;
        fetchAndShowLog(updated.log.id);
        startLogPollingIfActive(updated, updated.log.id);
      } else {
        // Check child tasks
        const tasks = lastRecords.filter(r => r.parentId === recId && r.log && r.log.id);
        if (tasks.length > 0) {
          clearInterval(logTimer);
          fetchCompositeLog(tasks);
          startCompositePollingIfActive(updated || record, recId);
        }
      }
    }, LOG_POLL_INTERVAL);
  }
}

async function fetchAndShowLog(logId) {
  try {
    $logLoading.classList.remove('hidden');
    const r = await fetch(`/api/pipelines/${enc(pipelineId)}/runs/${enc(runId)}/logs/${enc(logId)}`);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    const text = j.data && j.data.content ? j.data.content : (typeof j.data === 'string' ? j.data : JSON.stringify(j.data, null, 2));

    logText = text;
    renderLogWithLineNumbers(text);
    $logLoading.classList.add('hidden');
    $logContent.classList.remove('hidden');
    $logPlaceholder.classList.add('hidden');

    if (autoFollow || $btnFollow.classList.contains('active')) {
      $logPanelBody.scrollTop = $logPanelBody.scrollHeight;
    }

    // Stop log polling if record is now completed
    const record = lastRecords.find(r => r.id === selectedId);
    if (record) {
      const state = (record.state || '').toLowerCase();
      if (state === 'completed' && logTimer) {
        clearInterval(logTimer);
        logTimer = null;
      }
    }
  } catch (err) {
    console.error('fetchAndShowLog error:', err);
    $logLoading.classList.add('hidden');
  }
}

async function fetchCompositeLog(tasks) {
  try {
    $logLoading.classList.remove('hidden');
    const sorted = [...tasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    const parts = await Promise.all(sorted.map(async (t) => {
      try {
        const r = await fetch(`/api/pipelines/${enc(pipelineId)}/runs/${enc(runId)}/logs/${enc(t.log.id)}`);
        if (!r.ok) return `--- ${t.name || t.task || 'Step'} ---\n(Error loading log)\n`;
        const j = await r.json();
        return j.data && j.data.content ? j.data.content : (typeof j.data === 'string' ? j.data : '');
      } catch {
        return `--- ${t.name || t.task || 'Step'} ---\n(Error loading log)\n`;
      }
    }));

    logText = parts.join('');
    renderLogWithLineNumbers(logText);
    $logLoading.classList.add('hidden');
    $logContent.classList.remove('hidden');
    $logPlaceholder.classList.add('hidden');

    if (autoFollow || $btnFollow.classList.contains('active')) {
      $logPanelBody.scrollTop = $logPanelBody.scrollHeight;
    }
  } catch (err) {
    console.error('fetchCompositeLog error:', err);
    $logLoading.classList.add('hidden');
  }
}

// ── Log rendering with line numbers ────────────────────────────────────────
// Azure DevOps timestamp regex: 2026-03-11T00:10:51.0681542Z
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/;

function stripTimestamp(line) {
  return showTimestamps ? line : line.replace(TIMESTAMP_RE, '');
}

function classifyLogLine(line) {
  const lower = line.toLowerCase();
  if (lower.includes('##[section]') || line.startsWith('▶')) return 'log-section';
  if (lower.includes('##[error]') || lower.includes('error:') || lower.includes(' err ') || lower.includes('fatal') || lower.includes('exception')) return 'log-error';
  if (lower.includes('##[warning]') || lower.includes('warning:') || lower.includes(' warn ') || lower.includes('w0311')) return 'log-warning';
  if (lower.includes('[debug]') || lower.includes('##[debug]') || lower.includes('debug:')) return 'log-debug';
  return '';
}

function renderLogWithLineNumbers(text) {
  const lines = text.split('\n');
  const hash = String(lines.length) + '_' + text.length + '_' + (showTimestamps ? 't' : 'f');
  if ($logContent.dataset.hash === hash) return;
  $logContent.dataset.hash = hash;

  const maxDigits = String(lines.length).length;
  const html = lines.map((line, i) => {
    const num = String(i + 1).padStart(maxDigits, ' ');
    const cls = classifyLogLine(line);
    const display = stripTimestamp(line);
    return `<span class="log-line ${cls}"><span class="log-line-num">${num}</span><span class="log-line-text">${esc(display)}</span></span>`;
  }).join('');

  $logContent.innerHTML = html;
}

// ── Toolbar actions ────────────────────────────────────────────────────────
$btnCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logText);
    const orig = $btnCopy.textContent;
    $btnCopy.textContent = '✅ Copied';
    setTimeout(() => { $btnCopy.textContent = orig; }, 1500);
  } catch { alert('Copy failed'); }
});

$btnDownload?.addEventListener('click', () => {
  const blob = new Blob([logText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `run-${runId}-log.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

$btnWrap?.addEventListener('click', () => {
  $logContent.classList.toggle('wrap');
  $btnWrap.classList.toggle('active');
});

$btnFollow?.addEventListener('click', () => {
  autoFollow = !autoFollow;
  $btnFollow.classList.toggle('active', autoFollow);
  if (autoFollow) {
    $logPanelBody.scrollTop = $logPanelBody.scrollHeight;
    if (lastRecords.length) autoSelectJob(lastRecords);
  }
});

$btnTimestamp?.addEventListener('click', () => {
  showTimestamps = !showTimestamps;
  $btnTimestamp.classList.toggle('active', showTimestamps);
  // Force re-render
  $logContent.dataset.hash = '';
  if (logText) renderLogWithLineNumbers(logText);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function enc(v) { return encodeURIComponent(v); }

function esc(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
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

// ── Cleanup ─────────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (logTimer) clearInterval(logTimer);
});
