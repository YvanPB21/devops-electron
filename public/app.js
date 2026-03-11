// ── Config ───────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 30_000; // 30 segundos

// ── Default branch per environment ──────────────────────────────────────────
const ENV_BRANCH_MAP = { dev: 'master', uat: 'main', stg: 'master' };

function getDefaultBranch(pipelineName) {
  const hay = (pipelineName || '').toLowerCase();
  const m = hay.match(/(dev|uat|stg)/);
  return m ? (ENV_BRANCH_MAP[m[1]] || 'master') : 'master';
}
let refreshTimer = null;

// ── DOM refs ────────────────────────────────────────────────────────────────
const $body = document.getElementById("pipeline-body");
const $loading = document.getElementById("loading");
const $tableContainer = document.getElementById("table-container");
const $errorBanner = document.getElementById("error-banner");
const $btnRefresh = document.getElementById("btn-refresh");
const $autoRefresh = document.getElementById("auto-refresh");
const $lastUpdate = document.getElementById("last-update");
const $orgProject = document.getElementById("org-project");
const $summary = document.getElementById("summary");
const $groupBy = document.getElementById("group-by");
const $btnSettings = document.getElementById('btn-settings');
const $selectAll = document.getElementById('select-all');
const $bulkBar = document.getElementById('bulk-action-bar');
const $bulkCount = document.getElementById('bulk-count');
const $btnBulkRun = document.getElementById('btn-bulk-run');
const $btnBulkClear = document.getElementById('btn-bulk-clear');
let pipelinesCache = [];
// Track which groups are expanded (store decoded group keys)
const expandedGroups = new Set();
const $folderFilter = document.getElementById("folder-filter");
const $folderPath = document.getElementById("folder-path");

// ── Selection state ─────────────────────────────────────────────────────────
const selectedPipelines = new Map(); // pipelineId -> {pipelineId, pipelineName}

function updateBulkBar() {
  const count = selectedPipelines.size;
  $bulkCount.textContent = count;
  if (count > 0) {
    $bulkBar.classList.add('visible');
  } else {
    $bulkBar.classList.remove('visible');
  }
}

function togglePipelineSelection(id, name, checked) {
  if (checked) {
    selectedPipelines.set(id, { pipelineId: id, pipelineName: name });
  } else {
    selectedPipelines.delete(id);
  }
  updateBulkBar();
  updateSelectAllState();
}

function updateSelectAllState() {
  const allCheckboxes = document.querySelectorAll('.pipeline-row-checkbox');
  if (allCheckboxes.length === 0) return;
  const allChecked = [...allCheckboxes].every(cb => cb.checked);
  const someChecked = [...allCheckboxes].some(cb => cb.checked);
  $selectAll.checked = allChecked;
  $selectAll.indeterminate = someChecked && !allChecked;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const RESULT_CONFIG = {
  succeeded: { icon: "✅", label: "Succeeded", cssClass: "badge-succeeded" },
  failed: { icon: "❌", label: "Failed", cssClass: "badge-failed" },
  canceled: { icon: "⛔", label: "Canceled", cssClass: "badge-canceled" },
  partiallysucceeded: {
    icon: "⚠️",
    label: "Partial",
    cssClass: "badge-partiallysucceeded",
  },
  error: { icon: "💥", label: "Error", cssClass: "badge-error" },
};

const STATE_CONFIG = {
  completed: { icon: "●", label: "Completed", cssClass: "badge-succeeded" },
  inprogress: {
    icon: "",
    label: "In Progress",
    cssClass: "badge-inprogress",
  },
  cancelling: { icon: "⏳", label: "Cancelling", cssClass: "badge-canceled" },
  notstarted: { icon: "🕒", label: "Queued", cssClass: "badge-queued" },
  queued: { icon: "🕒", label: "Queued", cssClass: "badge-queued" },
  error: { icon: "💥", label: "Error", cssClass: "badge-error" },
};

function makeBadge(value, configMap, extraText = '') {
  if (!value) return '<span class="badge badge-unknown">— Sin runs</span>';
  const key = value.toLowerCase().replace(/\s/g, "");
  const cfg = configMap[key] || {
    icon: "?",
    label: value,
    cssClass: "badge-unknown",
  };
  const dispLabel = extraText ? `${cfg.label} ${extraText}` : cfg.label;
  return `<span class="badge ${cfg.cssClass}">${cfg.icon} ${dispLabel}</span>`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Fetch & Render ──────────────────────────────────────────────────────────
async function fetchPipelines() {
  $btnRefresh.disabled = true;
  $errorBanner.classList.add("hidden");

  try {
    let url = "/api/pipelines";
    if ($folderFilter && $folderFilter.checked) {
      const raw = ($folderPath && $folderPath.value) || "";
      url += `?folder=${encodeURIComponent(raw)}`;
    }
    const res = await fetch(url);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const json = await res.json();
    pipelinesCache = json.data || [];
    renderTable(pipelinesCache);
    renderSummary(pipelinesCache, json.cached);

    $loading.classList.add("hidden");
    $tableContainer.classList.remove("hidden");
    $lastUpdate.textContent = `Actualizado: ${new Date().toLocaleTimeString(
      "es-ES"
    )}${json.cached ? " (cache)" : ""}`;
  } catch (err) {
    $errorBanner.textContent = `Error: ${err.message}`;
    $errorBanner.classList.remove("hidden");
    console.error("fetchPipelines error:", err);
  } finally {
    $btnRefresh.disabled = false;
  }
}

// Open settings window (Electron) when user clicks settings button
if ($btnSettings) {
  $btnSettings.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.openSettings) {
      window.electronAPI.openSettings();
    } else {
      window.location.href = '/public/settings.html';
    }
  });
}

