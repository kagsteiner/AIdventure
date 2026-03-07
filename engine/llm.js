/**
 * LLM Abstraction Layer
 *
 * Supports both OpenAI and Anthropic backends.
 * Set LLM_PROVIDER in .env to "openai" or "anthropic".
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

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

// --- OpenAI helpers ---

async function openaiJSON(systemPrompt, userPrompt) {
  const model = process.env.LLM_MODEL || "gpt-4o";
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

async function openaiText(systemPrompt, userPrompt) {
  const model = process.env.LLM_MODEL || "gpt-4o";
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

async function anthropicJSON(systemPrompt, userPrompt) {
  const model = process.env.LLM_MODEL || "claude-opus-4-0-20250514";
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt + "\n\nYou MUST respond with valid JSON only. No markdown fences, no extra text.",
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text.trim();
}

async function anthropicText(systemPrompt, userPrompt) {
  const model = process.env.LLM_MODEL || "claude-opus-4-0-20250514";
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text.trim();
}

// --- Language directive ---

function langDirective() {
  const lang = process.env.GAME_LANGUAGE || "English";
  if (lang.toLowerCase() === "english") return "";
  return `\n\nIMPORTANT: All player-facing text (narrative, choices, descriptions, quest names, item names) MUST be written in ${lang}. Internal JSON keys remain in English.`;
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
 * @param {string} systemPrompt - The system-level instruction
 * @param {string} userPrompt   - The user-level content (context + action)
 * @returns {object} Parsed JSON from the LLM response
 */
export async function queryLLM(systemPrompt, userPrompt) {
  const fullSystem = systemPrompt + langDirective();
  const raw = provider() === "openai"
    ? await openaiJSON(fullSystem, userPrompt)
    : await anthropicJSON(fullSystem, userPrompt);
  return JSON.parse(extractJSON(raw));
}

/**
 * Send a prompt expecting free-form text (used for summaries).
 */
export async function queryLLMText(systemPrompt, userPrompt) {
  const fullSystem = systemPrompt + langDirective();
  return provider() === "openai"
    ? await openaiText(fullSystem, userPrompt)
    : await anthropicText(fullSystem, userPrompt);
}
