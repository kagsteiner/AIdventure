/**
 * State Manager
 *
 * Handles all file I/O for the game's persistent world.
 * Every piece of game data lives under ./game/ as plain
 * JSON or Markdown files — easy to inspect and debug.
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const GAME_DIR = path.resolve("game");

const PATHS = {
  world: path.join(GAME_DIR, "world.md"),
  characters: path.join(GAME_DIR, "characters.json"),
  state: path.join(GAME_DIR, "state.json"),
  log: path.join(GAME_DIR, "log.md"),
  summary: path.join(GAME_DIR, "summary.md"),
  story: path.join(GAME_DIR, "story.md"),
  lastScene: path.join(GAME_DIR, "last_scene.json"),
  lastTurn: path.join(GAME_DIR, "last_turn.json"),
  pendingTurn: path.join(GAME_DIR, "pending_turn.json"),
  ttsCacheDir: path.join(GAME_DIR, "tts_cache"),
};

async function ensureGameDir() {
  if (!existsSync(GAME_DIR)) {
    await fs.mkdir(GAME_DIR, { recursive: true });
  }
}

// --- World ---

export async function saveWorld(markdown) {
  await ensureGameDir();
  await fs.writeFile(PATHS.world, markdown, "utf-8");
}

export async function loadWorld() {
  if (!existsSync(PATHS.world)) return null;
  return fs.readFile(PATHS.world, "utf-8");
}

// --- Characters ---

export async function saveCharacters(characters) {
  await ensureGameDir();
  await fs.writeFile(PATHS.characters, JSON.stringify(characters, null, 2), "utf-8");
}

export async function loadCharacters() {
  if (!existsSync(PATHS.characters)) return null;
  const raw = await fs.readFile(PATHS.characters, "utf-8");
  return JSON.parse(raw);
}

// --- Game State ---

export async function saveState(state) {
  await ensureGameDir();
  await fs.writeFile(PATHS.state, JSON.stringify(state, null, 2), "utf-8");
}

export async function loadState() {
  if (!existsSync(PATHS.state)) return null;
  const raw = await fs.readFile(PATHS.state, "utf-8");
  return JSON.parse(raw);
}

/**
 * Merge partial state updates into the current state.
 * Handles nested objects (inventory arrays are replaced, not merged).
 */
export async function applyStateChanges(changes) {
  const current = (await loadState()) || {};
  const merged = { ...current, ...changes };
  await saveState(merged);
  return merged;
}

// --- Narrative Log ---

export async function appendLog(narrative) {
  await ensureGameDir();
  const separator = existsSync(PATHS.log) ? "\n\n---\n\n" : "";
  await fs.appendFile(PATHS.log, separator + narrative, "utf-8");
}

export async function loadLog() {
  if (!existsSync(PATHS.log)) return "";
  return fs.readFile(PATHS.log, "utf-8");
}

// --- Story (readable transcript of the full adventure) ---

export async function appendStory(text) {
  await ensureGameDir();
  const separator = existsSync(PATHS.story) ? "\n\n" : "";
  await fs.appendFile(PATHS.story, separator + text, "utf-8");
}

// --- Summary ---

export async function saveSummary(markdown) {
  await ensureGameDir();
  await fs.writeFile(PATHS.summary, markdown, "utf-8");
}

export async function loadSummary() {
  if (!existsSync(PATHS.summary)) return "";
  return fs.readFile(PATHS.summary, "utf-8");
}

// --- Last replayable turn ---

export async function saveLastTurn(turn) {
  await ensureGameDir();
  await fs.writeFile(PATHS.lastTurn, JSON.stringify(turn, null, 2), "utf-8");
}

export async function loadLastTurn() {
  if (existsSync(PATHS.lastTurn)) {
    const raw = await fs.readFile(PATHS.lastTurn, "utf-8");
    return JSON.parse(raw);
  }
  if (!existsSync(PATHS.lastScene)) return null;
  const raw = await fs.readFile(PATHS.lastScene, "utf-8");
  return JSON.parse(raw);
}

export async function savePendingTurn(turn) {
  await ensureGameDir();
  await fs.writeFile(PATHS.pendingTurn, JSON.stringify(turn, null, 2), "utf-8");
}

export async function loadPendingTurn() {
  if (!existsSync(PATHS.pendingTurn)) return null;
  const raw = await fs.readFile(PATHS.pendingTurn, "utf-8");
  return JSON.parse(raw);
}

export async function clearPendingTurn() {
  try {
    await fs.unlink(PATHS.pendingTurn);
  } catch {}
}

// --- Helpers ---

export function worldExists() {
  return existsSync(PATHS.world);
}

/**
 * Delete all game files so the engine starts fresh on the next run.
 * The game/ directory itself is kept to avoid permission issues on re-creation.
 */
export async function clearGameState() {
  for (const filePath of Object.values(PATHS)) {
    try { await fs.unlink(filePath); } catch {}
  }
}

export { PATHS };
