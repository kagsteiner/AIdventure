/**
 * Pending-turn recovery helpers.
 *
 * Lets the server retry a turn that was already persisted to disk but lost
 * its in-memory worker after a restart or crash.
 */

import {
  appendLog,
  appendStory,
  applyStateChanges,
  clearPendingTurn,
  loadPendingTurn,
  saveLastTurn,
} from "./state_manager.js";
import { processTurn } from "./game_master.js";

let activeRecovery = null;
let lastRecovery = {
  state: "idle",
  started_at: null,
  finished_at: null,
  action: null,
  submitted_at: null,
  error: null,
};

async function performRecovery(pendingTurn) {
  try {
    const result = await processTurn(pendingTurn.action);

    if (Object.keys(result.state_changes || {}).length > 0) {
      await applyStateChanges(result.state_changes);
    }

    await appendLog(result.narrative);
    await appendStory(`> *${pendingTurn.action}*\n\n${result.narrative}`);
    await saveLastTurn({
      narrative: result.narrative,
      asciiArt: result.ascii_art || null,
      choices: result.choices || [],
      audio: null,
    });
    await clearPendingTurn();

    lastRecovery = {
      state: "succeeded",
      started_at: lastRecovery.started_at,
      finished_at: new Date().toISOString(),
      action: pendingTurn.action,
      submitted_at: pendingTurn.submitted_at || null,
      error: null,
    };
  } catch (err) {
    lastRecovery = {
      state: "failed",
      started_at: lastRecovery.started_at,
      finished_at: new Date().toISOString(),
      action: pendingTurn.action,
      submitted_at: pendingTurn.submitted_at || null,
      error: err.message,
    };
    throw err;
  } finally {
    activeRecovery = null;
  }
}

export async function getPendingTurnRecoveryStatus() {
  const pendingTurn = await loadPendingTurn();
  return {
    running: Boolean(activeRecovery),
    pending_turn: pendingTurn
      ? {
          action: pendingTurn.action,
          submitted_at: pendingTurn.submitted_at || null,
        }
      : null,
    last_recovery: { ...lastRecovery },
  };
}

export async function startPendingTurnRecovery() {
  const pendingTurn = await loadPendingTurn();
  if (!pendingTurn) {
    return {
      started: false,
      reason: "no_pending_turn",
      status: await getPendingTurnRecoveryStatus(),
    };
  }

  if (activeRecovery) {
    return {
      started: false,
      reason: "already_running",
      status: await getPendingTurnRecoveryStatus(),
    };
  }

  lastRecovery = {
    state: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    action: pendingTurn.action,
    submitted_at: pendingTurn.submitted_at || null,
    error: null,
  };

  activeRecovery = performRecovery(pendingTurn);
  activeRecovery.catch(() => {});

  return {
    started: true,
    reason: "started",
    status: await getPendingTurnRecoveryStatus(),
  };
}
