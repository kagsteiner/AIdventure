/**
 * Game Engine
 *
 * Orchestrates the game loop: display → input → LLM → state update → repeat.
 * All I/O is delegated to a UI adapter (terminal, audiobook, etc.).
 */

import {
  worldExists,
  applyStateChanges,
  appendLog,
  appendStory,
  loadState,
  loadLastTurn,
  loadPendingTurn,
  savePendingTurn,
  clearPendingTurn,
  clearGameState,
  listWorldTemplates,
  loadWorldTemplate,
} from "./state_manager.js";
import { buildWorld, buildWorldFromTemplate, archiveWorldToTemplate } from "./world_builder.js";
import { processTurn } from "./game_master.js";
import { getStoryTypeMenu } from "./story_types.js";
import { updateArcAfterTurn } from "./arc_manager.js";

/**
 * Sentinel returned by UI adapters when the player requests a new story
 * (button click, spoken "new story", or typed "new story" / "start over").
 */
export const NEW_STORY_CMD = "__NEW_STORY__";

const NEW_STORY_PHRASES = new Set([
  "new story", "start new story", "new game", "start new game",
  "start over", "restart", "begin again",
]);

/**
 * Resolve player input: if it's a number, map to a choice.
 */
function resolveInput(input, choices) {
  const trimmed = input.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= choices.length) {
    return choices[num - 1];
  }
  return trimmed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPendingTurn(ui) {
  const pending = await loadPendingTurn();
  if (!pending) return;

  await ui.showThinking();
  if (ui.showMessage) {
    await ui.showMessage("The next scene is still being generated. Please wait a moment...");
  }

  while (await loadPendingTurn()) {
    await sleep(500);
  }
}

function buildStartModeMenu({ hasActiveWorld, worldTemplates }) {
  const items = [];
  if (hasActiveWorld) {
    items.push({
      key: "continue",
      number: items.length + 1,
      name: "Continue current adventure",
      description: "Resume the active game already stored in game/",
    });
  }
  items.push({
    key: "new_world",
    number: items.length + 1,
    name: "Start a new world",
    description: "Generate a completely new universe from one of the default story types",
  });
  if (worldTemplates.length > 0) {
    items.push({
      key: "known_world",
      number: items.length + 1,
      name: "Start in a known world",
      description: "Begin a fresh adventure in a world from your library",
    });
  }
  return items;
}

function buildWorldTemplateMenu(worldTemplates) {
  return worldTemplates.map((template, index) => ({
    key: template.id,
    number: index + 1,
    name: template.name,
    description: template.summary || `A reusable ${template.genre} world`,
  }));
}

async function archiveActiveWorld(ui) {
  if (!worldExists()) return;
  if (ui.showMessage) await ui.showMessage("Saving this world to your library...");
  const template = await archiveWorldToTemplate();
  if (template?.metadata?.name && ui.showMessage) {
    await ui.showMessage(`Saved world template: ${template.metadata.name}`);
  }
}

async function startFreshAdventure(ui, startMode, worldTemplates) {
  if (startMode === "known_world") {
    const worldChoice = await ui.selectWorldTemplate(buildWorldTemplateMenu(worldTemplates));
    const template = await loadWorldTemplate(worldChoice);
    if (!template) {
      throw new Error("Selected world template could not be loaded.");
    }
    return buildWorldFromTemplate(template);
  }

  const storyType = await ui.selectStoryType(getStoryTypeMenu());
  return buildWorld(storyType);
}

/**
 * Run the main game loop.
 * @param {object} ui - A UI adapter instance (TerminalUI, AudiobookUI, etc.)
 */
export async function runGame(ui) {
  await ui.showBanner();

  // Outer loop allows restarting without reconnecting.
  while (true) {
    let currentChoices = [];
    let restart = false;
    const hasActiveWorld = worldExists();
    const worldTemplates = await listWorldTemplates();

    if (hasActiveWorld) {
      await waitForPendingTurn(ui);
    }

    if (!hasActiveWorld && worldTemplates.length === 0) {
      await ui.showNoWorld();
      try {
        const opening = await buildWorld(await ui.selectStoryType(getStoryTypeMenu()));
        await ui.showScene(opening.narrative, opening.ascii_art, opening.choices);
        currentChoices = opening.choices;
      } catch (err) {
        await ui.showWorldError(err.message);
        ui.cleanup();
        return;
      }
    } else {
      if (!hasActiveWorld) {
        await ui.showNoWorld();
      }

      const startMode = await ui.selectStartMode(
        buildStartModeMenu({ hasActiveWorld, worldTemplates }),
      );

      if (startMode === "continue") {
        await ui.showResuming();
        await ui.showStatus();
        const lastTurn = await loadLastTurn();
        currentChoices = Array.isArray(lastTurn?.choices) ? lastTurn.choices : [];
        await ui.showResumeHint();
      } else {
        try {
          if (hasActiveWorld) {
            await archiveActiveWorld(ui);
            await clearGameState();
          }
          const opening = await startFreshAdventure(ui, startMode, worldTemplates);
          await ui.showScene(opening.narrative, opening.ascii_art, opening.choices);
          currentChoices = opening.choices;
        } catch (err) {
          await ui.showWorldError(err.message);
          ui.cleanup();
          return;
        }
      }
    }

    while (true) {
      await ui.showStatus();
      const rawInput = await ui.getPlayerInput();

      if (!rawInput || !rawInput.trim()) continue;

      const command = rawInput.trim().toLowerCase();

      if (command === "quit" || command === "exit") {
        await ui.showQuit();
        break;
      }

      // New story — wipe save data and restart from genre selection.
      if (rawInput.trim() === NEW_STORY_CMD || NEW_STORY_PHRASES.has(command)) {
        if (ui.showNewStory) await ui.showNewStory();
        if (worldExists()) {
          try {
            await archiveActiveWorld(ui);
          } catch (err) {
            await ui.showTurnError(`Could not save current world: ${err.message}`);
          }
        }
        await clearGameState();
        restart = true;
        break;
      }

      if (command === "status" || command === "stats") {
        const state = await loadState();
        await ui.showStateDebug(state);
        continue;
      }

      if (command === "inventory" || command === "inv" || command === "i") {
        const state = await loadState();
        await ui.showInventory(state?.inventory, state?.gold);
        continue;
      }

      if (command === "help" || command === "?") {
        await ui.showHelp();
        continue;
      }

      const action = resolveInput(rawInput, currentChoices);

      await ui.showThinking();
      await savePendingTurn({
        action,
        submitted_at: new Date().toISOString(),
      });

      try {
        const result = await processTurn(action);

        const currentState = await loadState();
        const mergedChanges = {
          ...result.state_changes,
          turn: (currentState?.turn || 0) + 1,
        };
        await applyStateChanges(mergedChanges);

        await appendLog(result.narrative);
        await appendStory(`> *${action}*\n\n${result.narrative}`);
        await ui.showScene(result.narrative, result.ascii_art, result.choices);
        await clearPendingTurn();
        currentChoices = result.choices;

        try {
          await updateArcAfterTurn(result.arc_status);
        } catch (arcErr) {
          console.error("[arc] Error updating arc:", arcErr.message);
        }
      } catch (err) {
        await clearPendingTurn();
        await ui.showTurnError(err.message);
      }
    }

    if (!restart) break;
  }

  ui.cleanup();
}
