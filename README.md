# AIdventure

An AI-powered interactive fantasy text adventure engine. The world, characters, and story are all dynamically generated and evolved by a Large Language Model acting as the Game Master.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure your API key
cp .env.example .env
# Edit .env and add your OpenAI API key

# 3. Play
npm start
```

## How It Works

On first launch the engine asks the LLM to create an entire fantasy world — lore, geography, factions, NPCs, and a starting quest. Everything is persisted to plain files in `game/`:

| File | Purpose |
|---|---|
| `world.md` | World lore, geography, history |
| `characters.json` | NPCs with goals and dispositions |
| `state.json` | Current game state (location, inventory, quest, etc.) |
| `log.md` | Narrative history |
| `summary.md` | Compressed summary of older events |

Each turn, the engine assembles context from these files, sends it to the LLM along with the player's action, and receives a structured JSON response containing narrative text, state changes, optional ASCII art, and suggested choices.

## Architecture

```
main.js                 Entry point
engine/
  engine.js             Game loop (display → input → LLM → update)
  llm.js                LLM abstraction layer (OpenAI-compatible)
  world_builder.js      Initial world generation
  game_master.js        Turn-by-turn narrative and state
  state_manager.js      File I/O for game state
  memory_manager.js     Log trimming and summarization
game/
  (generated at runtime)
```

## In-Game Commands

| Command | Action |
|---|---|
| `1`, `2`, `3`... | Choose a numbered option |
| Free text | Do anything you can describe |
| `inventory` / `i` | Check your belongings |
| `status` | View full game state |
| `help` / `?` | Show commands |
| `quit` | Save and exit |

Your progress is saved automatically. Run `npm start` again to resume.

## Configuration

Edit `.env` to customize:

- `OPENAI_API_KEY` — Your API key (required)
- `LLM_MODEL` — Model name (default: `gpt-4o`)
- `OPENAI_BASE_URL` — Custom API endpoint for local models, Azure, etc.

## Reset

To start a fresh world:

```bash
npm run reset
npm start
```

## Example Gameplay

```
  ╔══════════════════════════════════════════╗
  ║           A I d v e n t u r e            ║
  ║     AI-Powered Fantasy Text Adventure     ║
  ╚══════════════════════════════════════════╝

  No saved world found. Generating a new world...

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
