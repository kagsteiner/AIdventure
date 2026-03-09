/**
 * AIdventure — Web Server
 *
 * Serves the web client and manages WebSocket game sessions.
 * Each WebSocket connection gets its own game instance.
 */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { runGame } from "./engine/engine.js";
import { WebUI } from "./engine/ui/web_ui.js";

const PORT = parseInt(process.env.WEB_PORT, 10) || 3006;
const PASSWORD = process.env.WEB_PASSWORD || "";

const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}
if (provider === "openai" && !process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY is not set.");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY is required for web mode (TTS/STT).");
  process.exit(1);
}

const app = express();
app.use(express.static("web"));

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  if (PASSWORD) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (token !== PASSWORD) {
      ws.close(4001, "Unauthorized");
      return;
    }
  }

  console.log(`[session] connected (${wss.clients.size} active)`);

  const ui = new WebUI(ws);
  runGame(ui)
    .then(() => console.log("[session] game ended normally"))
    .catch((err) => {
      console.error("[session] game error:", err.message);
      try { ws.close(); } catch {}
    });

  ws.on("close", () => {
    console.log(`[session] disconnected (${wss.clients.size} active)`);
    ui.cleanup();
  });
});

server.listen(PORT, () => {
  console.log(`\n  AIdventure web server listening on http://localhost:${PORT}\n`);
});
