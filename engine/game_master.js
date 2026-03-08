/**
 * Game Master
 *
 * The narrative brain of the engine. Assembles full context
 * (world + characters + state + memory) and sends it to the
 * LLM along with the player's action. Parses the structured
 * response and returns it for the engine to apply.
 */

import { queryLLM } from "./llm.js";
import { loadWorld, loadCharacters, loadState } from "./state_manager.js";
import { getFullMemoryContext } from "./memory_manager.js";
import { getStoryType } from "./story_types.js";

function buildSystemPrompt(storyType) {
  const config = getStoryType(storyType);

  return `You are the Game Master of an AI-driven interactive story adventure.
Your role is to craft immersive, compelling narrative in response to the player's actions.

${config.narrative_style}

Rules:
- Stay consistent with the established world lore, character personalities, and current state.
- Characters should behave according to their goals and dispositions.
- The world should feel alive — things happen even when the player isn't looking.
- Actions have consequences. Dangerous actions can lead to injury or setbacks.
- Maintain tension and pacing. Not everything should go the player's way.
- Advance time naturally. A long journey might advance the day counter.
- When the player tries something creative or unexpected, reward it.
- Include sensory details: sounds, smells, weather, atmosphere.
- ASCII art is optional — include it when the player arrives at a new location
  or encounters a notable creature/object.

You MUST respond with a JSON object containing these exact keys:

{
  "state_changes": {
    // Only include fields that changed. Examples:
    // "location": "new location",
    // "time_of_day": "evening",
    // "day": 3,
    // "inventory": ["updated", "full", "list"],
    // "health": "injured",
    // "active_quest": "new quest",
    // "gold": 15
  },

  "events": [
    // Brief factual descriptions of what happened this turn.
    // Used for internal tracking. Example:
    // "Player entered the Sunken Library",
    // "Met the scholar Veyla"
  ],

  "ascii_art": "",
  // Optional ASCII art (max 10 lines). Empty string if none.

  "narrative": "",
  // 2-4 paragraphs of rich, evocative prose describing what happens.
  // Write in second person present tense ("You see...", "You hear...").
  // End with a natural pause or moment of decision.

  "choices": [
    // 3-4 suggested actions. The player can also type free text.
    // Example: "Examine the strange markings on the wall"
  ]
}

Important:
- inventory in state_changes should always be the COMPLETE updated list, not a diff.
- If nothing changed for a field, do NOT include it in state_changes.
- narrative should NEVER be empty.`;
}

/**
 * Build the system message as an array of blocks with prompt caching.
 * Block 1 — Game Master instructions (stable per genre, cached)
 * Block 2 — World lore + characters (stable across turns, cached)
 */
async function buildCachedSystemBlocks(storyType) {
  const [world, characters] = await Promise.all([
    loadWorld(),
    loadCharacters(),
  ]);

  return [
    {
      text: buildSystemPrompt(storyType),
      cache: true,
    },
    {
      text: `## World Lore\n\n${world}\n\n## Characters\n\n${JSON.stringify(characters, null, 2)}`,
      cache: true,
    },
  ];
}

/**
 * Build the user message containing only dynamic, per-turn content.
 */
async function buildUserMessage(playerAction) {
  const [state, memory] = await Promise.all([
    loadState(),
    getFullMemoryContext(),
  ]);

  return `## Current State

${JSON.stringify(state, null, 2)}

## Narrative History

${memory}

---

## Player Action

The player says/does: "${playerAction}"

Respond as the Game Master.`;
}

/**
 * Process a player's action through the LLM Game Master.
 *
 * @param {string} playerAction - What the player typed
 * @returns {object} Parsed response with narrative, state_changes, etc.
 */
export async function processTurn(playerAction) {
  const state = await loadState();
  const storyType = state?.genre || 'sanderson_fantasy';

  const systemBlocks = await buildCachedSystemBlocks(storyType);
  const userMessage = await buildUserMessage(playerAction);

  const result = await queryLLM(systemBlocks, userMessage, { gameloop: true });

  if (!result.narrative) {
    result.narrative = "The world shifts around you, but nothing notable happens.";
  }
  if (!result.state_changes) result.state_changes = {};
  if (!result.events) result.events = [];
  if (!result.choices) result.choices = [];

  return result;
}
