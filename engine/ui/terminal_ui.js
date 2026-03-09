/**
 * Terminal UI Adapter
 *
 * Renders the game through stdin/stdout with ASCII art and readline input.
 * This is the original "retro terminal" interface.
 */

import readline from "readline";
import { loadState } from "../state_manager.js";

const DIVIDER = "━".repeat(56);
const THIN_DIVIDER = "─".repeat(56);
const MAX_LINE_WIDTH = 110;

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

function resolveLocale() {
  const lang = (process.env.GAME_LANGUAGE || "English").toLowerCase();
  return lang.startsWith("de") || lang === "german" ? "de" : "en";
}

function wordWrap(text) {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= MAX_LINE_WIDTH) return line;
      const words = line.split(" ");
      const lines = [];
      let current = "";
      for (const word of words) {
        if (current && current.length + 1 + word.length > MAX_LINE_WIDTH) {
          lines.push(current);
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
      }
      if (current) lines.push(current);
      return lines.join("\n");
    })
    .join("\n");
}

export class TerminalUI {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.t = UI_STRINGS[resolveLocale()];
  }

  showBanner() {
    console.log();
    console.log("  ╔══════════════════════════════════════════╗");
    console.log("  ║           A I d v e n t u r e            ║");
    const sub = this.t.subtitle;
    console.log(`  ║  ${sub.padStart(Math.floor((38 + sub.length) / 2)).padEnd(38)}  ║`);
    console.log("  ╚══════════════════════════════════════════╝");
    console.log();
  }

  showScene(narrative, asciiArt, choices) {
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

  async showStatus(stateOverride) {
    const state = stateOverride || (await loadState());
    if (!state) return;

    const parts = [];
    if (state.location) parts.push(`📍 ${state.location}`);
    if (state.sub_location) parts.push(`→ ${state.sub_location}`);
    if (state.day) parts.push(`${this.t.day} ${state.day}`);
    if (state.time_of_day) parts.push(state.time_of_day);
    if (state.health && state.health !== "good") parts.push(`❤️ ${state.health}`);
    if (state.gold !== undefined) parts.push(`💰 ${state.gold}g`);

    if (parts.length > 0) {
      console.log(`  [ ${parts.join(" | ")} ]`);
    }
  }

  async getPlayerInput() {
    return new Promise((resolve) => this.rl.question("\n> ", resolve));
  }

  async selectStoryType(menu) {
    console.log("\n  Select your adventure type:\n");
    menu.forEach((item) => {
      console.log(`    ${item.number}. ${item.name}`);
      console.log(`       ${item.description}\n`);
    });

    while (true) {
      const input = await new Promise((resolve) =>
        this.rl.question("  Choose (1-" + menu.length + "): ", resolve),
      );
      const choice = parseInt(input.trim(), 10);
      if (choice >= 1 && choice <= menu.length) {
        return menu[choice - 1].key;
      }
      console.log("  Invalid choice. Please try again.\n");
    }
  }

  showMessage(text) {
    console.log(`  ${text}`);
  }

  showError(text) {
    console.error(`  ${text}`);
  }

  showThinking() {
    console.log(`\n  ${this.t.thinking}\n`);
  }

  showNoWorld() {
    console.log(`  ${this.t.noWorld}`);
  }

  showResuming() {
    console.log(`  ${this.t.resuming}\n`);
  }

  showResumeHint() {
    console.log(`\n  ${this.t.resumeHint}\n`);
  }

  showQuit() {
    console.log(`\n  ${this.t.quit}\n`);
  }

  showWorldError(errorMessage) {
    console.error(`\n  ${this.t.errorWorld}`, errorMessage);
    console.error(`  ${this.t.errorEnv}\n`);
  }

  showTurnError(errorMessage) {
    console.error(`\n  ${this.t.errorLLM}`, errorMessage, ")\n");
    console.error(`  ${this.t.errorRetry}\n`);
  }

  showInventory(inventory, gold) {
    const inv = inventory || [];
    console.log(
      `\n  ${this.t.inventory} ${inv.length === 0 ? this.t.inventoryEmpty : inv.join(", ")}`,
    );
    if (gold !== undefined) console.log(`  ${this.t.gold} ${gold}`);
  }

  showStateDebug(state) {
    console.log("\n" + JSON.stringify(state, null, 2));
  }

  showHelp() {
    console.log(`\n  ${this.t.helpTitle}`);
    console.log(`    ${this.t.helpNumber}`);
    console.log(`    ${this.t.helpFree}`);
    console.log(`    ${this.t.helpInv}`);
    console.log(`    ${this.t.helpStatus}`);
    console.log(`    ${this.t.helpQuit}`);
    console.log();
  }

  cleanup() {
    this.rl.close();
  }
}
