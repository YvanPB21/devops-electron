require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Validación de variables de entorno ──────────────────────────────────────
const { AZDO_ORG, AZDO_PROJECT, AZDO_PAT } = process.env;
if (!AZDO_ORG || !AZDO_PROJECT || !AZDO_PAT) {
  console.error(
    "ERROR: Faltan variables de entorno. Copia .env.example a .env y rellena AZDO_ORG, AZDO_PROJECT y AZDO_PAT."
  );
  process.exit(1);
}

// ── Configuración Azure DevOps ──────────────────────────────────────────────
const BASE_URL = `https://dev.azure.com/${AZDO_ORG}/${AZDO_PROJECT}`;
const AUTH_HEADER =
  "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64");

const HEADERS = {
  Authorization: AUTH_HEADER,
  "Content-Type": "application/json",
};

// ── Cache en memoria ────────────────────────────────────────────────────────
// Increase default TTL to reduce repeated slow pulls. Can be tuned via env.
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || String(2 * 60 * 1000), 10); // default 2 minutes
let cache = { data: null, timestamp: 0 };

// Concurrency for parallel Azure requests (can be tuned via env var)
const AZDO_CONCURRENCY = parseInt(process.env.AZDO_CONCURRENCY || '20', 10);

// ── Helpers ─────────────────────────────────────────────────────────────────
async function azdoFetch(url) {
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Azure DevOps API respondió ${res.status}: ${res.statusText}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

function computeDuration(createdDate, finishedDate) {
  if (!createdDate) return null;
  const start = new Date(createdDate);
  const end = finishedDate ? new Date(finishedDate) : new Date();
  const diffMs = end - start;
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Obtener pipelines con su último run ─────────────────────────────────────
async function fetchPipelinesWithLatestRun(folderFilter = null) {
  // 1. Listar pipelines
  const pipelinesRes = await azdoFetch(
    `${BASE_URL}/_apis/pipelines?api-version=7.1`
  );
  const pipelines = pipelinesRes.value || [];

  // If a folder filter is provided, normalize and filter the pipelines list early
  let filteredPipelines = pipelines;
  if (folderFilter) {
    const raw = String(folderFilter || "");
    const target = raw.replace(/\//g, "\\").replace(/\\+$/g, "");
    const lowerTarget = target.toLowerCase();
    filteredPipelines = pipelines.filter(p => {
      const folder = (p.folder || "").replace(/\\+$/g, "");
      return folder.toLowerCase().startsWith(lowerTarget);
    });
  }

  // 2. Obtener el último run de cada pipeline en paralelo (con límite)
  const CONCURRENCY = AZDO_CONCURRENCY || 10;
  const results = [];

  for (let i = 0; i < filteredPipelines.length; i += CONCURRENCY) {
    const batch = filteredPipelines.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pipeline) => {
        try {
          const runsRes = await azdoFetch(
            `${BASE_URL}/_apis/pipelines/${pipeline.id}/runs?$top=1&api-version=7.1`
          );
          const latestRun = (runsRes.value || [])[0] || null;

          const webUrl = latestRun
            ? latestRun._links?.web?.href ||
              `${BASE_URL}/_build/results?buildId=${latestRun.id}`
            : `${BASE_URL}/_build?definitionId=${pipeline.id}`;
          return {
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            folder: pipeline.folder || "\\",
            state: latestRun?.state || null,
            result: latestRun?.result || null,
            createdDate: latestRun?.createdDate || null,
            finishedDate: latestRun?.finishedDate || null,
            duration: latestRun
              ? computeDuration(latestRun.createdDate, latestRun.finishedDate)
              : null,
            runId: latestRun?.id || null,
            webUrl,
          };
        } catch (err) {
          // Si falla un pipeline individual, no romper todo
          return {
            pipelineId: pipeline.id,
            pipelineName: pipeline.name,
            folder: pipeline.folder || "\\",
            state: "error",
            result: "error",
            createdDate: null,
            finishedDate: null,
            duration: null,
            runId: null,
            webUrl: `${BASE_URL}/_build?definitionId=${pipeline.id}`,
            error: err.message,
          };
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
}

// Fast basic listing: returns pipelines without querying each latest run.
async function fetchPipelinesBasic(folderFilter = null) {
  const pipelinesRes = await azdoFetch(`${BASE_URL}/_apis/pipelines?api-version=7.1`);
  const pipelines = pipelinesRes.value || [];
  let filtered = pipelines;
  if (folderFilter) {
    const raw = String(folderFilter || "");
    const target = raw.replace(/\//g, "\\").replace(/\\+$/g, "");
    const lowerTarget = target.toLowerCase();
    filtered = pipelines.filter(p => ((p.folder || "").replace(/\\+$/g, "")).toLowerCase().startsWith(lowerTarget));
  }
  return filtered.map(pipeline => ({
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    folder: pipeline.folder || "\\",
    state: null,
    result: null,
    createdDate: null,
    finishedDate: null,
    duration: null,
    runId: null,
    webUrl: `${BASE_URL}/_build?definitionId=${pipeline.id}`
  }));
}

// ── Servir frontend estático ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API Endpoint ────────────────────────────────────────────────────────────
app.get("/api/pipelines", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
      return res.json({ data: cache.data, cached: true });
    }
    // If a folder query param is provided, only fetch pipelines within that folder
    const folder = req.query.folder || null;

    // If caller requested a folder-scoped list, fetch full details (including last run)
    // for that folder synchronously so client gets the last run immediately.
    if (folder) {
      const data = await fetchPipelinesWithLatestRun(folder);
      cache = { data, timestamp: now };
      return res.json({ data, cached: false });
    }

    // Otherwise, if we don't have a cached full dataset yet, return a fast/basic list
    // (no per-pipeline run queries) and kick off a background refresh.
    if (!cache.data) {
      try {
        const basic = await fetchPipelinesBasic(folder);
        // Start full fetch in background to populate cache for subsequent requests
        fetchPipelinesWithLatestRun()
          .then((full) => {
            cache = { data: full, timestamp: Date.now() };
            console.log('Pipelines cache populated (background).');
          })
          .catch((e) => console.error('Background pipelines fetch failed:', e && e.message ? e.message : e));

        return res.json({ data: basic, cached: false, partial: true });
      } catch (e) {
        // If basic listing failed for some reason, fall back to full fetch below
        console.warn('Fast pipelines listing failed, falling back to full fetch:', e && e.message ? e.message : e);
      }
    }

    const data = await fetchPipelinesWithLatestRun();
    cache = { data, timestamp: now };
    return res.json({ data, cached: false });
  } catch (err) {
    console.error("Error en /api/pipelines:", err.message);

    const status = err.status || 500;
    let message = "Error interno del servidor";

    if (status === 401 || status === 403) {
      message =
        "Token inválido o sin permisos suficientes. Verifica AZDO_PAT.";
    } else if (status === 404) {
      message =
        "Proyecto u organización no encontrado. Verifica AZDO_ORG y AZDO_PROJECT.";
    }

    return res.status(status).json({ error: message, detail: err.message });
  }
});

app.get("/api/pipelines/:id/runs", async (req, res) => {
  const id = req.params.id;
  const top = Math.min(parseInt(req.query.top || "50", 10) || 50, 200);
  const skip = Math.max(parseInt(req.query.skip || "0", 10) || 0, 0);
  try {
    const runsRes = await azdoFetch(
      `${BASE_URL}/_apis/pipelines/${encodeURIComponent(id)}/runs?$top=${top}&$skip=${skip}&api-version=7.1`
    );
    const items = (runsRes.value || []).map((run) => ({
      id: run.id,
      state: run.state || null,
      result: run.result || null,
      createdDate: run.createdDate || null,
      finishedDate: run.finishedDate || null,
      webUrl: run._links?.web?.href || null,
      pipelineId: id,
      pipelineVersion: run.pipeline?.version || null,
      sourceBranch: run.sourceReference || run.sourceBranch || null,
    }));

    return res.json({ data: items, cached: false });
  } catch (err) {
    console.error("Error en /api/pipelines/:id/runs:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: "No se pudo obtener runs", detail: err.message });
  }
});

// Queue a new run for a pipeline
app.post('/api/pipelines/:id/runs', express.json(), async (req, res) => {
  const id = req.params.id;
  const { branch, resources, variables } = req.body || {};
  const body = {};
  if (branch) body.resources = { repositories: { self: { refName: branch } } };
  if (resources) body.resources = { ...body.resources, ...resources };
  // Azure DevOps expects runParameters (string) — send JSON-stringified variables or empty object string
  body.runParameters = JSON.stringify(variables || {});
  // optional variables map can also be passed at top level (kept for compatibility)
  if (variables && typeof variables === 'object') body.variables = variables;

  try {
    const url = `${BASE_URL}/_apis/pipelines/${encodeURIComponent(id)}/runs?api-version=7.1`;
    const resAz = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!resAz.ok) {
      const txt = await resAz.text().catch(() => '');
      const err = new Error(`Azure DevOps responded ${resAz.status}`);
      err.status = resAz.status;
      err.body = txt;
      throw err;
    }
    const json = await resAz.json();
    return res.status(201).json({ data: json });
  } catch (err) {
    console.error('Error queueing run:', err.message || err);
    const status = err.status || 500;
    return res.status(status).json({ error: 'No se pudo iniciar el run', detail: err.body || err.message });
  }
});

// Detalle de un run: información + timeline + logs list
app.get('/api/pipelines/:pipelineId/runs/:runId', async (req, res) => {
  const { pipelineId, runId } = req.params;
  try {
    const runDetail = await azdoFetch(`${BASE_URL}/_apis/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}?api-version=7.1`);

    // Try to fetch build timeline and logs (best-effort)
    let timeline = null;
    let logs = null;
    try {
      timeline = await azdoFetch(`${BASE_URL}/_apis/build/builds/${encodeURIComponent(runId)}/timeline?api-version=6.0`);
    } catch (e) {
      // ignore timeline fetch errors
      timeline = null;
    }
    try {
      logs = await azdoFetch(`${BASE_URL}/_apis/build/builds/${encodeURIComponent(runId)}/logs?api-version=6.0`);
    } catch (e) {
      logs = null;
    }

    return res.json({ data: { run: runDetail, timeline, logs }, cached: false });
  } catch (err) {
    console.error('Error en /api/pipelines/:pipelineId/runs/:runId', err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: 'No se pudo obtener detalle del run', detail: err.message });
  }
});

// Obtener contenido de un log específico (best-effort)
app.get('/api/pipelines/:pipelineId/runs/:runId/logs/:logId', async (req, res) => {
  const { runId, logId } = req.params;
  try {
    // Fetch raw text because Azure may return plain text logs (not JSON)
    const url = `${BASE_URL}/_apis/build/builds/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logId)}?api-version=6.0`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      const err = new Error(`Azure DevOps responded ${r.status}`);
      err.status = r.status;
      err.body = txt;
      throw err;
    }
    const text = await r.text();
    return res.json({ data: { content: text } });
  } catch (err) {
    console.error('Error obteniendo log:', err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: 'No se pudo obtener log', detail: err.message });
  }
});

// ── Health check ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Iniciar servidor ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Dashboard corriendo en http://localhost:${PORT}`);
  console.log(`   Org: ${AZDO_ORG} | Proyecto: ${AZDO_PROJECT}`);
});

// Pre-warm pipelines cache asynchronously on startup to reduce first-request latency
(async () => {
  try {
    console.log('Pre-warming pipelines cache...');
    const data = await fetchPipelinesWithLatestRun();
    cache = { data, timestamp: Date.now() };
    console.log(`Pipelines cache pre-warmed (${data.length} items)`);
  } catch (e) {
    console.error('Pre-warm failed:', e && e.message ? e.message : e);
  }
})();