function makePipelineRow(p, extraClass = '') {
  const isChecked = selectedPipelines.has(p.pipelineId);
  const queuePosStr = p.queuePosition != null ? `(Pos: ${p.queuePosition})` : '';
  return `
    <tr class="${extraClass}">
      <td class="text-center"><input type="checkbox" class="pipeline-checkbox pipeline-row-checkbox" data-pipeline-id="${p.pipelineId}" data-pipeline-name="${escapeHtml(p.pipelineName)}" ${isChecked ? 'checked' : ''} /></td>
      <td class="pipeline-name"><a class="pipeline-link" href="pipeline.html?id=${encodeURIComponent(
    p.pipelineId
  )}&name=${encodeURIComponent(p.pipelineName)}">${escapeHtml(p.pipelineName)}</a></td>
      <td>${makeBadge(p.state, STATE_CONFIG, queuePosStr)}</td>
      <td>${makeBadge(p.result, RESULT_CONFIG)}</td>
      <td>${formatDate(p.createdDate)}</td>
      <td>${p.duration || "—"}</td>
      <td>
        ${p.runId ? `<a class="run-link" href="${escapeHtml(p.webUrl)}" target="_blank" rel="noopener">#${p.runId} ↗</a>` : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      <td class="folder-path">${escapeHtml(p.folder)}</td>
    </tr>`;
}

function renderTable(pipelines) {
  if (!pipelines || pipelines.length === 0) {
    $body.innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px">No se encontraron pipelines</td></tr>';
    return;
  }

  // Ordenar: failed primero, luego inProgress, luego el resto
  const order = { failed: 0, inprogress: 1, partiallysucceeded: 2 };
  // Apply folder filter if enabled
  let filtered = pipelines;
  if ($folderFilter && $folderFilter.checked) {
    const raw = ($folderPath && $folderPath.value) || "";
    const target = raw.replace(/\//g, "\\").replace(/\\+$/g, "");
    const lowerTarget = target.toLowerCase();
    filtered = pipelines.filter((p) => {
      const folder = (p.folder || "").replace(/\\+$/g, "");
      return folder.toLowerCase().startsWith(lowerTarget);
    });
  }

  const sorted = [...filtered].sort((a, b) => {
    const ra = order[(a.result || "").toLowerCase()] ?? 99;
    const rb = order[(b.result || "").toLowerCase()] ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.pipelineName || "").localeCompare(b.pipelineName || "");
  });

  const groupMode = $groupBy ? $groupBy.value : "none";

  if (groupMode === "none") {
    $body.innerHTML = sorted.map(p => makePipelineRow(p)).join("");
    wireCheckboxes();
    return;
  }

  // Build groups
  const groups = {};
  if (groupMode === "project") {
    sorted.forEach((p) => {
      const folder = p.folder || "";
      const key = folder.split("/")[0] || "(root)";
      (groups[key] ||= []).push(p);
    });
  } else if (groupMode === "environment") {
    const envRegex = /(dev|uat|stg)/i;
    sorted.forEach((p) => {
      const hay = `${p.folder || ""} ${p.pipelineName || ""}`;
      const m = hay.match(envRegex);
      const key = m ? m[1].toLowerCase() : "other";
      (groups[key] ||= []).push(p);
    });
  }

  const groupOrder = Object.keys(groups).sort();
  $body.innerHTML = groupOrder
    .map((g, gi) => {
      const rows = groups[g].map(p => makePipelineRow(p, `group-row group-${gi}`)).join("");

      // Check if all pipelines in this group are selected
      const allSelected = groups[g].every(p => selectedPipelines.has(p.pipelineId));
      const someSelected = groups[g].some(p => selectedPipelines.has(p.pipelineId));

      return `
    <tr class="group-header" data-group-index="${gi}" data-group-key="${encodeURIComponent(g)}">
      <td colspan="8"><input type="checkbox" class="group-checkbox" data-group-index="${gi}" ${allSelected ? 'checked' : ''} ${someSelected && !allSelected ? 'data-indeterminate="true"' : ''} /><span class="caret">▶</span><span class="group-title"> ${escapeHtml(
        g
      )} — ${groups[g].length} pipelines</span></td>
    </tr>
    ${rows}`;
    })
    .join("");

  // Set indeterminate state (can't be done via HTML attribute)
  document.querySelectorAll('.group-checkbox[data-indeterminate="true"]').forEach(cb => {
    cb.indeterminate = true;
  });

  // Attach click handlers for collapsing/expanding and restore previous state
  document.querySelectorAll(".group-header").forEach((hdr) => {
    hdr.style.cursor = "pointer";
    const idx = hdr.getAttribute("data-group-index");
    const rawKey = hdr.getAttribute("data-group-key") || "";
    const key = decodeURIComponent(rawKey);
    const members = document.querySelectorAll(`.group-${idx}`);
    const isExpanded = expandedGroups.has(key);
    members.forEach((r) => (r.style.display = isExpanded ? "" : "none"));
    const caret = hdr.querySelector(".caret");
    if (caret) caret.textContent = isExpanded ? "▾" : "▶";

    hdr.addEventListener("click", (e) => {
      // Don't toggle when clicking the checkbox
      if (e.target.classList.contains('group-checkbox')) return;

      const nowExpanded = !expandedGroups.has(key);
      if (nowExpanded) expandedGroups.add(key);
      else expandedGroups.delete(key);
      members.forEach((r) => (r.style.display = nowExpanded ? "" : "none"));
      const c = hdr.querySelector(".caret");
      if (c) c.textContent = nowExpanded ? "▾" : "▶";
    });
  });

  // Wire group checkbox handlers
  document.querySelectorAll('.group-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger group expand/collapse
    });
    cb.addEventListener('change', (e) => {
      const gi = cb.getAttribute('data-group-index');
      const memberCheckboxes = document.querySelectorAll(`.group-${gi} .pipeline-row-checkbox`);
      memberCheckboxes.forEach(mcb => {
        mcb.checked = cb.checked;
        togglePipelineSelection(
          mcb.getAttribute('data-pipeline-id'),
          mcb.getAttribute('data-pipeline-name'),
          cb.checked
        );
      });
    });
  });

  wireCheckboxes();
}

function wireCheckboxes() {
  // Wire individual pipeline checkboxes
  document.querySelectorAll('.pipeline-row-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      togglePipelineSelection(
        cb.getAttribute('data-pipeline-id'),
        cb.getAttribute('data-pipeline-name'),
        cb.checked
      );
      // Update parent group checkbox if in grouped mode
      updateGroupCheckboxState(cb);
    });
    // Prevent row click propagation
    cb.addEventListener('click', (e) => e.stopPropagation());
  });

  updateSelectAllState();
  updateBulkBar();
}

function updateGroupCheckboxState(triggerCb) {
  // Find which group this checkbox belongs to
  const row = triggerCb.closest('tr');
  if (!row) return;
  const groupClass = [...row.classList].find(c => c.startsWith('group-') && c !== 'group-row' && c !== 'group-header');
  if (!groupClass) return;
  const gi = groupClass.replace('group-', '');
  const groupCb = document.querySelector(`.group-checkbox[data-group-index="${gi}"]`);
  if (!groupCb) return;

  const memberCheckboxes = document.querySelectorAll(`.${groupClass} .pipeline-row-checkbox`);
  const allChecked = [...memberCheckboxes].every(c => c.checked);
  const someChecked = [...memberCheckboxes].some(c => c.checked);
  groupCb.checked = allChecked;
  groupCb.indeterminate = someChecked && !allChecked;
}

function renderSummary(pipelines) {
  if (!pipelines) return;
  const counts = {};
  pipelines.forEach((p) => {
    const key = (p.result || "none").toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  });

  const colors = {
    succeeded: "var(--green)",
    failed: "var(--red)",
    canceled: "var(--gray)",
    partiallysucceeded: "var(--yellow)",
    none: "var(--text-muted)",
    error: "var(--red)",
  };

  $summary.innerHTML = Object.entries(counts)
    .map(
      ([key, count]) =>
        `<span class="summary-item">
          <span class="summary-dot" style="background:${colors[key] || "var(--gray)"
        }"></span>
          ${key === "none" ? "Sin runs" : key}: ${count}
        </span>`
    )
    .join("");
}

// ── Bulk Run ────────────────────────────────────────────────────────────────
async function bulkRunPipelines() {
  const pipelines = [...selectedPipelines.values()];
  if (pipelines.length === 0) return;

  $btnBulkRun.disabled = true;
  $btnBulkRun.textContent = '⏳ Running...';

  const results = await Promise.allSettled(
    pipelines.map(async (p) => {
      const branch = getDefaultBranch(p.pipelineName);
      const res = await fetch(`/api/pipelines/${encodeURIComponent(p.pipelineId)}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || `HTTP ${res.status}`);
      }
      return { pipelineId: p.pipelineId, pipelineName: p.pipelineName };
    })
  );

  // Show results toast
  showBulkResultToast(pipelines, results);

  // Reset
  $btnBulkRun.disabled = false;
  $btnBulkRun.textContent = '🚀 Run Selected';
  selectedPipelines.clear();
  // Uncheck all
  document.querySelectorAll('.pipeline-row-checkbox, .group-checkbox, #select-all').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  updateBulkBar();

  // Refresh to show new runs
  setTimeout(fetchPipelines, 2000);
}

