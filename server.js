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
import {
  getPendingTurnRecoveryStatus,
  startPendingTurnRecovery,
} from "./engine/recovery.js";

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

function isLoopbackAddress(ip = "") {
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

function requireAdmin(req, res, next) {
  const token = req.get("x-admin-token");
  const authorized = PASSWORD ? token === PASSWORD : isLoopbackAddress(req.ip);
  if (!authorized) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

app.get("/api/admin/pending-turn", requireAdmin, async (_req, res) => {
  res.json(await getPendingTurnRecoveryStatus());
});

app.post("/api/admin/retry-pending-turn", requireAdmin, async (_req, res) => {
  const result = await startPendingTurnRecovery();
  if (result.started) {
    console.log("[recovery] pending turn retry started");
  } else if (result.reason === "already_running") {
    console.log("[recovery] pending turn retry already running");
  } else {
    console.log("[recovery] no pending turn to retry");
  }
  res.json(result);
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Ping every connected client every 30s to keep the connection alive
// through nginx and other proxies that have idle timeouts.
const PING_INTERVAL = 30_000;
const pingTimer = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.ping();
  }
}, PING_INTERVAL);
wss.on("close", () => clearInterval(pingTimer));

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
