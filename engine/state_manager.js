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
import crypto from "crypto";

const GAME_DIR = path.resolve("game");
const WORLDS_DIR = path.resolve("worlds");
const WORLD_INDEX_PATH = path.join(WORLDS_DIR, "index.json");

const PATHS = {
  world: path.join(GAME_DIR, "world.md"),
  characters: path.join(GAME_DIR, "characters.json"),
  state: path.join(GAME_DIR, "state.json"),
  log: path.join(GAME_DIR, "log.md"),
  summary: path.join(GAME_DIR, "summary.md"),
  story: path.join(GAME_DIR, "story.md"),
  storyArc: path.join(GAME_DIR, "story_arc.json"),
  lastScene: path.join(GAME_DIR, "last_scene.json"),
  lastTurn: path.join(GAME_DIR, "last_turn.json"),
  pendingTurn: path.join(GAME_DIR, "pending_turn.json"),
  ttsCacheDir: path.join(GAME_DIR, "tts_cache"),
};

const WORLD_TEMPLATE_FILES = {
  metadata: "metadata.json",
  world: "world.md",
  characters: "characters.json",
  canon: "canon.md",
};

async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function ensureGameDir() {
  await ensureDir(GAME_DIR);
}

async function ensureWorldsDir() {
  await ensureDir(WORLDS_DIR);
}

async function readJSON(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function writeJSON(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function buildWorldTemplateDir(id) {
  return path.join(WORLDS_DIR, id);
}

function slugifyWorldName(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "world";
}

function hashContent(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function normalizeCharacterList(characters) {
  return Array.isArray(characters) ? characters : [];
}

function buildTemplateSummary(templatePack) {
  return {
    id: templatePack.metadata.id,
    name: templatePack.metadata.name,
    genre: templatePack.metadata.genre,
    createdAt: templatePack.metadata.createdAt,
    lastPlayedAt: templatePack.metadata.lastPlayedAt,
    sourceStoryType: templatePack.metadata.sourceStoryType,
    summary: templatePack.metadata.summary || "",
    sourceHash: templatePack.metadata.sourceHash,
  };
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

export async function loadStory() {
  if (!existsSync(PATHS.story)) return "";
  return fs.readFile(PATHS.story, "utf-8");
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

// --- Story Arc ---

export async function saveStoryArc(arc) {
  await ensureGameDir();
  await writeJSON(PATHS.storyArc, arc);
}

export async function loadStoryArc() {
  return readJSON(PATHS.storyArc, null);
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

// --- World library ---

export async function loadWorldLibraryIndex() {
  await ensureWorldsDir();
  const index = await readJSON(WORLD_INDEX_PATH, []);
  return Array.isArray(index) ? index : [];
}

export async function listWorldTemplates() {
  const index = await loadWorldLibraryIndex();
  return [...index].sort((a, b) => {
    const left = Date.parse(b.lastPlayedAt || b.createdAt || 0);
    const right = Date.parse(a.lastPlayedAt || a.createdAt || 0);
    return left - right;
  });
}

export async function loadWorldTemplate(id) {
  const dirPath = buildWorldTemplateDir(id);
  if (!existsSync(dirPath)) return null;

  const metadata = await readJSON(path.join(dirPath, WORLD_TEMPLATE_FILES.metadata), null);
  if (!metadata) return null;

  return {
    metadata,
    world: existsSync(path.join(dirPath, WORLD_TEMPLATE_FILES.world))
      ? await fs.readFile(path.join(dirPath, WORLD_TEMPLATE_FILES.world), "utf-8")
      : "",
    canon: existsSync(path.join(dirPath, WORLD_TEMPLATE_FILES.canon))
      ? await fs.readFile(path.join(dirPath, WORLD_TEMPLATE_FILES.canon), "utf-8")
      : "",
    characters: await readJSON(path.join(dirPath, WORLD_TEMPLATE_FILES.characters), []),
  };
}

export async function loadActiveWorldSnapshot() {
  const [world, characters, state, story] = await Promise.all([
    loadWorld(),
    loadCharacters(),
    loadState(),
    loadStory(),
  ]);

  if (!world && !story && !characters && !state) return null;

  return {
    world: world || "",
    characters: normalizeCharacterList(characters),
    state: state || null,
    story: story || "",
  };
}

export function computeWorldSourceHash(snapshot) {
  return hashContent(JSON.stringify({
    world: snapshot?.world || "",
    story: snapshot?.story || "",
    genre: snapshot?.state?.genre || "",
    characters: normalizeCharacterList(snapshot?.characters),
  }));
}

export async function saveWorldTemplate(templatePack) {
  await ensureWorldsDir();

  const metadata = { ...templatePack.metadata };
  const id = metadata.id;
  const dirPath = buildWorldTemplateDir(id);
  await ensureDir(dirPath);

  await Promise.all([
    writeJSON(path.join(dirPath, WORLD_TEMPLATE_FILES.metadata), metadata),
    fs.writeFile(path.join(dirPath, WORLD_TEMPLATE_FILES.world), templatePack.world || "", "utf-8"),
    writeJSON(
      path.join(dirPath, WORLD_TEMPLATE_FILES.characters),
      normalizeCharacterList(templatePack.characters),
    ),
    fs.writeFile(path.join(dirPath, WORLD_TEMPLATE_FILES.canon), templatePack.canon || "", "utf-8"),
  ]);

  const index = await loadWorldLibraryIndex();
  const summary = buildTemplateSummary({ ...templatePack, metadata });
  const nextIndex = index.filter((item) => item.id !== id);
  nextIndex.push(summary);
  await writeJSON(WORLD_INDEX_PATH, nextIndex);

  return {
    metadata,
    world: templatePack.world || "",
    canon: templatePack.canon || "",
    characters: normalizeCharacterList(templatePack.characters),
  };
}

export async function archiveCurrentWorld(templatePack) {
  const snapshot = await loadActiveWorldSnapshot();
  const sourceHash = templatePack.metadata?.sourceHash || computeWorldSourceHash(snapshot);
  const index = await loadWorldLibraryIndex();
  const existing = index.find((item) => item.sourceHash === sourceHash);
  const now = new Date().toISOString();

  if (existing) {
    const existingTemplate = await loadWorldTemplate(existing.id);
    if (!existingTemplate) return null;

    const metadata = {
      ...existingTemplate.metadata,
      lastPlayedAt: now,
    };
    return saveWorldTemplate({
      ...existingTemplate,
      metadata,
    });
  }

  const createdAt = templatePack.metadata?.createdAt || now;
  const worldName = templatePack.metadata?.name || snapshot?.state?.location || "Unnamed World";
  const id = templatePack.metadata?.id || `${slugifyWorldName(worldName)}-${sourceHash.slice(0, 8)}`;

  return saveWorldTemplate({
    world: templatePack.world || "",
    canon: templatePack.canon || "",
    characters: normalizeCharacterList(templatePack.characters),
    metadata: {
      id,
      name: worldName,
      genre: templatePack.metadata?.genre || snapshot?.state?.genre || "sanderson_fantasy",
      createdAt,
      lastPlayedAt: templatePack.metadata?.lastPlayedAt || now,
      sourceStoryType: templatePack.metadata?.sourceStoryType || snapshot?.state?.genre || "sanderson_fantasy",
      summary: templatePack.metadata?.summary || "",
      sourceHash,
    },
  });
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
    try {
      await fs.rm(filePath, { recursive: true, force: true });
    } catch {}
  }
}

export { PATHS, WORLDS_DIR, WORLD_INDEX_PATH };
