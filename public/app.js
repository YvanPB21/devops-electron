// ── Config ───────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 30_000; // 30 segundos
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
let pipelinesCache = [];
// Track which groups are expanded (store decoded group keys)
const expandedGroups = new Set();
const $folderFilter = document.getElementById("folder-filter");
const $folderPath = document.getElementById("folder-path");

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
  notstarted: {
    icon: "○",
    label: "Not Started",
    cssClass: "badge-notstarted",
  },
  error: { icon: "💥", label: "Error", cssClass: "badge-error" },
};

function makeBadge(value, configMap) {
  if (!value) return '<span class="badge badge-unknown">— Sin runs</span>';
  const key = value.toLowerCase().replace(/\s/g, "");
  const cfg = configMap[key] || {
    icon: "?",
    label: value,
    cssClass: "badge-unknown",
  };
  return `<span class="badge ${cfg.cssClass}">${cfg.icon} ${cfg.label}</span>`;
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
    // include folder query when folder filter is enabled so server can return
    // last-run data only for that folder (reduces overall latency)
    let url = "/api/pipelines";
    if ($folderFilter && $folderFilter.checked) {
      const raw = ($folderPath && $folderPath.value) || "";
      // keep user's backslashes; encodeURIComponent will handle them
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

function renderTable(pipelines) {
  if (!pipelines || pipelines.length === 0) {
    $body.innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">No se encontraron pipelines</td></tr>';
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
    $body.innerHTML = sorted
      .map(
        (p) => `
    <tr>
      <td class="pipeline-name"><a class="pipeline-link" href="pipeline.html?id=${encodeURIComponent(
        p.pipelineId
      )}&name=${encodeURIComponent(p.pipelineName)}">${escapeHtml(p.pipelineName)}</a></td>
      <td>${makeBadge(p.state, STATE_CONFIG)}</td>
      <td>${makeBadge(p.result, RESULT_CONFIG)}</td>
      <td>${formatDate(p.createdDate)}</td>
      <td>${p.duration || "—"}</td>
      <td>
        ${p.runId ? `<a class="run-link" href="${escapeHtml(p.webUrl)}" target="_blank" rel="noopener">#${p.runId} ↗</a>` : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      <td class="folder-path">${escapeHtml(p.folder)}</td>
    </tr>`
      )
      .join("");
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
      const rows = groups[g]
        .map(
          (p) => `
    <tr class="group-row group-${gi}">
      <td class="pipeline-name"><a class="pipeline-link" href="pipeline.html?id=${encodeURIComponent(
        p.pipelineId
      )}&name=${encodeURIComponent(p.pipelineName)}">${escapeHtml(p.pipelineName)}</a></td>
      <td>${makeBadge(p.state, STATE_CONFIG)}</td>
      <td>${makeBadge(p.result, RESULT_CONFIG)}</td>
      <td>${formatDate(p.createdDate)}</td>
      <td>${p.duration || "—"}</td>
      <td>${p.runId ? `<a class="run-link" href="${escapeHtml(p.webUrl)}" target="_blank" rel="noopener">#${p.runId} ↗</a>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="folder-path">${escapeHtml(p.folder)}</td>
    </tr>`
        )
        .join("");

      return `
    <tr class="group-header" data-group-index="${gi}" data-group-key="${encodeURIComponent(
        g
      )}">
      <td colspan="7"><span class="caret">▶</span><span class="group-title"> ${escapeHtml(
        g
      )} — ${groups[g].length} pipelines</span></td>
    </tr>
    ${rows}`;
    })
    .join("");
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

    hdr.addEventListener("click", () => {
      const nowExpanded = !expandedGroups.has(key);
      if (nowExpanded) expandedGroups.add(key);
      else expandedGroups.delete(key);
      members.forEach((r) => (r.style.display = nowExpanded ? "" : "none"));
      const c = hdr.querySelector(".caret");
      if (c) c.textContent = nowExpanded ? "▾" : "▶";
    });
  });
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
          <span class="summary-dot" style="background:${
            colors[key] || "var(--gray)"
          }"></span>
          ${key === "none" ? "Sin runs" : key}: ${count}
        </span>`
    )
    .join("");
}

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
    // changing grouping resets known expanded groups
    expandedGroups.clear();
    renderTable(pipelinesCache);
  });
}

if ($folderFilter) {
  $folderFilter.addEventListener("change", () => renderTable(pipelinesCache));
}
if ($folderPath) {
  $folderPath.addEventListener("input", () => {
    // live update while editing
    if ($folderFilter && $folderFilter.checked) renderTable(pipelinesCache);
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
$orgProject.textContent = "devopsibk / dopjeu2c001bcvpv01";
fetchPipelines();
startAutoRefresh();


