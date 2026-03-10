/**
 * Game Engine
 *
 * Orchestrates the game loop: display → input → LLM → state update → repeat.
 * All I/O is delegated to a UI adapter (terminal, audiobook, etc.).
 */

import { worldExists, applyStateChanges, appendLog, appendStory, loadState, clearGameState } from "./state_manager.js";
import { buildWorld } from "./world_builder.js";
import { processTurn } from "./game_master.js";
import { getStoryTypeMenu } from "./story_types.js";

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

    if (!worldExists()) {
      await ui.showNoWorld();
      const menu = getStoryTypeMenu();
      const storyType = await ui.selectStoryType(menu);
      try {
        const opening = await buildWorld(storyType);
        await ui.showScene(opening.narrative, opening.ascii_art, opening.choices);
        currentChoices = opening.choices;
      } catch (err) {
        await ui.showWorldError(err.message);
        ui.cleanup();
        return;
      }
    } else {
      await ui.showResuming();
      await ui.showStatus();
      await ui.showResumeHint();
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

      try {
        const result = await processTurn(action);

        if (Object.keys(result.state_changes).length > 0) {
          await applyStateChanges(result.state_changes);
        }

        await appendLog(result.narrative);
        await appendStory(`> *${action}*\n\n${result.narrative}`);
        await ui.showScene(result.narrative, result.ascii_art, result.choices);
        currentChoices = result.choices;
      } catch (err) {
        await ui.showTurnError(err.message);
      }
    }

    if (!restart) break;
  }

  ui.cleanup();
}
