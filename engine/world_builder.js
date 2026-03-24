/**
 * World Builder
 *
 * Generates the initial fantasy world via the LLM on first launch.
 * Creates world lore, geography, factions, NPCs, a starting
 * location, and an initial quest — then persists everything
 * into the game/ directory.
 */

import { queryLLM } from "./llm.js";
import {
  saveWorld,
  saveCharacters,
  saveState,
  appendLog,
  appendStory,
  loadActiveWorldSnapshot,
  archiveCurrentWorld,
} from "./state_manager.js";
import { getStoryType } from "./story_types.js";

function buildSystemPrompt(storyType) {
  const config = getStoryType(storyType);

  const genreInstructions = storyType === 'space_opera'
    ? 'galaxy/universe'
    : storyType === 'historical_thriller'
    ? 'historical setting'
    : 'world';

  const worldLoreGuidance = storyType === 'space_opera'
    ? "the galaxy/universe: its name, major civilizations/species, key technologies, important worlds and space stations (at least 5 distinct locations), major historical events, and current political tensions."
    : storyType === 'historical_thriller'
    ? "the historical setting: the exact time period and year (or narrow range of years), the real-world location, the political situation and key power structures, important real historical figures who are active at this time, at least 5 distinct real locations within the setting (neighborhoods, landmarks, buildings, surrounding towns), the social hierarchy and daily life, and the specific historical tensions or events driving the thriller plot."
    : "the world: its name, creation myth, magic/power system, geography (at least 5 distinct regions), major historical events, and current political tensions.";

  const openingChoiceGuidance = storyType === "tolkien_fantasy"
    ? `For opening_narrative and choices:
- The VERY FIRST part of opening_narrative must briefly name the peoples/races of this world and mention that both men and women are represented among adventurers.
- Then invite the player to choose who they are from exactly four options.
- choices MUST contain exactly 4 options, and each option must clearly include both a race and a gender (for example: "Elf woman ranger...", "Dwarf man smith...", etc.).
- These 4 options are character-identity picks for the player's starting role in this world. It is ABSOLUTELY CRITICAL to remember these throughout the game.`
    : storyType === "historical_thriller"
    ? `For opening_narrative and choices:
- The opening must immediately establish the specific historical time and place so the player feels grounded in that era.
- Introduce the protagonist's situation and the first hint of the thriller plot.
- choices should contain 3-4 initial choices that reflect plausible actions for someone in that historical context.
- All choices must be historically appropriate — no actions or options that would be anachronistic.`
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

${storyType === 'historical_thriller'
? `Generate 6-10 characters: a mix of real historical figures who were active in this time and place (with accurate titles, roles, and motivations) and fictional characters who fit naturally into the setting. Every name must be culturally and historically appropriate.
The central plot should be a compelling thriller — conspiracy, murder, espionage, or political intrigue — rooted in the real tensions of the era.`
: `Generate 6-10 interesting characters across different locations.
Make the starting quest compelling but not overwhelming.`}
${openingChoiceGuidance}

${config.narrative_style}`;
}

function buildUserPrompt(storyType) {
  if (storyType === 'historical_thriller') {
    return `Generate a complete historical setting for a new thriller adventure game.
Pick a specific, fascinating moment in real history. Commit to that one time and place.
Research accuracy matters — get the names, titles, locations, customs, and politics right.
Create something with intrigue, danger, and the texture of a lived-in historical world.`;
  }
  const genreType = storyType === 'space_opera' ? 'universe' : 'world';
  return `Generate a complete ${genreType} for a new adventure game.
Be creative and original. Avoid generic tropes where possible.
Create something with mystery, danger, and wonder in equal measure.`;
}

function buildTemplateSystemPrompt(storyType, template) {
  const config = getStoryType(storyType);
  const genreInstructions = storyType === "space_opera" ? "galaxy/universe" : storyType === "historical_thriller" ? "historical setting" : "world";

  return `You are reviving an established ${storyType === "historical_thriller" ? "" : "fictional "}${genreInstructions} for a new interactive adventure.

You will be given a reusable world template from a previous adventure. Treat it as canon.

Your job is to create a NEW standalone adventure in the SAME setting:
- Preserve established lore, factions, history, and the world's overall identity
- Keep important existing characters consistent with prior canon
- You MAY evolve the setting slightly with the passage of time, but do not contradict established facts
- Add 2-4 new characters and at least 2 new or newly relevant locations
- Create a fresh protagonist starting point and a new opening quest
- The new adventure must welcome a player who has NOT seen the previous game
- Reuse interesting old characters sparingly so the world feels familiar but not repetitive

${config.world_tone}

You MUST respond with a JSON object containing these exact keys:

{
  "world_lore": "A markdown document (1000-1500 words) describing the updated world and its current state",
  "characters": [
    {
      "name": "string",
      "role": "string",
      "location": "string",
      "description": "string",
      "goals": "string",
      "disposition_to_player": "string"
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
  "opening_narrative": "string",
  "ascii_art": "string",
  "choices": ["string"]
}

Generate 6-10 interesting characters total, mixing established figures and new faces.
The adventure should feel like a new book in the same universe.

${config.narrative_style}

Existing world template:
World name: ${template.metadata.name}
Genre: ${template.metadata.genre}
Summary: ${template.metadata.summary || "No summary provided."}`;
}

function buildTemplateUserPrompt(template) {
  return `Use this existing world template as canon and expand it into a fresh adventure.

## Canon Summary
${template.canon || "No canon summary provided."}

## World Lore
${template.world || ""}

## Characters
${JSON.stringify(template.characters || [], null, 2)}`;
}

function buildArchiveSystemPrompt(storyType) {
  const genreInstructions = storyType === "space_opera" ? "universe" : storyType === "historical_thriller" ? "historical setting" : "world";

  return `You are a continuity editor creating a reusable canon template from an interactive fiction playthrough.

You will receive the current ${genreInstructions} lore, character roster, and story transcript.

Your task:
- Distill the setting into a reusable canon packet for future adventures
- Preserve the world's identity and important historical truths
- Clean up noisy or contradictory character details
- Summarize the major events of the completed adventure as setting history
- Invent a strong, memorable reusable world name if the source material lacks one

You MUST respond with a JSON object containing these exact keys:
{
  "name": "string",
  "summary": "1-2 sentence summary of the world for menus",
  "world_lore": "markdown reference document for the reusable world template",
  "canon": "markdown canon summary including key events from the finished adventure",
  "characters": [
    {
      "name": "string",
      "role": "string",
      "location": "string",
      "description": "string",
      "goals": "string",
      "disposition_to_player": "string"
    }
  ]
}

The output must be suitable as a stable source of truth for future adventures in the same setting.`;
}

function clipStoryForArchive(story) {
  if (!story || story.length <= 24000) return story || "";
  return `${story.slice(0, 12000)}\n\n[... omitted middle chapters for brevity ...]\n\n${story.slice(-12000)}`;
}

function buildArchiveUserPrompt(snapshot) {
  return `Create a reusable world template from this completed adventure.

## Current World Lore
${snapshot.world || ""}

## Current Characters
${JSON.stringify(snapshot.characters || [], null, 2)}

## Current Adventure Transcript
${clipStoryForArchive(snapshot.story || "")}`;
}

async function persistBuiltWorld(result) {
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
  return persistBuiltWorld(result);
}

export async function buildWorldFromTemplate(template, storyType = template?.metadata?.genre || "sanderson_fantasy") {
  console.log(`\n  Returning to ${template?.metadata?.name || "a familiar world"}...\n`);

  const systemPrompt = buildTemplateSystemPrompt(storyType, template);
  const userPrompt = buildTemplateUserPrompt(template);
  const result = await queryLLM(systemPrompt, userPrompt);
  return persistBuiltWorld(result);
}

export async function archiveWorldToTemplate() {
  const snapshot = await loadActiveWorldSnapshot();
  if (!snapshot?.world) return null;

  const storyType = snapshot.state?.genre || "sanderson_fantasy";
  const systemPrompt = buildArchiveSystemPrompt(storyType);
  const userPrompt = buildArchiveUserPrompt(snapshot);
  const result = await queryLLM(systemPrompt, userPrompt);

  return archiveCurrentWorld({
    world: result.world_lore || snapshot.world,
    canon: result.canon || "",
    characters: Array.isArray(result.characters) ? result.characters : snapshot.characters,
    metadata: {
      name: result.name || "Unnamed World",
      genre: storyType,
      sourceStoryType: storyType,
      summary: result.summary || "",
    },
  });
}
