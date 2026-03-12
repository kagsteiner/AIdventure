/**
 * LLM Abstraction Layer
 *
 * Supports both OpenAI and Anthropic backends.
 * Set LLM_PROVIDER in .env to "openai" or "anthropic".
 */

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// --- LLM request/response logging ---

const LLM_LOG_DIR = path.join(process.cwd(), "logs");
const LLM_LOG_FILE = path.join(LLM_LOG_DIR, "llm.log");

function ensureLogDir() {
  try {
    fs.mkdirSync(LLM_LOG_DIR, { recursive: true });
  } catch (_) {}
}

/**
 * Append a single log entry (request, response, or parse error) to logs/llm.log.
 * @param {"request"|"response"|"parse_error"} kind
 * @param {object} data
 */
function logToFile(kind, data) {
  try {
    ensureLogDir();
    const ts = new Date().toISOString();
    const lines = [`\n${"=".repeat(60)}`, `[${ts}] ${kind.toUpperCase()}`];

    if (kind === "request") {
      lines.push(`provider: ${data.provider}`, `model: ${data.model}`, `gameloop: ${data.gameloop}`, `caller: ${data.caller}`);
      lines.push("--- system ---", data.systemPrompt, "--- user ---", data.userPrompt);
    } else if (kind === "response") {
      lines.push("--- raw body ---", data.raw === undefined || data.raw === null ? String(data.raw) : data.raw);
    } else if (kind === "parse_error") {
      lines.push(`error: ${data.errorMessage}`, "--- raw body (failed to parse) ---", data.raw === undefined || data.raw === null ? String(data.raw) : data.raw);
    }

    lines.push("=".repeat(60));
    fs.appendFileSync(LLM_LOG_FILE, lines.join("\n") + "\n");
  } catch (e) {
    console.error("[llm] Failed to write llm.log:", e.message);
  }
}

const provider = () => (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

let openaiClient = null;
let anthropicClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return openaiClient;
}

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

// --- Model resolution ---

const DEFAULT_MODELS = {
  openai: "gpt-5.2",
  anthropic: "claude-opus-4-0-20250514",
};

const DEFAULT_GAMELOOP_MODELS = {
  openai: "gpt-5.2",
  anthropic: "claude-sonnet-4-20250514",
};

/**
 * Resolve which model to use.
 * @param {boolean} gameloop - If true, prefer LLM_GAMELOOP_MODEL for cheaper game-loop calls.
 */
function resolveModel(gameloop = false) {
  const p = provider();
  if (gameloop && process.env.LLM_GAMELOOP_MODEL) {
    return process.env.LLM_GAMELOOP_MODEL;
  }
  return process.env.LLM_MODEL || (gameloop ? DEFAULT_GAMELOOP_MODELS[p] : DEFAULT_MODELS[p]);
}

function getDefaultModelForProvider(providerName, gameloop = false) {
  return gameloop ? DEFAULT_GAMELOOP_MODELS[providerName] : DEFAULT_MODELS[providerName];
}

function isAnthropicOverloadedError(err) {
  const status = err?.status ?? err?.statusCode ?? err?.error?.status;
  const message = String(err?.message || "").toLowerCase();
  return status === 529 || (message.includes("529") && message.includes("overloaded"));
}

// --- OpenAI helpers ---

async function openaiJSON(systemPrompt, userPrompt, model) {
  const response = await getOpenAIClient().chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0].message.content.trim();
}

async function openaiText(systemPrompt, userPrompt, model) {
  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0].message.content.trim();
}

// --- Anthropic helpers ---

/**
 * Convert a system prompt (string or array of { text, cache } blocks)
 * into the Anthropic API format. When the system is an array, blocks
 * with `cache: true` get `cache_control: { type: "ephemeral" }`.
 *
 * @param {string|Array<{text: string, cache?: boolean}>} system
 * @param {string} [suffix] - Optional text appended to the last block
 * @returns {string|Array<{type: string, text: string, cache_control?: object}>}
 */
function formatAnthropicSystem(system, suffix = "") {
  if (typeof system === "string") {
    return system + suffix;
  }

  return system.map((block, i) => {
    const isLast = i === system.length - 1;
    const entry = { type: "text", text: block.text + (isLast ? suffix : "") };
    if (block.cache) {
      entry.cache_control = { type: "ephemeral", ttl: "1h" };
    }
    return entry;
  });
}

function logCacheUsage(response) {
  const u = response.usage;
  if (!u) return;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  if (cacheWrite || cacheRead) {
    logToFile("response", {
      raw: `[cache] write=${cacheWrite} read=${cacheRead} input=${u.input_tokens} output=${u.output_tokens}`,
    });
  }
}

async function anthropicJSON(system, userPrompt, model) {
  const jsonSuffix = "\n\nYou MUST respond with valid JSON only. No markdown fences, no extra text.";
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 8192,
    system: formatAnthropicSystem(system, jsonSuffix),
    messages: [{ role: "user", content: userPrompt }],
  });
  logCacheUsage(response);
  return response.content[0].text.trim();
}

