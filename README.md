# AIdventure

Remember "Adventure"? Or maybe Zork? The Infocom adventures? 

This node.js app creates such adventures. It is an experiment to see whether, with a bit of manual care, modern LLMs can generate text adventures and remember your decisions, the game state, without running into inconsistencies.

## What is it?

First: this is an experiment I did for myself. I do not intend to ever publish it. If you have node.js installed and API Tokens from Anthropic and OpenAI, you should have no trouble getting it to work. I actually do love it and use it a lot. But - see below - it's expensive.

An AI-powered interactive text adventure engine that supports multiple story genres and writing styles. The world, characters, and story are all dynamically generated and evolved by a Large Language Model acting as the Game Master.

Choose from several adventure types:
- **Sanderson-Style Fantasy** - Epic fantasy with intricate hard magic systems in the style of Brandon Sanderson
- **Tolkien-Style Fantasy** - Classic high fantasy with rich mythology in the tradition of Middle-earth
- **Space Opera Sci-Fi** - Grand galactic adventures in the style of Hyperion Cantos and John Scalzi
- **Cosmic Horror** - Creepy, unsettling tales blending H.P. Lovecraft and Stephen King
- **Historical Thriller** - Gripping thriller set in a real period of history, in the style of Umberto Eco, Ken Follett, and Robert Harris

Each genre comes with carefully crafted prompts that guide the LLM to write in the appropriate style, including the distinctive prose and worldbuilding approaches of these celebrated authors.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure your API key
cp .env.example .env
# Edit .env and add your OpenAI API key and/or your anthropic API key and decide what provider and model to use. anthropic / claude-opus-4-6 is highly recommended.

# 3. Play
npm start
```

## How It Works

### Starting and continuing

- **No save yet, empty world library:** You pick a story type (fantasy, sci-fi, or horror). The LLM creates a full world — lore, geography, factions, NPCs, and a starting quest — in that style.
- **No save but you already have worlds in the library:** You see **How would you like to begin?** — either generate a **completely new universe** (same as above) or **Start in a known world**: the LLM opens a *new* adventure in an existing setting (fresh hook and quest, same canon), using a stored template under `worlds/`.
- **Save present:** You can **Continue** the game in `game/`, or start fresh; starting fresh **archives** the current run into the library (see below) before the new world is built.

Audiobook and web UIs follow the same flow.

### World library (reusing a setting)

When you start a new story (typed **new story**, or choosing a fresh start from the menu), the engine asks the LLM to distill the adventure you are leaving into a **reusable world template**: stable lore, character roster, and a canon summary of what happened. That template is saved under `worlds/` (each world has its own folder plus a shared `index.json` for the menu). The next time you pick **Start in a known world**, the LLM uses that template as source of truth and generates a new opening — like a new book in the same universe, without assuming the player saw the earlier run.

### Game files

Everything for the **active** session lives in plain files under `game/`:

| File | Purpose |
|---|---|
| `world.md` | World lore, geography, history |
| `characters.json` | NPCs with goals and dispositions |
| `state.json` | Current game state (location, inventory, quest, etc.) |
| `log.md` | Narrative history (for the model context) |
| `summary.md` | Compressed summary of older events |
| `story.md` | Full transcript of the playthrough (markdown, including your actions) |

There are also small JSON sidecars for the last scene/turn and optional TTS cache under `game/`; you normally do not edit these by hand.

Each turn, the engine assembles context from these files, sends it to the LLM along with the player's action, and receives a structured JSON response containing narrative text, state changes, optional ASCII art, and suggested choices.

## Audiobook Mode

Play the game as an **interactive audiobook** — the story is narrated aloud, and your actions are captured via microphone and transcribed to text.

### Setup

1. Ensure you have an `OPENAI_API_KEY` in your `.env` (required for audiobook TTS and transcription, regardless of `LLM_PROVIDER`)
2. Install [ffmpeg](https://ffmpeg.org) for microphone recording:
   - **Windows:** `choco install ffmpeg` or `winget install ffmpeg`
   - **macOS:** `brew install ffmpeg`
   - **Linux:** `apt install ffmpeg`
3. Set `UI_MODE=audiobook` in your `.env`
4. Optionally configure voice and style:
   - `TTS_VOICE` — choose a narrator voice (`nova`, `onyx`, `fable`, `shimmer`, etc.)
   - `TTS_STYLE` — custom narration instructions

### How It Works

- The story is read aloud using OpenAI TTS (`gpt-4o-mini-tts`)
- **Press Enter** during narration to skip ahead
- When prompted, **press Enter** to start recording, then **Enter** again when finished
- Audio from the microphone is transcribed using OpenAI STT (`gpt-4o-mini-transcribe`)
- Suggested actions are narrated, but you can describe any action — you are not limited to those options
- There is **no always-listening hands-free mode**; each utterance is an explicit record-then-send step (same idea as push-to-talk).
- If recording fails, you can type your action as a fallback

### Phrase shortcuts (audiobook)

These phrases work as game commands: `quit`, `inventory`, `status`, `help`, or **`new story`** (archives the current world and returns to the start menu).

## Web Mode (Play from Your Phone)

Run AIdventure as a **web server** and play from your iPhone or any browser — with optional TTS narration and typed input.

### Quick Start (Local)

```bash
# In .env, set:
UI_MODE=web

