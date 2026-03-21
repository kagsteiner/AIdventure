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
import crypto from "crypto";
import OpenAI from "openai";
import { loadState, PATHS, loadLastTurn, saveLastTurn } from "../state_manager.js";
import { NEW_STORY_CMD } from "../engine.js";

const MAX_TTS_CHARS = 4000;

const LANG_ISO = {
  english: "en", german: "de", french: "fr", spanish: "es",
  italian: "it", portuguese: "pt", dutch: "nl", polish: "pl",
  russian: "ru", japanese: "ja", chinese: "zh", korean: "ko",
  swedish: "sv", norwegian: "no", danish: "da", finnish: "fi",
};

function langToISO(lang) {
  return LANG_ISO[lang.toLowerCase()] || null;
}

function buildTtsStyle() {
  const base =
    process.env.TTS_STYLE ||
    "Speak as a dramatic audiobook narrator. Use a slow, atmospheric pace with expressive intonation. Pause briefly between paragraphs.";
  const lang = process.env.GAME_LANGUAGE || "English";
  if (lang.toLowerCase() === "english") return base;
  return `${base} The text is in ${lang}. Speak with a native ${lang} accent and pronunciation.`;
}

function makeTurnId() {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** OpenAI `gpt-4o-mini-tts` voices the browser may select (see OpenAI TTS docs). */
const OPENAI_TTS_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
]);

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export class WebUI {
  constructor(ws) {
    this.ws = ws;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.voice = process.env.TTS_VOICE || "nova";
    this.ttsStyle = buildTtsStyle();
    this.tmpDir = path.join(os.tmpdir(), `aidventure-web-${Date.now()}`);
    fs.mkdirSync(this.tmpDir, { recursive: true });
    fs.mkdirSync(PATHS.ttsCacheDir, { recursive: true });
    this._closed = false;

    // Persistent queue so messages (especially new_story) aren't lost
    // while the engine is busy processing a turn.
    this._msgQueue = [];
    this._msgResolve = null;

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === "voicePreference" && typeof msg.voice === "string") {
          const v = msg.voice.trim().toLowerCase();
          if (OPENAI_TTS_VOICES.has(v)) this.voice = v;
          return;
        }
        if (msg?.type === "transcribeAudio" && msg.data) {
          this._handleTranscriptionRequest(msg).catch(() => {});
          return;
        }
        if (msg?.type === "synthesizeText" && msg.text) {
          this._handleSynthesisRequest(msg).catch(() => {});
          return;
        }
        if (this._msgResolve) {
          const res = this._msgResolve;
          this._msgResolve = null;
          res(msg);
        } else {
          this._msgQueue.push(msg);
        }
      } catch {}
    });

    this.ws.on("close", () => {
      this._closed = true;
      if (this._msgResolve) {
        const res = this._msgResolve;
        this._msgResolve = null;
        res(null);
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
    if (this._msgQueue.length > 0) return Promise.resolve(this._msgQueue.shift());
    return new Promise((resolve) => {
      this._msgResolve = resolve;
    });
  }

  // ---------------------------------------------------------------------------
  // TTS
  // ---------------------------------------------------------------------------

  async _generateTTS(text) {
    if (!text || !text.trim()) return null;

    const cacheKey = crypto
      .createHash("sha1")
      .update(JSON.stringify({
        voice: this.voice,
        style: this.ttsStyle,
        text,
      }))
      .digest("hex");
    const cachePath = path.join(PATHS.ttsCacheDir, `${cacheKey}.mp3`);

    try {
      if (fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath).toString("base64");
      }
    } catch {}

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
    try {
      fs.writeFileSync(cachePath, combined);
    } catch {}
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
      const sttParams = {
        model: "gpt-4o-mini-transcribe",
        file: fs.createReadStream(tmpFile),
      };
      const sttLang = langToISO(process.env.GAME_LANGUAGE || "English");
      if (sttLang) sttParams.language = sttLang;
      const transcription = await this.openai.audio.transcriptions.create(sttParams);
      return (transcription.text || "").replace(/[.!?]+$/, "").trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  async _handleTranscriptionRequest(msg) {
    try {
      const text = await this._transcribe(msg.data);
      this._send({ type: "transcriptionResult", requestId: msg.requestId || null, text });
    } catch (err) {
      this._send({
        type: "transcriptionResult",
        requestId: msg.requestId || null,
        error: `Transcription failed: ${err.message}`,
      });
    }
  }

  async _handleSynthesisRequest(msg) {
    try {
      const audio = await this._generateTTS(msg.text);
      this._send({ type: "ttsResult", requestId: msg.requestId || null, audio });
    } catch (err) {
      this._send({
        type: "ttsResult",
        requestId: msg.requestId || null,
        error: `Speech generation failed: ${err.message}`,
      });
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
    const msg = {
      type: "scene",
      turnId: makeTurnId(),
      narrative,
      asciiArt: asciiArt || null,
      choices: choices || [],
      audio,
    };
    this._send(msg);
    // Persist for reconnect replay (audio already generated — no re-cost on reconnect)
    try {
      await fs.promises.writeFile(PATHS.lastScene, JSON.stringify(msg));
    } catch {}
    try {
      await saveLastTurn({
        turnId: msg.turnId,
        narrative: msg.narrative,
        asciiArt: msg.asciiArt,
        choices: msg.choices,
        audio: msg.audio,
      });
    } catch {}
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

      if (msg.type === "new_story") return NEW_STORY_CMD;

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
    return this._selectMenu("Choose Your Adventure", "Choose your adventure type.", menu);
  }

  async selectStartMode(menu) {
    return this._selectMenu("Choose How To Begin", "How would you like to begin?", menu);
  }

  async selectWorldTemplate(menu) {
    return this._selectMenu("Choose A Known World", "Choose a known world.", menu);
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
    // Replay the last scene immediately (file read is instant; audio was already generated)
    try {
      const lastTurn = await loadLastTurn();
      if (lastTurn) this._send({ ...lastTurn, type: "replay" });
    } catch {}
    this._send({ type: "message", text: "Resuming your adventure..." });
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

  async showNewStory() {
    const audio = await this._generateTTS("Starting a new adventure. Prepare yourself.");
    this._send({ type: "newStory", text: "Starting a new adventure...", audio });
  }

  async showHelp() {
    const text =
      "You can speak or type any action you want. " +
      "Say 'inventory' to check your belongings, " +
      "'status' to hear your current state, " +
      "'new story' to begin a fresh adventure, " +
      "or 'quit' to end the adventure.";
    const audio = await this._generateTTS(text);
    this._send({ type: "message", text, audio });
  }

  cleanup() {
    this._closed = true;
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch {}
  }

  async _selectMenu(heading, spokenLead, menu) {
    const items = menu.map((m) => ({
      key: m.key,
      number: m.number,
      name: m.name,
      description: m.description,
    }));
    const menuText = menu.map((m) => `Option ${m.number}: ${m.name}.${m.description ? ` ${m.description}.` : ""}`).join(" ");
    const audio = await this._generateTTS(`${spokenLead} ${menuText}`);
    this._send({ type: "menu", heading, items, audio });

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
          const choice = this._resolveMenuChoice(text, menu);
          if (choice) return choice;
        } catch {}
      }

      const retryAudio = await this._generateTTS("I didn't catch your choice. Please say a number or tap an option.");
      this._send({ type: "message", text: "Please choose one of the available options.", audio: retryAudio });
    }
  }

  _resolveMenuChoice(text, menu) {
    if (!text) return null;
    const clean = text.toLowerCase().replace(/[.!?,]/g, "");
    const num = parseInt(clean, 10);
    if (num >= 1 && num <= menu.length) return menu[num - 1].key;

    for (const [word, n] of Object.entries(NUMBER_WORDS)) {
      if (clean.includes(word) && n <= menu.length) return menu[n - 1].key;
    }

    for (const item of menu) {
      const haystacks = [item.name, item.description || ""]
        .join(" ")
        .toLowerCase()
        .split(/[\s-]+/);
      if (haystacks.some((kw) => kw.length > 3 && clean.includes(kw))) return item.key;
    }

    return null;
  }
}
