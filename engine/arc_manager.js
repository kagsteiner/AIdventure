/**
 * Arc Manager
 *
 * Manages the story arc — a dramatic structure that guides the narrative
 * across the full span of an adventure. Uses the strategic model (Opus)
 * for arc generation and revision, while the game-loop model (Sonnet)
 * executes individual turns guided by "director's notes."
 *
 * The arc is flexible: phases describe dramatic beats (tone, escalation,
 * revelations) rather than specific plot points, so the game master can
 * adapt to player choices while maintaining narrative shape.
 */

import { queryLLM } from "./llm.js";
import {
  loadStoryArc,
  saveStoryArc,
  loadWorld,
  loadCharacters,
  loadState,
} from "./state_manager.js";
import { getFullMemoryContext } from "./memory_manager.js";

const DEFAULT_PHASE_COUNT = 5;
const OVERSHOOT_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Arc generation (called once after world creation — uses Opus)
// ---------------------------------------------------------------------------

/**
 * Generate the initial story arc after world creation.
 *
 * @param {string} worldLore
 * @param {Array} characters
 * @param {object} startingState
 * @param {string} openingNarrative
 * @param {string} storyType
 * @returns {object} The persisted arc
 */
export async function generateInitialArc(
  worldLore,
  characters,
  startingState,
  openingNarrative,
  storyType,
) {
  console.log("  Designing the story arc...\n");

  const systemPrompt = buildArcGenerationSystemPrompt(storyType);
  const userPrompt = buildArcGenerationUserPrompt(
    worldLore,
    characters,
    startingState,
    openingNarrative,
  );

  const result = await queryLLM(systemPrompt, userPrompt); // gameloop=false → Opus

  const arc = {
    dramatic_question: result.dramatic_question,
    phases: result.phases || [],
    planted_seeds: result.planted_seeds || [],
    current_phase: 1,
    phase_turns: 0,
    total_turns: 0,
    last_revised_at_turn: 0,
  };

  await saveStoryArc(arc);
  return arc;
}

// ---------------------------------------------------------------------------
// Director's Note (injected into Sonnet's context each turn)
// ---------------------------------------------------------------------------

/**
 * Build a director's note from the current arc state.
 * Returns a formatted string, or empty string if no arc exists.
 */
export async function getDirectorNote() {
  const arc = await loadStoryArc();
  if (!arc || !arc.phases?.length) return "";

  const phase = arc.phases[arc.current_phase - 1];
  if (!phase) return "";

  const totalPhases = arc.phases.length;
  const phaseTurns = arc.phase_turns || 0;
  const totalTurns = arc.total_turns || 0;

  const seedsToActivate = (arc.planted_seeds || [])
    .filter((s) => s.payoff_phase === arc.current_phase)
    .map((s) => s.seed);

  const seedsToPlant = phase.seeds_to_plant || [];

  let note = `## Story Direction (Director's Note)

You are in Phase ${arc.current_phase} of ${totalPhases}: "${phase.name}"
Turn ${phaseTurns + 1} of this phase (target: ${phase.target_turns_min}-${phase.target_turns_max} turns).
Overall story turn: ${totalTurns + 1}.

Dramatic question: ${arc.dramatic_question}

### Current Phase Guidance
${phase.description}

- **Tone**: ${phase.tone}
- **Escalation**: ${phase.escalation}
- **Key developments to push toward**: ${(phase.key_developments || []).join("; ")}`;

  if (seedsToPlant.length > 0) {
    note += `\n- **Seeds to plant** (introduce naturally): ${seedsToPlant.join("; ")}`;
  }
  if (seedsToActivate.length > 0) {
    note += `\n- **Seeds to activate** (planted earlier — start paying them off): ${seedsToActivate.join("; ")}`;
  }
  if (phase.do_not) {
    note += `\n- **Do NOT**: ${phase.do_not}`;
  }

  if (phaseTurns >= (phase.target_turns_min || 4)) {
    note += `\n\nYou have reached the minimum turns for this phase. When the dramatic beat has landed, signal phase completion via arc_status.phase_complete.`;
  }

  return note;
}

// ---------------------------------------------------------------------------
// Post-turn arc update (called after every turn)
// ---------------------------------------------------------------------------

