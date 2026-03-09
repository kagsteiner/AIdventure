/**
 * AIdventure — Entry Point
 * by ChatGPT 5.4 and Karlheinz Agsteiner.
 * Loads environment variables and starts the game engine.
 */

import dotenv from "dotenv";
dotenv.config();

import { runGame } from "./engine/engine.js";
import { TerminalUI } from "./engine/ui/terminal_ui.js";

const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const uiMode = (process.env.UI_MODE || "terminal").toLowerCase();

if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  console.error("\n  Error: ANTHROPIC_API_KEY is not set.");
  console.error("  Copy .env.example to .env and add your API key.\n");
  process.exit(1);
}

if (provider === "openai" && !process.env.OPENAI_API_KEY) {
  console.error("\n  Error: OPENAI_API_KEY is not set.");
  console.error("  Copy .env.example to .env and add your API key.\n");
  process.exit(1);
}

if (uiMode === "web") {
  await import("./server.js");
} else if (uiMode === "audiobook") {
  if (!process.env.OPENAI_API_KEY) {
    console.error("\n  Error: OPENAI_API_KEY is required for audiobook mode (TTS/STT).");
    console.error("  Add your OpenAI API key to .env.\n");
    process.exit(1);
  }
  const { AudiobookUI } = await import("./engine/ui/audiobook_ui.js");
  runGame(new AudiobookUI()).catch((err) => {
    console.error("\n  Fatal error:", err);
    process.exit(1);
  });
} else {
  runGame(new TerminalUI()).catch((err) => {
    console.error("\n  Fatal error:", err);
    process.exit(1);
  });
}
