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
import { getStoryType } from "./story_types.js";

function buildSystemPrompt(storyType) {
  const config = getStoryType(storyType);

  const genreInstructions = storyType === 'space_opera'
    ? 'galaxy/universe'
    : 'world';

  const worldLoreGuidance = storyType === 'space_opera'
    ? "the galaxy/universe: its name, major civilizations/species, key technologies, important worlds and space stations (at least 5 distinct locations), major historical events, and current political tensions."
    : "the world: its name, creation myth, magic/power system, geography (at least 5 distinct regions), major historical events, and current political tensions.";

  const openingChoiceGuidance = storyType === "tolkien_fantasy"
    ? `For opening_narrative and choices:
- The VERY FIRST part of opening_narrative must briefly name the peoples/races of this world and mention that both men and women are represented among adventurers.
- Then invite the player to choose who they are from exactly four options.
- choices MUST contain exactly 4 options, and each option must clearly include both a race and a gender (for example: "Elf woman ranger...", "Dwarf man smith...", etc.).
- These 4 options are character-identity picks for the player's starting role in this world. It is ABSOLUTELY CRITICAL to remember these throughout the game.`
    : "choices should contain 3-4 initial choices for the player.";

  return `You are a master world-builder for interactive fiction.
Create an original, richly detailed ${genreInstructions} for a text adventure game.

${config.world_tone}

You MUST respond with a JSON object containing these exact keys:

{
  "world_lore": "A markdown document (1000-1500 words) describing ${worldLoreGuidance}",

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
    "reputation": {},
    "genre": "${storyType}"
  },

  "opening_narrative": "string (2-3 paragraphs of evocative prose introducing the player to the ${genreInstructions} and their starting situation. End with a moment of tension or curiosity.)",

  "ascii_art": "string (simple ASCII art of the starting location, max 8 lines)",

  "choices": ["string (${storyType === "tolkien_fantasy" ? "exactly 4 Tolkien character-identity options" : "3-4 initial choices for the player"})"]
}

Generate 6-10 interesting characters across different locations.
Make the starting quest compelling but not overwhelming.
${openingChoiceGuidance}

${config.narrative_style}`;
}

function buildUserPrompt(storyType) {
  const genreType = storyType === 'space_opera' ? 'universe' : 'world';
  return `Generate a complete ${genreType} for a new adventure game.
Be creative and original. Avoid generic tropes where possible.
Create something with mystery, danger, and wonder in equal measure.`;
}

/**
 * Generate the initial world and persist all files.
 * Returns the opening scene data for display.
 *
 * @param {string} storyType - The selected story type key
 */
export async function buildWorld(storyType = 'sanderson_fantasy') {
  console.log("\n  Weaving the threads of a new world...\n");

  const systemPrompt = buildSystemPrompt(storyType);
  const userPrompt = buildUserPrompt(storyType);

  const result = await queryLLM(systemPrompt, userPrompt);

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
