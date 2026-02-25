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
const CACHE_TTL_MS = 30 * 1000; // 30 segundos
let cache = { data: null, timestamp: 0 };

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
async function fetchPipelinesWithLatestRun() {
  // 1. Listar pipelines
  const pipelinesRes = await azdoFetch(
    `${BASE_URL}/_apis/pipelines?api-version=7.1`
  );
  const pipelines = pipelinesRes.value || [];

  // 2. Obtener el último run de cada pipeline en paralelo (con límite)
  const CONCURRENCY = 10;
  const results = [];

  for (let i = 0; i < pipelines.length; i += CONCURRENCY) {
    const batch = pipelines.slice(i, i + CONCURRENCY);
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

// ── Servir frontend estático ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API Endpoint ────────────────────────────────────────────────────────────
app.get("/api/pipelines", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
      return res.json({ data: cache.data, cached: true });
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

