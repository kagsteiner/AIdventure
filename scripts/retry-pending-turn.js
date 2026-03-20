/**
 * Ask the running web server to retry a persisted pending turn.
 *
 * Defaults:
 * - URL: http://127.0.0.1:${WEB_PORT || 3006}
 * - token: AIDVENTURE_ADMIN_TOKEN, or WEB_PASSWORD
 *
 * If WEB_PASSWORD is unset, the server only accepts loopback requests.
 */

import dotenv from "dotenv";

dotenv.config();

const port = parseInt(process.env.WEB_PORT, 10) || 3006;
const baseUrl = (process.env.AIDVENTURE_SERVER_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const adminToken = process.env.AIDVENTURE_ADMIN_TOKEN || process.env.WEB_PASSWORD || "";
const pollMs = parseInt(process.env.AIDVENTURE_RECOVERY_POLL_MS, 10) || 2000;
const timeoutMs = parseInt(process.env.AIDVENTURE_RECOVERY_TIMEOUT_MS, 10) || 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders() {
  const headers = { Accept: "application/json" };
  if (adminToken) headers["x-admin-token"] = adminToken;
  return headers;
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers || {}),
    },
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Unexpected response from server: ${raw || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Server returned ${response.status}`);
  }

  return data;
}

async function getStatus() {
  return fetchJSON(`${baseUrl}/api/admin/pending-turn`);
}

async function triggerRecovery() {
  return fetchJSON(`${baseUrl}/api/admin/retry-pending-turn`, {
    method: "POST",
  });
}

function printStatus(label, status) {
  const pending = status.pending_turn;
  const last = status.last_recovery;

  console.log(`\n${label}`);
  console.log(`  running: ${status.running ? "yes" : "no"}`);
  console.log(`  pending: ${pending ? "yes" : "no"}`);
  if (pending?.submitted_at) console.log(`  submitted: ${pending.submitted_at}`);
  if (pending?.action) console.log(`  action: ${pending.action}`);
  if (last?.state && last.state !== "idle") {
    console.log(`  last recovery: ${last.state}`);
    if (last.started_at) console.log(`  started: ${last.started_at}`);
    if (last.finished_at) console.log(`  finished: ${last.finished_at}`);
    if (last.error) console.log(`  error: ${last.error}`);
  }
}

async function main() {
  console.log(`Contacting ${baseUrl} ...`);

  const initialStatus = await getStatus();
  printStatus("Current status", initialStatus);

  const trigger = await triggerRecovery();
  if (trigger.reason === "no_pending_turn") {
    console.log("\nNo pending turn was found. Nothing to retry.");
    return;
  }

  if (trigger.reason === "already_running") {
    console.log("\nA retry is already running. Monitoring progress...");
  } else {
    console.log("\nRetry started. Monitoring progress...");
  }

  const deadline = Date.now() + timeoutMs;
  let previousSignature = "";

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const status = await getStatus();
    const signature = JSON.stringify({
      running: status.running,
      pending: status.pending_turn,
      last: status.last_recovery,
    });

    if (signature !== previousSignature) {
      printStatus("Updated status", status);
      previousSignature = signature;
    }

    if (!status.running) {
      if (status.last_recovery?.state === "succeeded" && !status.pending_turn) {
        console.log("\nPending turn recovery finished successfully.");
        return;
      }

      if (status.last_recovery?.state === "failed") {
        throw new Error(status.last_recovery.error || "Pending turn recovery failed.");
      }

      if (!status.pending_turn) {
        console.log("\nNo pending turn remains.");
        return;
      }
    }
  }

  throw new Error("Timed out while waiting for the server to finish recovery.");
}

main().catch((err) => {
  console.error(`\nRecovery failed: ${err.message}`);
  process.exitCode = 1;
});
