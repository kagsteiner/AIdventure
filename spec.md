You are an expert software architect and developer.

Your task is to design and implement a **text-only AI powered interactive storytelling adventure engine**.

This is **not a traditional game with hardcoded story content**.
Instead, the system uses a Large Language Model (LLM) to dynamically create and evolve a fantasy world and story.

The result should be a **minimal but well-structured implementation** that can run locally.

---

# High Level Goal

Create a program that:

1. Generates a **complete fantasy world** using an LLM
2. Stores that world in structured files
3. Runs an **interactive game loop**
4. Lets the player interact with the world through text
5. Uses the LLM as a **Game Master**
6. Persists world state between turns
7. Produces **narrative text and optional ASCII art**

The system should feel like a **living fantasy novel that the player participates in**.

---

# Core Design Principles

The architecture must follow these principles:

### Persistent World

The world must not be regenerated every turn.

Instead store the world and story state in files:

/game
world.md – lore, geography, history
characters.json – characters and their goals
state.json – current world state
log.md – narrative history

The LLM reads these files to understand the current game state.

---

### Separation of Narrative and State

Narrative text and game state must be separate.

Narrative is written to:

log.md

Game mechanics update:

state.json

Example state:

{
"day": 2,
"location": "Ironwood Village",
"inventory": ["knife","torch"],
"active_quest": "Investigate the ruined tower"
}

---

### Structured LLM Responses

The LLM must always respond in structured JSON format:

{
"state_changes": {...},
"events": [...],
"ascii_art": "...",
"narrative": "...",
"choices": [...]
}

The program parses this and updates files accordingly.

---

### Memory Management

To avoid token explosion:

The LLM receives:

* world.md
* characters.json
* state.json
* last 10–20 log entries

Older narrative is summarized into summary.md.

---

# Required Components

Implement the following modules:

world_builder
Creates the initial world using the LLM.

game_master
Controls the narrative and NPC reactions.

state_manager
Reads and writes JSON game state.

memory_manager
Handles log trimming and summarization.

engine
Runs the interactive game loop.

---

# Game Loop

Each player turn must execute this pipeline:

1. Load world + characters + state
2. Load recent narrative history
3. Send context to LLM Game Master
4. Receive structured JSON response
5. Apply state updates
6. Append narrative to log.md
7. Display narrative + ASCII art
8. Ask player for input
9. Repeat

---

# Player Experience

The game runs in a terminal.

Example session:

You enter the tavern. A hooded figure watches you.

```
/\
```

| /  \    Frostmere Tavern |
| ------------------------ |

The smell of smoke fills the air.

What do you do?

1. Approach the hooded figure
2. Order a drink
3. Leave the tavern

>

The player may either choose a numbered option or type free text.

---

# Initial World Generation

At first launch:

The program calls the LLM to generate:

* world lore
* major regions
* factions
* important NPCs
* starting location
* initial quest

These are saved into the world files.

---

# Technical Requirements

Language: Node.js (JavaScript)

Structure:

/engine
engine.js
llm.js
world_builder.js
game_master.js
state_manager.js
memory_manager.js

/game
world.md
characters.json
state.json
log.md

The LLM API should be abstracted so it can be replaced easily.

---

# Implementation Constraints

The implementation should:

• be minimal but clean
• use readable code
• avoid unnecessary dependencies
• include comments explaining architecture
• be easy to extend later

---

# Output Format

Provide:

1. Project architecture explanation
2. All source code files
3. Example prompts used for the LLM
4. Instructions for running the program
5. Example gameplay transcript

---

# Goal

The finished result should produce a **playable AI-driven fantasy text adventure** where:

• the world evolves
• characters behave consistently
• the player influences the story
• the narrative feels like a living fantasy novel

ASCII art is optional but encouraged for locations, creatures, or maps.

Focus on **clarity, stability, and extensibility** rather than feature complexity.