async function anthropicText(system, userPrompt, model) {
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 8192,
    system: formatAnthropicSystem(system),
    messages: [{ role: "user", content: userPrompt }],
  });
  logCacheUsage(response);
  return response.content[0].text.trim();
}

// --- Language directive ---

function langDirective() {
  const lang = process.env.GAME_LANGUAGE || "English";
  if (lang.toLowerCase() === "english") return "";
  return `\n\nIMPORTANT: All player-facing text (narrative, choices, descriptions, quest names, item names) MUST be written in ${lang}. Internal JSON keys remain in English.`;
}

/**
 * Apply the language directive to a system prompt (string or block array).
 * Appends to the last block's text so cache keys remain stable when lang is fixed.
 */
function applyLangDirective(system) {
  const directive = langDirective();
  if (!directive) return system;

  if (typeof system === "string") return system + directive;

  const blocks = system.map((b) => ({ ...b }));
  blocks[blocks.length - 1].text += directive;
  return blocks;
}

/**
 * Flatten system blocks to a single string for logging purposes.
 */
function systemToLogString(system) {
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n---\n\n");
}

// --- Shared utilities ---

/**
 * Extract a JSON object from a response that may contain
 * preamble text, markdown fences, or trailing commentary.
 */
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text.trim();
}

// --- Public API (unchanged for the rest of the engine) ---

/**
 * Send a prompt to the LLM and get back parsed JSON.
 *
 * @param {string|Array<{text: string, cache?: boolean}>} systemPrompt
 *   Either a plain string or an array of blocks. Blocks with `cache: true`
 *   receive Anthropic's `cache_control: { type: "ephemeral" }`.
 * @param {string} userPrompt   - The user-level content (context + action)
 * @param {object} [options]
 * @param {boolean} [options.gameloop=false] - Use the game-loop model (LLM_GAMELOOP_MODEL)
 * @returns {object} Parsed JSON from the LLM response
 */
export async function queryLLM(systemPrompt, userPrompt, { gameloop = false } = {}) {
  const p = provider();
  const model = resolveModel(gameloop);
  const fullSystem = applyLangDirective(systemPrompt);
  const openaiSystem = typeof fullSystem === "string" ? fullSystem : systemToLogString(fullSystem);

  logToFile("request", {
    provider: p,
    model,
    gameloop,
    caller: "queryLLM",
    systemPrompt: systemToLogString(fullSystem),
    userPrompt,
  });

  let raw;
  if (p === "openai") {
    raw = await openaiJSON(openaiSystem, userPrompt, model);
  } else {
    try {
      raw = await anthropicJSON(fullSystem, userPrompt, model);
    } catch (err) {
      if (!isAnthropicOverloadedError(err)) throw err;

      const fallbackModel = getDefaultModelForProvider("openai", gameloop);
      logToFile("response", {
        raw: `[fallback] Anthropic 529 overloaded_error. Retrying once with OpenAI default model: ${fallbackModel}`,
      });
      logToFile("request", {
        provider: "openai",
        model: fallbackModel,
        gameloop,
        caller: "queryLLM:fallback_from_anthropic_529",
        systemPrompt: systemToLogString(fullSystem),
        userPrompt,
      });
      raw = await openaiJSON(openaiSystem, userPrompt, fallbackModel);
    }
  }

  logToFile("response", { raw });

  try {
    return JSON.parse(extractJSON(raw));
  } catch (err) {
    logToFile("parse_error", { errorMessage: err.message, raw });
    throw err;
  }
}

/**
 * Send a prompt expecting free-form text (used for summaries).
 *
 * @param {string|Array<{text: string, cache?: boolean}>} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options]
 * @param {boolean} [options.gameloop=false] - Use the game-loop model (LLM_GAMELOOP_MODEL)
 */
export async function queryLLMText(systemPrompt, userPrompt, { gameloop = false } = {}) {
  const p = provider();
  const model = resolveModel(gameloop);
  const fullSystem = applyLangDirective(systemPrompt);
  const openaiSystem = typeof fullSystem === "string" ? fullSystem : systemToLogString(fullSystem);

  logToFile("request", {
    provider: p,
    model,
    gameloop,
    caller: "queryLLMText",
    systemPrompt: systemToLogString(fullSystem),
    userPrompt,
  });

  let raw;
  if (p === "openai") {
    raw = await openaiText(openaiSystem, userPrompt, model);
  } else {
    try {
      raw = await anthropicText(fullSystem, userPrompt, model);
    } catch (err) {
      if (!isAnthropicOverloadedError(err)) throw err;

      const fallbackModel = getDefaultModelForProvider("openai", gameloop);
      logToFile("response", {
        raw: `[fallback] Anthropic 529 overloaded_error. Retrying once with OpenAI default model: ${fallbackModel}`,
      });
      logToFile("request", {
        provider: "openai",
        model: fallbackModel,
        gameloop,
        caller: "queryLLMText:fallback_from_anthropic_529",
        systemPrompt: systemToLogString(fullSystem),
        userPrompt,
      });
      raw = await openaiText(openaiSystem, userPrompt, fallbackModel);
    }
  }

  logToFile("response", { raw });
  return raw;
}