/**
 * Update arc counters after a turn and check whether revision is needed.
 *
 * @param {object|undefined} arcStatus - The arc_status from Sonnet's response
 * @returns {{ revised: boolean, phaseAdvanced: boolean }}
 */
export async function updateArcAfterTurn(arcStatus) {
  const arc = await loadStoryArc();
  if (!arc) return { revised: false, phaseAdvanced: false };

  arc.total_turns = (arc.total_turns || 0) + 1;
  arc.phase_turns = (arc.phase_turns || 0) + 1;

  const phase = arc.phases?.[arc.current_phase - 1];
  let phaseAdvanced = false;
  let revised = false;

  if (arcStatus?.phase_complete && arc.current_phase < arc.phases.length) {
    arc.current_phase += 1;
    arc.phase_turns = 0;
    phaseAdvanced = true;
  }

  const needsRevision = arcStatus?.needs_revision || false;
  const phaseOvershoot =
    phase &&
    arc.phase_turns >
      (phase.target_turns_max || 10) * OVERSHOOT_MULTIPLIER;

  if (needsRevision || phaseOvershoot) {
    const reason = needsRevision
      ? arcStatus.revision_reason || "Player diverged from the planned arc"
      : `Phase ${arc.current_phase} exceeded ${OVERSHOOT_MULTIPLIER}x its target turns`;

    console.log(`  Revising the story direction... (${reason})\n`);
    await reviseArc(arc, reason);
    revised = true;
  } else {
    await saveStoryArc(arc);
  }

  return { revised, phaseAdvanced };
}

// ---------------------------------------------------------------------------
// Arc revision (rare — calls Opus to rewrite remaining phases)
// ---------------------------------------------------------------------------

async function reviseArc(currentArc, reason) {
  const [worldLore, characters, state, memory] = await Promise.all([
    loadWorld(),
    loadCharacters(),
    loadState(),
    getFullMemoryContext(),
  ]);

  const systemPrompt = buildRevisionSystemPrompt();
  const userPrompt = buildRevisionUserPrompt(
    currentArc,
    worldLore,
    characters,
    state,
    memory,
    reason,
  );

  const result = await queryLLM(systemPrompt, userPrompt); // gameloop=false → Opus

  const completedPhases = currentArc.phases.slice(0, currentArc.current_phase - 1);
  const newPhases = result.phases || [];

  const revisedArc = {
    ...currentArc,
    dramatic_question: result.dramatic_question || currentArc.dramatic_question,
    planted_seeds: result.planted_seeds || currentArc.planted_seeds,
    phases: [...completedPhases, ...newPhases],
    last_revised_at_turn: currentArc.total_turns,
  };

  await saveStoryArc(revisedArc);
  return revisedArc;
}

// ---------------------------------------------------------------------------
// Prompt builders — arc generation
// ---------------------------------------------------------------------------

function buildArcGenerationSystemPrompt(storyType) {
  return `You are a master story architect for interactive fiction.
You have just created a world and its opening scene. Now design the dramatic arc that will give this story shape, tension, and a satisfying climax.

Design a ${DEFAULT_PHASE_COUNT}-phase story arc. Each phase describes a DRAMATIC BEAT — its emotional function, tone, and what should escalate — not specific plot events. A separate game master AI will find the specific events that fit the player's actual choices.

Phase structure guide:
- Phase 1 (The Hook): Establish the world, introduce the central tension, plant seeds for later. The player is finding their footing.
- Phase 2 (Rising Action): Deepen mysteries, introduce complications, raise personal stakes. Alliances form and fray.
- Phase 3 (The Midpoint Shift): A major revelation or reversal that reframes everything the player thought they knew. The story pivots here.
- Phase 4 (Escalation): Pace quickens, threats converge, allies are tested or lost. No easy way out.
- Phase 5 (The Climax): All threads converge. The dramatic question is answered. The ultimate test.

Genre: ${storyType}

Design the arc to feel inevitable in retrospect but surprising in the moment. Plant seeds early that pay off later. Let betrayals earn their impact through setup. The climax should emerge from everything that came before.

You MUST respond with a JSON object:
{
  "dramatic_question": "The single driving question of the entire story",
  "phases": [
    {
      "phase": 1,
      "name": "Short evocative name",
      "description": "2-3 sentences describing what this phase accomplishes dramatically. Focus on emotional trajectory and narrative function, NOT specific plot events.",
      "target_turns_min": 4,
      "target_turns_max": 8,
      "tone": "The emotional texture and atmosphere",
      "escalation": "What gets worse, more urgent, or more complex",
      "key_developments": ["Broad dramatic developments — flexible enough that different player paths can reach them"],
      "seeds_to_plant": ["Things to introduce here that pay off in later phases"],
      "seeds_to_activate": [],
      "do_not": "What to avoid in this phase to preserve the impact of later phases"
    }
  ],
  "planted_seeds": [
    {
      "seed": "Brief description of the narrative seed",
      "planted_in_phase": 1,
      "payoff_phase": 3,
      "description": "How this seed connects to the larger story"
    }
  ]
}`;
}

