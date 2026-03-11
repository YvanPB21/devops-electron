require("dotenv").config({ path: "/Users/yvanpb/Downloads/devops/.env" });
const fetch = require("node-fetch");
const { AZDO_ORG, AZDO_PROJECT, AZDO_PAT } = process.env;

const BASE_URL = `https://dev.azure.com/${AZDO_ORG}/${AZDO_PROJECT}`;
const DIST_TASK_URL = `https://dev.azure.com/${AZDO_ORG}/_apis/distributedtask`;
const AUTH_HEADER = "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64");
const HEADERS = { Authorization: AUTH_HEADER, "Content-Type": "application/json" };

async function azdoFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function test() {
  try {
    // 1. Get pools
    const poolsRes = await azdoFetch(`${DIST_TASK_URL}/pools?api-version=7.1-preview.1`);
    console.log(`Found ${poolsRes.value.length} pools`);
    
    // Check first pool for queued jobs
    for (const pool of poolsRes.value) {
      if (!pool.isHosted) { // Usually custom pools have queues
          console.log(`Checking pool ${pool.id} - ${pool.name}...`);
          try {
             const jobsRes = await azdoFetch(`${DIST_TASK_URL}/pools/${pool.id}/jobrequests?api-version=5.0-preview.1`);
             const queued = jobsRes.value.filter(j => !j.receiveTime); // not assigned to agent yet
             if (queued.length > 0) {
                 console.log(`Pool ${pool.name} has ${queued.length} queued jobs.`);
                 console.log(queued[0]);
             }
          } catch(e) { console.error(`Failed to get jobs for pool ${pool.id}`); }
      }
    }
  } catch(e) { console.error(e); }
}
test();
