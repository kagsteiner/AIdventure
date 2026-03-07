/**
 * AIdventure — Entry Point
 * by Adrian Guzman and Seth Cates <-- haha this was AI generated, actually it is done by 
 * ChatGPT 5.4 and Karlheinz Agsteiner. But who might Adrian and Seth be? I don't know.
 * Loads environment variables and starts the game engine.
 */

import dotenv from "dotenv";
dotenv.config();

import { runGame } from "./engine/engine.js";

const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

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

runGame().catch((err) => {
  console.error("\n  Fatal error:", err);
  process.exit(1);
});