function buildArcGenerationUserPrompt(
  worldLore,
  characters,
  startingState,
  openingNarrative,
) {
  return `Design a story arc for this world and opening:

## World Lore
${worldLore}

## Characters
${JSON.stringify(characters, null, 2)}

## Starting State
${JSON.stringify(startingState, null, 2)}

## Opening Scene
${openingNarrative}

Create a compelling ${DEFAULT_PHASE_COUNT}-phase dramatic arc that builds on the world's existing tensions, character goals, and the seeds already planted in the opening.`;
}

// ---------------------------------------------------------------------------
// Prompt builders — arc revision
// ---------------------------------------------------------------------------

function buildRevisionSystemPrompt() {
  return `You are a master story architect revising the remaining arc of an interactive fiction adventure.

The player has taken the story in an unexpected direction, or the current phase has dragged beyond its target. Redesign the REMAINING phases to:

- Honor everything that has already happened as canon
- Incorporate the player's actual choices and trajectory
- Maintain dramatic tension and build toward a satisfying climax
- Preserve or adapt planted seeds where possible; abandon them gracefully if not
- Keep the remaining story purposeful, not padded

Do NOT rewrite completed phases — only redesign from the current phase onward.
The total number of remaining phases may change by one if the story warrants it, but aim for roughly the same total length.

Respond with a JSON object:
{
  "dramatic_question": "The central question (update if the story has evolved)",
  "phases": [
    {
      "phase": 3,
      "name": "...",
      "description": "...",
      "target_turns_min": 4,
      "target_turns_max": 8,
      "tone": "...",
      "escalation": "...",
      "key_developments": ["..."],
      "seeds_to_plant": ["..."],
      "seeds_to_activate": ["..."],
      "do_not": "..."
    }
  ],
  "planted_seeds": [
    {
      "seed": "...",
      "planted_in_phase": 1,
      "payoff_phase": 4,
      "description": "..."
    }
  ]
}`;
}

function buildRevisionUserPrompt(
  currentArc,
  worldLore,
  characters,
  state,
  memory,
  reason,
) {
  const completedPhases = currentArc.phases.slice(0, currentArc.current_phase - 1);
  const remainingPhases = currentArc.phases.slice(currentArc.current_phase - 1);

  return `Revise the story arc. Here is the full context:

## Revision Reason
${reason}

## Current Arc State
- Current phase: ${currentArc.current_phase} of ${currentArc.phases.length}
- Turns in current phase: ${currentArc.phase_turns}
- Total turns played: ${currentArc.total_turns}
- Original dramatic question: ${currentArc.dramatic_question}

## Completed Phases (DO NOT modify — these are history)
${JSON.stringify(completedPhases, null, 2)}

## Phases to Revise (current phase onward)
${JSON.stringify(remainingPhases, null, 2)}

## Original Planted Seeds
${JSON.stringify(currentArc.planted_seeds, null, 2)}

## World Lore
${worldLore}

## Characters
${JSON.stringify(characters, null, 2)}

## Current Game State
${JSON.stringify(state, null, 2)}

## Story So Far
${memory}

Redesign phases ${currentArc.current_phase} through the end to create the best possible remaining story from here.`;
}
