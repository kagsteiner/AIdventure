# AIdventure

Remember "Adventure"? Or maybe Zork? The Infocom adventures? 

This node.js app creates such adventures. It is an experiment to see whether, with a bit of manual care, modern LLMs can generate text adventures and remember your decisions, the game state, without running into inconsistencies.

## What is it?

An AI-powered interactive fantasy text adventure engine. The world, characters, and story are all dynamically generated and evolved by a Large Language Model acting as the Game Master.

In my first tests with claude-opus-4-6, I was very impressed by the insane yet believable story the LLM can create.

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

- `OPENAI_API_KEY` — Your OpenAI API key (required for openai provider)
- `ANTHROPIC_API_KEY` — Your Anthropic API key (required for anthropic provider)
- `LLM_PROVIDER` — `anthropic` (default) or `openai`. Both models must be from the same provider.
- `LLM_MODEL` — Model for initial story/world building (default: `claude-opus-4-0-20250514` / `gpt-4o`). A thinking-capable model is recommended for this complex initial task.
- `LLM_GAMELOOP_MODEL` — Model for the game loop and summarization (optional). Falls back to `LLM_MODEL` if not set. Use a cheaper model here to save cost, e.g. `claude-sonnet-4-6`.
- `OPENAI_BASE_URL` — Custom API endpoint for local models, Azure, etc. (never tested this)

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

# Warning, expensive!

With Anthropics claude-opus-4-6, you get to spend money fairly fast. Ten steps in my adventure (that is one page of reading, then deciding what to do, maybe 5 to 10 minutes each) costs about 100k input tokens and 10k output tokens, or about a dollar.

I found it worth it.

