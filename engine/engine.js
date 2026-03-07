/**
 * Game Engine
 *
 * Orchestrates the game loop: display → input → LLM → state update → repeat.
 * This is the only module that touches stdin/stdout directly.
 */

import readline from "readline";
import { worldExists, applyStateChanges, appendLog, loadState } from "./state_manager.js";
import { buildWorld } from "./world_builder.js";
import { processTurn } from "./game_master.js";

const DIVIDER = "━".repeat(56);
const THIN_DIVIDER = "─".repeat(56);

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

const MAX_LINE_WIDTH = 110;

function wordWrap(text) {
  return text.split("\n").map((line) => {
    if (line.length <= MAX_LINE_WIDTH) return line;
    const words = line.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
      if (current && (current.length + 1 + word.length) > MAX_LINE_WIDTH) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines.join("\n");
  }).join("\n");
}

/**
 * Print narrative text with simple formatting.
 */
function displayScene(narrative, asciiArt, choices) {
  console.log();
  console.log(DIVIDER);
  console.log();

  if (asciiArt) {
    console.log(asciiArt);
    console.log();
  }

  console.log(wordWrap(narrative));
  console.log();

  if (choices.length > 0) {
    console.log(THIN_DIVIDER);
    console.log();
    choices.forEach((choice, i) => {
      console.log(`  ${i + 1}. ${choice}`);
    });
    console.log();
  }
}

/**
 * Display a minimal status bar from the current state.
 */
async function displayStatus() {
  const state = await loadState();
  if (!state) return;

  const parts = [];
  if (state.location) parts.push(`📍 ${state.location}`);
  if (state.sub_location) parts.push(`→ ${state.sub_location}`);
  if (state.day) parts.push(`Day ${state.day}`);
  if (state.time_of_day) parts.push(state.time_of_day);
  if (state.health && state.health !== "good") parts.push(`❤️ ${state.health}`);
  if (state.gold !== undefined) parts.push(`💰 ${state.gold}g`);

  if (parts.length > 0) {
    console.log(`  [ ${parts.join(" | ")} ]`);
  }
}

/**
 * Resolve player input: if it's a number, map to a choice.
 */
function resolveInput(input, choices) {
  const trimmed = input.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= choices.length) {
    return choices[num - 1];
  }
  return trimmed;
}

/**
 * Run the main game loop.
 */
export async function runGame() {
  const rl = createInterface();

  console.log();
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║           A I d v e n t u r e            ║");
  console.log("  ║     AI-Powered Fantasy Text Adventure     ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log();

  let currentChoices = [];

  if (!worldExists()) {
    console.log("  No saved world found. Generating a new world...");
    try {
      const opening = await buildWorld();
      displayScene(opening.narrative, opening.ascii_art, opening.choices);
      currentChoices = opening.choices;
    } catch (err) {
      console.error("\n  Failed to generate world:", err.message);
      console.error("  Check your .env file and API key.\n");
      rl.close();
      process.exit(1);
    }
  } else {
    console.log("  Resuming your adventure...\n");
    await displayStatus();
    console.log("\n  (Type your action to continue, or 'quit' to exit)\n");
  }

  while (true) {
    await displayStatus();
    const rawInput = await prompt(rl, "\n> ");

    if (!rawInput || !rawInput.trim()) continue;

    const command = rawInput.trim().toLowerCase();
    if (command === "quit" || command === "exit") {
      console.log("\n  Your story pauses here. Until next time, adventurer.\n");
      break;
    }

    if (command === "status" || command === "stats") {
      const state = await loadState();
      console.log("\n" + JSON.stringify(state, null, 2));
      continue;
    }

    if (command === "inventory" || command === "inv" || command === "i") {
      const state = await loadState();
      const inv = state?.inventory || [];
      console.log(`\n  Inventory: ${inv.length === 0 ? "(empty)" : inv.join(", ")}`);
      if (state?.gold !== undefined) console.log(`  Gold: ${state.gold}`);
      continue;
    }

    if (command === "help" || command === "?") {
      console.log("\n  Commands:");
      console.log("    [number]    - Choose a numbered option");
      console.log("    [free text] - Do anything you can describe");
      console.log("    inventory   - Check your belongings");
      console.log("    status      - View full game state");
      console.log("    quit        - Save and exit");
      console.log();
      continue;
    }

    const action = resolveInput(rawInput, currentChoices);

    console.log("\n  ...\n");

    try {
      const result = await processTurn(action);

      if (Object.keys(result.state_changes).length > 0) {
        await applyStateChanges(result.state_changes);
      }

      await appendLog(result.narrative);
      displayScene(result.narrative, result.ascii_art, result.choices);
      currentChoices = result.choices;
    } catch (err) {
      console.error("\n  The world flickers... (LLM error:", err.message, ")\n");
      console.error("  Try again, or type 'quit' to exit.\n");
    }
  }

  rl.close();
}
