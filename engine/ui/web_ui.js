/**
 * Web UI Adapter
 *
 * Bridges the game engine to a browser client over WebSocket.
 * TTS and STT happen server-side via OpenAI; audio is sent as
 * base64-encoded MP3/M4A inside JSON messages.
 */

import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import { loadState } from "../state_manager.js";

const MAX_TTS_CHARS = 4000;

export class WebUI {
  constructor(ws) {
    this.ws = ws;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.voice = process.env.TTS_VOICE || "nova";
    this.ttsStyle =
      process.env.TTS_STYLE ||
      "Speak as a dramatic audiobook narrator. Use a slow, atmospheric pace with expressive intonation. Pause briefly between paragraphs.";
    this.tmpDir = path.join(os.tmpdir(), `aidventure-web-${Date.now()}`);
    fs.mkdirSync(this.tmpDir, { recursive: true });
    this._closed = false;
    this._pendingResolve = null;

    this.ws.on("close", () => {
      this._closed = true;
      if (this._pendingResolve) {
        this._pendingResolve(null);
        this._pendingResolve = null;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Transport helpers
  // ---------------------------------------------------------------------------

  _send(msg) {
    if (!this._closed && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _waitForMessage() {
    if (this._closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._pendingResolve = resolve;
      const handler = (raw) => {
        this._pendingResolve = null;
        try { resolve(JSON.parse(raw.toString())); }
        catch { resolve(null); }
      };
      this.ws.once("message", handler);
    });
  }

  // ---------------------------------------------------------------------------
  // TTS
  // ---------------------------------------------------------------------------

  async _generateTTS(text) {
    if (!text || !text.trim()) return null;

    const chunks = this._splitForTTS(text);
    const buffers = [];
    for (const chunk of chunks) {
      const response = await this.openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: this.voice,
        input: chunk,
        instructions: this.ttsStyle,
        response_format: "mp3",
      });
      buffers.push(Buffer.from(await response.arrayBuffer()));
    }

    const combined = Buffer.concat(buffers);
    return combined.toString("base64");
  }

  _splitForTTS(text) {
    if (text.length <= MAX_TTS_CHARS) return [text];
    const paragraphs = text.split("\n\n");
    const chunks = [];
    let current = "";
    for (const para of paragraphs) {
      if (current && current.length + para.length + 2 > MAX_TTS_CHARS) {
        chunks.push(current);
        current = para;
      } else {
        current = current ? current + "\n\n" + para : para;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  // ---------------------------------------------------------------------------
  // STT
  // ---------------------------------------------------------------------------

  async _transcribe(base64Audio) {
    const tmpFile = path.join(this.tmpDir, `stt-${Date.now()}.m4a`);
    try {
      fs.writeFileSync(tmpFile, Buffer.from(base64Audio, "base64"));
      const transcription = await this.openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: fs.createReadStream(tmpFile),
      });
      return (transcription.text || "").replace(/[.!?]+$/, "").trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  // ---------------------------------------------------------------------------
  // UI adapter methods
  // ---------------------------------------------------------------------------

  async showBanner() {
    const audio = await this._generateTTS("Welcome to AIdventure. Your interactive audiobook awaits.");
    this._send({ type: "banner", audio });
  }

  async showScene(narrative, asciiArt, choices) {
    let speechText = narrative;
    if (choices && choices.length > 0) {
      speechText += "\n\n" + choices.map((c, i) => `${i + 1}: ${c}`).join(". ");
    }
    const audio = await this._generateTTS(speechText);
    this._send({ type: "scene", narrative, asciiArt: asciiArt || null, choices: choices || [], audio });
  }

  async showStatus() {
    const state = await loadState();
    if (!state) return;
    this._send({ type: "status", state });
  }

  async getPlayerInput() {
    while (true) {
      this._send({ type: "inputRequest" });
      const msg = await this._waitForMessage();

      if (!msg || this._closed) throw new Error("Client disconnected");

      if (msg.type === "text") {
        const text = (msg.text || "").trim();
        if (text) return text;
      }

      if (msg.type === "audio" && msg.data) {
        try {
          const text = await this._transcribe(msg.data);
          if (text) {
            this._send({ type: "transcription", text });
            return text;
          }
        } catch (err) {
          this._send({ type: "error", text: `Transcription failed: ${err.message}` });
        }
      }

      const audio = await this._generateTTS("I didn't catch that. Please try again.");
      this._send({ type: "message", text: "I didn't catch that. Please try again.", audio });
    }
  }

  async selectStoryType(menu) {
    const items = menu.map((m) => ({ key: m.key, number: m.number, name: m.name, description: m.description }));
    const menuText = menu.map((m) => `Option ${m.number}: ${m.name}. ${m.description}.`).join(" ");
    const audio = await this._generateTTS(`Choose your adventure type. ${menuText}`);
    this._send({ type: "menu", items, audio });

    while (true) {
      const msg = await this._waitForMessage();
      if (!msg || this._closed) throw new Error("Client disconnected");

      if (msg.type === "menuChoice") {
        const idx = parseInt(msg.index, 10);
        if (idx >= 0 && idx < menu.length) return menu[idx].key;
      }

      if (msg.type === "audio" && msg.data) {
        try {
          const text = await this._transcribe(msg.data);
          if (text) {
            const clean = text.toLowerCase().replace(/[.!?,]/g, "");
            const num = parseInt(clean, 10);
            if (num >= 1 && num <= menu.length) return menu[num - 1].key;

            const numberWords = { one: 1, two: 2, three: 3, four: 4 };
            for (const [word, n] of Object.entries(numberWords)) {
              if (clean.includes(word) && n <= menu.length) return menu[n - 1].key;
            }
            for (const item of menu) {
              const keywords = item.name.toLowerCase().split(/[\s-]+/);
              if (keywords.some((kw) => kw.length > 3 && clean.includes(kw))) return item.key;
            }
          }
        } catch {}
      }

      const retryAudio = await this._generateTTS("I didn't catch your choice. Please say a number or tap an option.");
      this._send({ type: "message", text: "Please select an adventure type.", audio: retryAudio });
    }
  }

  async showMessage(text) {
    this._send({ type: "message", text });
  }

  async showError(text) {
    this._send({ type: "error", text });
  }

  async showThinking() {
    this._send({ type: "thinking" });
  }

  async showNoWorld() {
    const audio = await this._generateTTS("No saved world found. Let us create a new adventure.");
    this._send({ type: "message", text: "No saved world found. Creating a new one...", audio });
  }

  async showResuming() {
    const audio = await this._generateTTS("Welcome back. Let us resume your adventure.");
    this._send({ type: "message", text: "Resuming your adventure...", audio });
  }

  async showResumeHint() {
    this._send({ type: "message", text: "Speak or type your action to continue." });
  }

  async showQuit() {
    const audio = await this._generateTTS("Your story pauses here. Until next time, adventurer.");
    this._send({ type: "quit", text: "Your story pauses here. Until next time.", audio });
  }

  async showWorldError(errorMessage) {
    this._send({ type: "error", text: `Failed to generate world: ${errorMessage}` });
    throw new Error(`World generation failed: ${errorMessage}`);
  }

  async showTurnError(errorMessage) {
    const audio = await this._generateTTS("Something went wrong with the story. Let's try again.");
    this._send({ type: "error", text: `LLM error: ${errorMessage}`, audio });
  }

  async showInventory(inventory, gold) {
    const inv = inventory || [];
    const items = inv.length === 0 ? "nothing" : inv.join(", ");
    const text = gold !== undefined
      ? `You are carrying: ${items}. You have ${gold} gold.`
      : `You are carrying: ${items}.`;
    const audio = await this._generateTTS(text);
    this._send({ type: "message", text, audio });
  }

  async showStateDebug(state) {
    const parts = [];
    if (state?.location) parts.push(`You are at ${state.location}`);
    if (state?.sub_location) parts.push(state.sub_location);
    if (state?.day) parts.push(`day ${state.day}`);
    if (state?.time_of_day) parts.push(state.time_of_day);
    if (state?.health) parts.push(`health: ${state.health}`);
    if (state?.gold !== undefined) parts.push(`${state.gold} gold`);
    if (state?.inventory?.length) parts.push(`carrying: ${state.inventory.join(", ")}`);

    const summary = parts.length > 0 ? parts.join(". ") + "." : "No status available.";
    const audio = await this._generateTTS(summary);
    this._send({ type: "message", text: summary, audio });
  }

  async showHelp() {
    const text =
      "You can speak or type any action you want. " +
      "Say 'inventory' to check your belongings, " +
      "'status' to hear your current state, " +
      "or 'quit' to end the adventure.";
    const audio = await this._generateTTS(text);
    this._send({ type: "message", text, audio });
  }

  cleanup() {
    this._closed = true;
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch {}
  }
}
