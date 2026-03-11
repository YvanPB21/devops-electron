require("dotenv").config();
const fetch = require("node-fetch");
const { AZDO_ORG, AZDO_PROJECT, AZDO_PAT } = process.env;

const BASE_URL = `https://dev.azure.com/${AZDO_ORG}/${AZDO_PROJECT}`;
const AUTH_HEADER = "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64");
const HEADERS = { Authorization: AUTH_HEADER, "Content-Type": "application/json" };

async function azdoFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function test() {
  try {
    // try to fetch a recent build to see its shape
    const url = `${BASE_URL}/_apis/build/builds?$top=5&api-version=6.0`;
    console.log("Fetching", url);
    const builds = await azdoFetch(url);
    console.log("Found", builds.value.length, "builds");
    if (builds.value.length > 0) {
      const b = builds.value[0];
      console.log("first build status:", b.status, "result:", b.result, "queuePosition:", b.queuePosition);
      // Let's also find all queued
      const queued = builds.value.filter(x => x.status === 'notStarted' || x.status === 'postponed' || x.queuePosition != null);
      if (queued.length > 0) {
        console.log("Queued/waiting builds:", queued.map(q => ({id: q.id, status: q.status, pos: q.queuePosition})));
      } else {
        console.log("No queued builds found in top 5.");
      }
    }
  } catch(e) { console.error(e); }
}
test();
