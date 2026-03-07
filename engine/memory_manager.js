/**
 * Memory Manager
 *
 * Keeps the narrative log from growing unboundedly.
 * When the log exceeds MAX_ENTRIES, older entries are
 * summarized by the LLM and stored in summary.md.
 * Only the most recent entries are kept in full.
 */

import { queryLLMText } from "./llm.js";
import { loadLog, saveSummary, loadSummary } from "./state_manager.js";
import fs from "fs/promises";
import path from "path";

const MAX_RECENT_ENTRIES = 15;
const GAME_DIR = path.resolve("game");

/**
 * Split the narrative log into individual entries (separated by ---).
 */
function splitEntries(log) {
  if (!log || !log.trim()) return [];
  return log.split(/\n---\n/).map((e) => e.trim()).filter(Boolean);
}

/**
 * Check the log length and summarize old entries if needed.
 * Returns the recent entries string to include in LLM context.
 */
export async function getRecentContext() {
  const log = await loadLog();
  const entries = splitEntries(log);

  if (entries.length <= MAX_RECENT_ENTRIES) {
    return entries.join("\n\n---\n\n");
  }

  const oldEntries = entries.slice(0, entries.length - MAX_RECENT_ENTRIES);
  const recentEntries = entries.slice(-MAX_RECENT_ENTRIES);

  const existingSummary = await loadSummary();
  await summarizeEntries(oldEntries, existingSummary);

  const recentText = recentEntries.join("\n\n---\n\n");

  const logPath = path.join(GAME_DIR, "log.md");
  await fs.writeFile(logPath, recentText, "utf-8");

  return recentText;
}

/**
 * Ask the LLM to compress old narrative entries into a summary.
 */
async function summarizeEntries(entries, existingSummary) {
  const systemPrompt = `You are a concise story summarizer for a fantasy adventure game.
Produce a compact summary that preserves all important plot points,
character developments, relationship changes, and world events.
Write in past tense, third person. Keep it under 500 words.`;

  const userPrompt = `${existingSummary ? `Previous summary:\n${existingSummary}\n\n` : ""}New entries to incorporate:\n\n${entries.join("\n\n")}`;

  const summary = await queryLLMText(systemPrompt, userPrompt);

  await saveSummary(summary);
}

/**
 * Load the full memory context: summary + recent entries.
 */
export async function getFullMemoryContext() {
  const summary = await loadSummary();
  const recent = await getRecentContext();
  let context = "";
  if (summary) {
    context += `## Story So Far (Summary)\n\n${summary}\n\n`;
  }
  if (recent) {
    context += `## Recent Events\n\n${recent}`;
  }
  return context;
}
