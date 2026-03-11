require("dotenv").config();
const fetch = require("node-fetch");
const { AZDO_ORG, AZDO_PROJECT, AZDO_PAT } = process.env;

const DIST_TASK_URL = `https://dev.azure.com/${AZDO_ORG}/_apis/distributedtask`;
const BASE_URL = `https://dev.azure.com/${AZDO_ORG}/${AZDO_PROJECT}`;
const AUTH = "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64");
const H = { Authorization: AUTH, "Content-Type": "application/json" };

async function f(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.json();
}

(async () => {
  // Test with the requestId the user mentioned
  console.log("=== User's requestId 1343089 ===");
  const req1 = await f(`${DIST_TASK_URL}/pools/9/jobrequests/1343089?includeStatus=true&api-version=5.0-preview.1`);
  // Print all scalar fields
  for (const k of Object.keys(req1)) {
    const v = req1[k];
    if (typeof v !== "object" || v === null) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log("  statusMessage:", req1.statusMessage);
  console.log("  status:", req1.status);
  
  // Also test with our known requestId 1342946
  console.log("\n=== Our job's requestId 1342946 ===");
  const req2 = await f(`${DIST_TASK_URL}/pools/9/jobrequests/1342946?includeStatus=true&api-version=5.0-preview.1`);
  for (const k of Object.keys(req2)) {
    const v = req2[k];
    if (typeof v !== "object" || v === null) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log("  statusMessage:", req2.statusMessage);
  console.log("  status:", req2.status);
})().catch(e => console.error("ERROR:", e.message));