function showBulkResultToast(pipelines, results) {
  // Remove existing toast
  const existing = document.querySelector('.bulk-result-toast');
  if (existing) existing.remove();

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  const items = results.map((r, i) => {
    const p = pipelines[i];
    if (r.status === 'fulfilled') {
      return `<div class="toast-item success">✅ ${escapeHtml(p.pipelineName)}</div>`;
    } else {
      return `<div class="toast-item error">❌ ${escapeHtml(p.pipelineName)} — ${escapeHtml(r.reason?.message || 'Error')}</div>`;
    }
  }).join('');

  const toast = document.createElement('div');
  toast.className = 'bulk-result-toast';
  toast.innerHTML = `
    <div class="toast-header">
      <span>${succeeded} ok, ${failed} errores</span>
      <button class="toast-close" onclick="this.closest('.bulk-result-toast').remove()">✕</button>
    </div>
    ${items}
  `;
  document.body.appendChild(toast);

  // Auto-remove after 10 seconds
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 10000);
}

// ── Bulk bar event handlers ─────────────────────────────────────────────────
$btnBulkRun.addEventListener('click', bulkRunPipelines);

$btnBulkClear.addEventListener('click', () => {
  selectedPipelines.clear();
  document.querySelectorAll('.pipeline-row-checkbox, .group-checkbox, #select-all').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  updateBulkBar();
});

