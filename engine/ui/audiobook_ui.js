/**
 * Audiobook UI Adapter
 *
 * Renders the game as an interactive audiobook using OpenAI TTS for narration
 * and OpenAI STT (Whisper) for voice input. Requires ffmpeg for microphone
 * recording (choco install ffmpeg / brew install ffmpeg / apt install ffmpeg).
 *
 * Press Enter during narration to skip. Push-to-talk for voice input.
 */

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { spawn, execSync } from "child_process";
import OpenAI from "openai";
import { loadState } from "../state_manager.js";

const MAX_TTS_CHARS = 4000;
const MAX_LINE_WIDTH = 110;

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function dim(text) {
  return `${DIM}${text}${RESET}`;
}
function cyan(text) {
  return `${CYAN}${text}${RESET}`;
}
function yellow(text) {
  return `${YELLOW}${text}${RESET}`;
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

function cleanTranscription(text) {
  return text.replace(/[.!?]+$/, "").trim();
}

function spawnPlayer(filePath) {
  if (process.platform === "darwin") {
    return spawn("afplay", [filePath]);
  }
  if (process.platform === "win32") {
    return spawn(
      "powershell",
      ["-NoProfile", "-c", `(New-Object System.Media.SoundPlayer '${filePath}').PlaySync()`],
      { stdio: "ignore" },
    );
  }
  return spawn("aplay", ["-q", filePath]);
}

/**
 * Detect the default microphone device name on Windows via ffmpeg.
 * Returns a cached result on subsequent calls.
 */
let _cachedWinMicDevice = undefined;
function detectWindowsMicDevice() {
  if (_cachedWinMicDevice !== undefined) return _cachedWinMicDevice;
  try {
    const out = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    let inAudio = false;
    for (const line of out.split("\n")) {
      if (line.includes("DirectShow audio devices")) { inAudio = true; continue; }
      if (line.includes("DirectShow video devices")) break;
      if (inAudio) {
        const m = line.match(/"([^"]+)"/);
        if (m && !line.includes("Alternative name")) {
          _cachedWinMicDevice = m[1];
          return _cachedWinMicDevice;
        }
      }
    }
  } catch {}
  _cachedWinMicDevice = null;
  return null;
}

function spawnRecorder(filePath) {
  const outArgs = ["-ar", "16000", "-ac", "1", "-y", filePath];
  if (process.platform === "win32") {
    const device = process.env.RECORD_DEVICE || detectWindowsMicDevice();
    if (!device) {
      throw new Error(
        "Could not detect a microphone. Set RECORD_DEVICE in .env to your mic name " +
        "(run: ffmpeg -list_devices true -f dshow -i dummy)"
      );
    }
    return spawn("ffmpeg", ["-f", "dshow", "-i", `audio=${device}`, ...outArgs],
      { stdio: ["pipe", "ignore", "pipe"] });
  }
  if (process.platform === "darwin") {
    return spawn("ffmpeg", ["-f", "avfoundation", "-i", ":default", ...outArgs],
      { stdio: ["pipe", "ignore", "pipe"] });
  }
  return spawn("ffmpeg", ["-f", "pulse", "-i", "default", ...outArgs],
    { stdio: ["pipe", "ignore", "pipe"] });
}

export class AudiobookUI {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.voice = process.env.TTS_VOICE || "nova";
    this.ttsStyle =
      process.env.TTS_STYLE ||
      "Speak as a dramatic audiobook narrator. Use a slow, atmospheric pace with expressive intonation. Pause briefly between paragraphs.";
    this.tmpDir = path.join(os.tmpdir(), "aidventure-audio");
    fs.mkdirSync(this.tmpDir, { recursive: true });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  // ---------------------------------------------------------------------------
  // Speech output
  // ---------------------------------------------------------------------------

  async speak(text) {
    if (!text || !text.trim()) return;

    if (text.length <= MAX_TTS_CHARS) {
      await this._speakChunk(text);
      return;
    }

    const paragraphs = text.split("\n\n");
    let chunk = "";
    for (const para of paragraphs) {
      if (chunk && chunk.length + para.length + 2 > MAX_TTS_CHARS) {
        await this._speakChunk(chunk);
        chunk = para;
      } else {
        chunk = chunk ? chunk + "\n\n" + para : para;
      }
    }
    if (chunk) await this._speakChunk(chunk);
  }

