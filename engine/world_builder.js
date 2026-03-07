/**
 * World Builder
 *
 * Generates the initial fantasy world via the LLM on first launch.
 * Creates world lore, geography, factions, NPCs, a starting
 * location, and an initial quest — then persists everything
 * into the game/ directory.
 */

import { queryLLM } from "./llm.js";
import { saveWorld, saveCharacters, saveState, appendLog, appendStory } from "./state_manager.js";

const SYSTEM_PROMPT = `You are a master fantasy world-builder.
Create an original, richly detailed fantasy world for a text adventure game.
The world should feel lived-in and have internal consistency.

You MUST respond with a JSON object containing these exact keys:

{
  "world_lore": "A markdown document (1000-1500 words) describing the world: its name, creation myth, magic system, geography (at least 5 distinct regions), major historical events, and current political tensions.",

  "characters": [
    {
      "name": "string",
      "role": "string (e.g. quest-giver, merchant, antagonist, companion)",
      "location": "string",
      "description": "string (appearance and personality in 2-3 sentences)",
      "goals": "string (what this character wants)",
      "disposition_to_player": "string (friendly/neutral/hostile/unknown)"
    }
  ],

  "starting_state": {
    "day": 1,
    "time_of_day": "string",
    "location": "string",
    "sub_location": "string",
    "health": "good",
    "inventory": ["list of starting items"],
    "gold": 0,
    "active_quest": "string",
    "quest_log": ["string"],
    "reputation": {}
  },

  "opening_narrative": "string (2-3 paragraphs of evocative prose introducing the player to the world and their starting situation. Include sensory details. End with a moment of tension or curiosity.)",

  "ascii_art": "string (simple ASCII art of the starting location, max 8 lines)",

  "choices": ["string (3-4 initial choices for the player)"]
}

Generate 6-10 interesting characters across different locations.
Make the starting quest compelling but not overwhelming.
The tone should be literary fantasy — think Ursula K. Le Guin meets a tabletop RPG.`;

const USER_PROMPT = `Generate a complete fantasy world for a new adventure game.
Be creative and original. Avoid generic fantasy tropes where possible.
The world should have mystery, danger, and wonder in equal measure.`;

/**
 * Generate the initial world and persist all files.
 * Returns the opening scene data for display.
 */
export async function buildWorld() {
  console.log("\n  Weaving the threads of a new world...\n");

  const result = await queryLLM(SYSTEM_PROMPT, USER_PROMPT);

  await saveWorld(result.world_lore);
  await saveCharacters(result.characters);
  await saveState(result.starting_state);
  await appendLog(result.opening_narrative);
  await appendStory(`# AIdventure\n\n---\n\n${result.opening_narrative}`);

  return {
    narrative: result.opening_narrative,
    ascii_art: result.ascii_art || "",
    choices: result.choices || [],
  };
}