$selectAll.addEventListener('change', () => {
  const allCheckboxes = document.querySelectorAll('.pipeline-row-checkbox');
  allCheckboxes.forEach(cb => {
    cb.checked = $selectAll.checked;
    togglePipelineSelection(
      cb.getAttribute('data-pipeline-id'),
      cb.getAttribute('data-pipeline-name'),
      $selectAll.checked
    );
  });
  // Also update group checkboxes
  document.querySelectorAll('.group-checkbox').forEach(gcb => {
    gcb.checked = $selectAll.checked;
    gcb.indeterminate = false;
  });
});

// ── Auto-refresh ────────────────────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(fetchPipelines, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

$autoRefresh.addEventListener("change", () => {
  if ($autoRefresh.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

$btnRefresh.addEventListener("click", fetchPipelines);

if ($groupBy) {
  $groupBy.addEventListener("change", () => {
    expandedGroups.clear();
    renderTable(pipelinesCache);
  });
}

if ($folderFilter) {
  $folderFilter.addEventListener("change", () => renderTable(pipelinesCache));
}
if ($folderPath) {
  $folderPath.addEventListener("input", () => {
    if ($folderFilter && $folderFilter.checked) renderTable(pipelinesCache);
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
$orgProject.textContent = "devopsibk / dopjeu2c001bcvpv01";
fetchPipelines();
startAutoRefresh();