  async _speakChunk(text) {
    const audioPath = path.join(this.tmpDir, `tts-${Date.now()}.wav`);
    try {
      const response = await this.openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: this.voice,
        input: text,
        instructions: this.ttsStyle,
        response_format: "wav",
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(audioPath, buffer);
      await this._playWithInterrupt(audioPath);
    } finally {
      try {
        fs.unlinkSync(audioPath);
      } catch {}
    }
  }

  async _playWithInterrupt(filePath) {
    return new Promise((resolve) => {
      const player = spawnPlayer(filePath);
      let settled = false;

      const onLine = () => {
        if (!settled) {
          settled = true;
          player.kill();
        }
      };

      this.rl.once("line", onLine);

      player.on("error", (err) => {
        this.rl.removeListener("line", onLine);
        if (!settled) {
          settled = true;
          console.error(`  ${RED}Audio playback error: ${err.message}${RESET}`);
          resolve();
        }
      });

      player.on("close", () => {
        this.rl.removeListener("line", onLine);
        if (!settled) settled = true;
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Speech input
  // ---------------------------------------------------------------------------

  async listen() {
    console.log(cyan("\n  🎤  Press ENTER to start speaking..."));
    await this._waitForLine();

    const recordPath = path.join(this.tmpDir, `rec-${Date.now()}.wav`);

    let recorder;
    try {
      recorder = spawnRecorder(recordPath);
    } catch (err) {
      console.error(`\n  ${RED}${err.message}${RESET}`);
      console.log(yellow("  Type your action instead:"));
      return this._readLineInput();
    }

    console.log(cyan("  🔴  Recording — press ENTER when done"));

    let recorderFailed = false;
    let recorderStderr = "";
    recorder.on("error", (err) => {
      recorderFailed = true;
      if (err.code === "ENOENT") {
        console.error(
          `\n  ${RED}ffmpeg is not installed. Audiobook mode requires ffmpeg for microphone recording.${RESET}`,
        );
        console.error(
          `  ${DIM}Install: choco install ffmpeg (Win) | brew install ffmpeg (Mac) | apt install ffmpeg (Linux)${RESET}\n`,
        );
      } else {
        console.error(`  ${RED}Recording error: ${err.message}${RESET}`);
      }
    });
    if (recorder.stderr) {
      recorder.stderr.on("data", (d) => { recorderStderr += d.toString(); });
    }

    await this._waitForLine();

    // Gracefully stop ffmpeg so it writes a valid WAV header
    try { recorder.stdin.write("q"); } catch {}
    await new Promise((resolve) => {
      recorder.on("close", resolve);
      setTimeout(resolve, 2000);
    });

    if (recorderFailed || !fs.existsSync(recordPath)) {
      if (recorderStderr) console.error(dim(`  ffmpeg: ${recorderStderr.split("\n")[0]}`));
      console.log(yellow("  Could not record. Type your action instead:"));
      return this._readLineInput();
    }

    const stat = fs.statSync(recordPath);
    if (stat.size < 1000) {
      console.log(yellow("  Recording too short. Type your action instead:"));
      try { fs.unlinkSync(recordPath); } catch {}
      return this._readLineInput();
    }

    console.log(dim("  ⏳  Transcribing..."));

    try {
      const transcription = await this.openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: fs.createReadStream(recordPath),
      });

      const text = cleanTranscription(transcription.text || "");
      if (text) {
        console.log(`  📝  ${dim('"' + text + '"')}`);
      }
      return text;
    } catch (err) {
      console.error(`  ${RED}Transcription error: ${err.message}${RESET}`);
      console.log(yellow("  Type your action instead:"));
      return this._readLineInput();
    } finally {
      try { fs.unlinkSync(recordPath); } catch {}
    }
  }

  _waitForLine() {
    return new Promise((resolve) => {
      this.rl.once("line", () => resolve());
    });
  }

  _readLineInput() {
    return new Promise((resolve) => {
      this.rl.question("  > ", (answer) => resolve(answer));
    });
  }

  // ---------------------------------------------------------------------------
  // UI adapter methods
  // ---------------------------------------------------------------------------

  async showBanner() {
    console.log();
    console.log("  ╔══════════════════════════════════════════╗");
    console.log("  ║           A I d v e n t u r e            ║");
    console.log("  ║       Interactive Audiobook Mode          ║");
    console.log("  ╚══════════════════════════════════════════╝");
    console.log();
    console.log(dim("  Press ENTER at any time to skip narration."));
    console.log(dim("  Say 'quit' to end your adventure.\n"));

    await this.speak("Welcome to AIdventure. Your interactive audiobook awaits.");
  }

  async showScene(narrative, asciiArt, choices) {
    if (asciiArt) {
      console.log(dim(asciiArt));
      console.log();
    }

    console.log(dim(wordWrap(narrative)));
    console.log();

    let speechText = narrative;

    if (choices && choices.length > 0) {
      choices.forEach((c, i) => console.log(dim(`  ${i + 1}. ${c}`)));
      console.log();

      const formatted = choices.map((c, i) => `${i + 1}: ${c}`).join(". ");
      speechText += `\n\n${formatted}`;
    }

    await this.speak(speechText);
  }

  async showStatus(_stateOverride) {
    // Spoken status every turn would be intrusive. Say "status" to hear it.
  }

  async getPlayerInput() {
    while (true) {
      const text = await this.listen();
      if (text && text.trim()) return text.trim();
      await this.speak("I didn't catch that. Please try again.");
    }
  }

  async selectStoryType(menu) {
    console.log("\n  Select your adventure type:\n");
    menu.forEach((item) => {
      console.log(`    ${item.number}. ${item.name}`);
      console.log(`       ${item.description}\n`);
    });

    const menuText = menu
      .map((item) => `Option ${item.number}: ${item.name}. ${item.description}.`)
      .join(" ");
    await this.speak(`Choose your adventure type. ${menuText}`);

    while (true) {
      const input = await this.listen();
      if (!input || !input.trim()) continue;

      const clean = input.trim().toLowerCase().replace(/[.!?,]/g, "");

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

      await this.speak("I didn't catch your choice. Please say a number, like one, two, three, or four.");
    }
  }

  async showMessage(text) {
    console.log(`  ${text}`);
  }

  async showError(text) {
    console.error(`  ${RED}${text}${RESET}`);
  }

  async showThinking() {
    console.log(dim("\n  Weaving the next chapter...\n"));
  }

  async showNoWorld() {
    console.log("  No saved world found. Creating a new one...");
    await this.speak("No saved world found. Let us create a new adventure.");
  }

  async showResuming() {
    console.log("  Resuming your adventure...\n");
    await this.speak("Welcome back. Let us resume your adventure.");
  }

  async showResumeHint() {
    console.log(dim("  Speak your action to continue, or say 'quit' to exit.\n"));
  }

  async showQuit() {
    await this.speak("Your story pauses here. Until next time, adventurer.");
    console.log("\n  Your story pauses here. Until next time.\n");
  }

  async showWorldError(errorMessage) {
    console.error(`\n  ${RED}Failed to generate world: ${errorMessage}${RESET}`);
    console.error("  Check your .env file and API key.\n");
  }

  async showTurnError(errorMessage) {
    console.error(`\n  ${RED}LLM error: ${errorMessage}${RESET}`);
    await this.speak("Something went wrong with the story. Let's try again.");
  }

  async showInventory(inventory, gold) {
    const inv = inventory || [];
    const items = inv.length === 0 ? "nothing" : inv.join(", ");
    const text = gold !== undefined
      ? `You are carrying: ${items}. You have ${gold} gold.`
      : `You are carrying: ${items}.`;
    console.log(`  ${text}`);
    await this.speak(text);
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
    console.log(`  ${summary}`);
    await this.speak(summary);
  }

  async showHelp() {
    const text =
      "You can speak any action you want to take. " +
      "Say 'inventory' to check your belongings, " +
      "'status' to hear your current state, " +
      "or 'quit' to end the adventure.";
    console.log(`  ${text}`);
    await this.speak(text);
  }

  cleanup() {
    this.rl.close();
    try {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
