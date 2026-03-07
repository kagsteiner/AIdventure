/**
 * Game Engine
 *
 * Orchestrates the game loop: display → input → LLM → state update → repeat.
 * This is the only module that touches stdin/stdout directly.
 */

import readline from "readline";
import { worldExists, applyStateChanges, appendLog, appendStory, loadState } from "./state_manager.js";
import { buildWorld } from "./world_builder.js";
import { processTurn } from "./game_master.js";
import { getStoryTypeMenu } from "./story_types.js";

const DIVIDER = "━".repeat(56);
const THIN_DIVIDER = "─".repeat(56);

const UI_STRINGS = {
  en: {
    subtitle: "AI-Powered Text Adventure",
    noWorld: "No saved world found. Generating a new world...",
    resuming: "Resuming your adventure...",
    resumeHint: "(Type your action to continue, or 'quit' to exit)",
    quit: "Your story pauses here. Until next time, adventurer.",
    thinking: "...",
    errorWorld: "Failed to generate world:",
    errorEnv: "Check your .env file and API key.",
    errorLLM: "The world flickers... (LLM error:",
    errorRetry: "Try again, or type 'quit' to exit.",
    inventory: "Inventory:",
    inventoryEmpty: "(empty)",
    gold: "Gold:",
    helpTitle: "Commands:",
    helpNumber: "[number]    - Choose a numbered option",
    helpFree: "[free text] - Do anything you can describe",
    helpInv: "inventory   - Check your belongings",
    helpStatus: "status      - View full game state",
    helpQuit: "quit        - Save and exit",
    day: "Day",
  },
  de: {
    subtitle: "KI-gesteuertes Textabenteuer",
    noWorld: "Keine gespeicherte Welt gefunden. Erschaffe eine neue Welt...",
    resuming: "Dein Abenteuer wird fortgesetzt...",
    resumeHint: "(Gib deine Aktion ein, oder 'quit' zum Beenden)",
    quit: "Deine Geschichte pausiert hier. Bis zum nächsten Mal, Abenteurer.",
    thinking: "...",
    errorWorld: "Welterstellung fehlgeschlagen:",
    errorEnv: "Überprüfe deine .env-Datei und den API-Schlüssel.",
    errorLLM: "Die Welt flackert... (LLM-Fehler:",
    errorRetry: "Versuche es erneut, oder gib 'quit' zum Beenden ein.",
    inventory: "Inventar:",
    inventoryEmpty: "(leer)",
    gold: "Gold:",
    helpTitle: "Befehle:",
    helpNumber: "[Zahl]      - Wähle eine nummerierte Option",
    helpFree: "[Freitext]  - Tu alles, was du beschreiben kannst",
    helpInv: "inventory   - Inventar anzeigen",
    helpStatus: "status      - Spielstand anzeigen",
    helpQuit: "quit        - Speichern und beenden",
    day: "Tag",
  },
};

function ui() {
  const lang = (process.env.GAME_LANGUAGE || "English").toLowerCase();
  const key = lang.startsWith("de") || lang === "german" ? "de" : "en";
  return UI_STRINGS[key];
}

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
  if (state.day) parts.push(`${ui().day} ${state.day}`);
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
 * Display story type selection menu and get user choice.
 */
async function selectStoryType(rl) {
  const menu = getStoryTypeMenu();

  console.log("\n  Select your adventure type:\n");
  menu.forEach(item => {
    console.log(`    ${item.number}. ${item.name}`);
    console.log(`       ${item.description}\n`);
  });

  while (true) {
    const input = await prompt(rl, "  Choose (1-" + menu.length + "): ");
    const choice = parseInt(input.trim(), 10);

    if (choice >= 1 && choice <= menu.length) {
      return menu[choice - 1].key;
    }

    console.log("  Invalid choice. Please try again.\n");
  }
}

/**
 * Run the main game loop.
 */
export async function runGame() {
  const rl = createInterface();

  console.log();
  const t = ui();
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║           A I d v e n t u r e            ║");
  console.log(`  ║  ${t.subtitle.padStart(Math.floor((38 + t.subtitle.length) / 2)).padEnd(38)}  ║`);
  console.log("  ╚══════════════════════════════════════════╝");
  console.log();

  let currentChoices = [];

  if (!worldExists()) {
    console.log(`  ${t.noWorld}`);
    const storyType = await selectStoryType(rl);
    try {
      const opening = await buildWorld(storyType);
      displayScene(opening.narrative, opening.ascii_art, opening.choices);
      currentChoices = opening.choices;
    } catch (err) {
      console.error(`\n  ${t.errorWorld}`, err.message);
      console.error(`  ${t.errorEnv}\n`);
      rl.close();
      process.exit(1);
    }
  } else {
    console.log(`  ${t.resuming}\n`);
    await displayStatus();
    console.log(`\n  ${t.resumeHint}\n`);
  }

  while (true) {
    await displayStatus();
    const rawInput = await prompt(rl, "\n> ");

    if (!rawInput || !rawInput.trim()) continue;

    const command = rawInput.trim().toLowerCase();
    if (command === "quit" || command === "exit") {
      console.log(`\n  ${t.quit}\n`);
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
      console.log(`\n  ${t.inventory} ${inv.length === 0 ? t.inventoryEmpty : inv.join(", ")}`);
      if (state?.gold !== undefined) console.log(`  ${t.gold} ${state.gold}`);
      continue;
    }

    if (command === "help" || command === "?") {
      console.log(`\n  ${t.helpTitle}`);
      console.log(`    ${t.helpNumber}`);
      console.log(`    ${t.helpFree}`);
      console.log(`    ${t.helpInv}`);
      console.log(`    ${t.helpStatus}`);
      console.log(`    ${t.helpQuit}`);
      console.log();
      continue;
    }

    const action = resolveInput(rawInput, currentChoices);

    console.log(`\n  ${t.thinking}\n`);

    try {
      const result = await processTurn(action);

      if (Object.keys(result.state_changes).length > 0) {
        await applyStateChanges(result.state_changes);
      }

      await appendLog(result.narrative);
      await appendStory(`> *${action}*\n\n${result.narrative}`);
      displayScene(result.narrative, result.ascii_art, result.choices);
      currentChoices = result.choices;
    } catch (err) {
      console.error(`\n  ${t.errorLLM}`, err.message, ")\n");
      console.error(`  ${t.errorRetry}\n`);
    }
  }

  rl.close();
}