# Then:
npm start
# Open http://localhost:3006 in your browser (or WEB_PORT if customized)
```

### VPS Deployment

1. Clone the repo on your VPS, run `npm install`, configure `.env` with `UI_MODE=web`
2. Set up **nginx** as a reverse proxy with **Let's Encrypt** SSL (use HTTPS when exposing the app publicly):

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # AIdventure — use your chosen path and WEB_PORT (default 3006)
    location /aidventure/ {
        proxy_pass http://127.0.0.1:3006/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # World generation can take several minutes; avoid 1-min timeout
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

3. Keep the server running with PM2: `pm2 start main.js`
4. Set `WEB_PASSWORD` in `.env` to protect access (optional)

### How It Works

- The game engine runs on the server; the browser is a thin client
- Story text is displayed on screen; use **Narrate** (where shown) on any scene to hear the AI narrator (OpenAI TTS)
- Type your action in the text field and send, or tap a suggested action card to choose it directly
- No ffmpeg needed on your phone — narration audio is generated on the server

## Architecture

```
main.js                 Entry point (terminal/audiobook modes)
server.js               Web server (Express + WebSocket)
web/
  index.html            Mobile-first web client
  app.js                Client JavaScript (WebSocket, MediaRecorder)
  style.css             Dark-themed responsive styles
engine/
  engine.js             Game loop (display → input → LLM → update; start menus, new story)
  ui/
    terminal_ui.js      Retro terminal interface (ASCII art + readline)
    audiobook_ui.js     Audiobook interface (TTS narration + voice input)
    web_ui.js           Web interface (WebSocket + server-side TTS)
  llm.js                LLM abstraction layer (OpenAI-compatible)
  story_types.js        Genre configurations and writing style prompts
  world_builder.js      World generation from scratch and from library templates; archive to template
  game_master.js        Turn-by-turn narrative and state
  state_manager.js      File I/O for game state and world library (worlds/)
  memory_manager.js     Log trimming and summarization
game/
  (active save: generated at runtime)
worlds/
  index.json            Library index for "Start in a known world" menu entries
  <id>/                 Per-world template: metadata.json, world.md, characters.json, canon.md
```

## In-Game Commands

| Command | Action |
|---|---|
| `1`, `2`, `3`... | Choose a numbered option |
| Free text | Do anything you can describe |
| `inventory` / `i` | Check your belongings |
| `status` | View full game state |
| `help` / `?` | Show commands |
| `new story` / `start over` / … | Archive current world to `worlds/`, clear `game/`, show start menu again |
| `quit` | Save and exit |

Your progress is saved automatically. Run `npm start` again to resume.

## Configuration

Edit `.env` to customize:

- `OPENAI_API_KEY` — Your OpenAI API key (required for openai provider and audiobook mode)
- `ANTHROPIC_API_KEY` — Your Anthropic API key (required for anthropic provider)
- `LLM_PROVIDER` — `anthropic` (default) or `openai`. Both models must be from the same provider.
- `LLM_MODEL` — Model for initial story/world building (default: `claude-opus-4-0-20250514` / `gpt-4o`). A thinking-capable model is recommended for this complex initial task.
- `LLM_GAMELOOP_MODEL` — Model for the game loop and summarization (optional). Falls back to `LLM_MODEL` if not set. Use a cheaper model here to save cost, e.g. `claude-sonnet-4-6`.
- `OPENAI_BASE_URL` — Custom API endpoint for local models, Azure, etc. (never tested this)
- `UI_MODE` — `terminal` (default), `audiobook`, or `web`
- `WEB_PORT` — Port for web server mode (default: `3006`)
- `WEB_PASSWORD` — Optional password to protect the web interface
- `TTS_VOICE` — Voice for audiobook narration (default: `nova`). Options: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse
- `TTS_STYLE` — Custom narration style instruction for TTS
- `RECORD_DEVICE` — Microphone device name override for Windows (auto-detected if omitted; run `ffmpeg -list_devices true -f dshow -i dummy` to list devices)

## Reset

To clear the **active** save in `game/` (without deleting your **world library** in `worlds/`):

```bash
npm run reset
npm start
```

The reset script removes the main persistence files (`world.md`, `characters.json`, `state.json`, `log.md`, `summary.md`, `story.md`). If anything odd still resumes, delete the rest of `game/` manually (e.g. `last_*.json`, `pending_turn.json`, `tts_cache/`).

## Example Gameplay

```
  ╔══════════════════════════════════════════╗
  ║           A I d v e n t u r e            ║
  ║     AI-Powered Text Adventure            ║
  ╚══════════════════════════════════════════╝

  No saved world found. Generating a new world...
  (If you already have templates under worlds/, you will first see how to begin:
  new universe vs. known world.)

  Select your adventure type:

    1. Sanderson-Style Fantasy
       Epic fantasy with intricate magic systems and complex worldbuilding

    2. Tolkien-Style Fantasy
       Classic high fantasy in the tradition of Middle-earth

    3. Space Opera Sci-Fi
       Grand space adventure in the style of Hyperion Cantos or John Scalzi

    4. Cosmic Horror
       Creepy, unsettling tales in the style of Lovecraft and Stephen King

    5. Historical Thriller
       Gripping thriller set in a real period of history, with accurate period detail

  Choose (1-5): 1

  Weaving the threads of a new world...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      /\      /\
     /  \    /  \
    / __ \  / __ \     Thornhaven
   /\/  \/\/  \/\     ~ Trading Post ~
  /              \
  ________________

You step off the dust-caked road into the shade of Thornhaven's
eastern gate. The settlement clings to the edge of the Whispering
Barrens like a barnacle on a hull...

──────────────────────────────────────────────────

  1. Approach the notice board near the gate
  2. Head to the tavern for information
  3. Explore the market stalls
  4. Ask a guard about recent events

> 2
```

# Warning, expensive!

With Anthropics claude-opus-4-6 for world generation and Sonnet 4.6 for gameplay, you get to spend money fairly fast. An hour in my adventure (that is one page of reading, then deciding what to do, maybe 5 to 10 minutes each) costs about 100k input tokens and 10k output tokens, or about a dollar.

I found it worth it.
