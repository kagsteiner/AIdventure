import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function withTempWorkspace(run) {
  const previousCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidventure-worlds-"));

  try {
    process.chdir(tempDir);
    const moduleUrl = pathToFileURL(path.resolve(previousCwd, "engine/state_manager.js")).href;
    const stateManager = await import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
    await run({ tempDir, stateManager });
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("saveWorldTemplate persists library metadata and content", async () => {
  await withTempWorkspace(async ({ stateManager }) => {
    const template = await stateManager.saveWorldTemplate({
      world: "# Elder Sea\n\nA world of stormlit archipelagos.",
      canon: "## Canon\n\nThe tide courts fell after the glass war.",
      characters: [{ name: "Mira", role: "navigator" }],
      metadata: {
        id: "elder-sea-abc12345",
        name: "Elder Sea",
        genre: "space_opera",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastPlayedAt: "2026-01-02T00:00:00.000Z",
        sourceStoryType: "space_opera",
        summary: "A storm-wracked setting of shattered fleets and ancient machine tides.",
        sourceHash: "abc12345",
      },
    });

    assert.equal(template.metadata.name, "Elder Sea");

    const worlds = await stateManager.listWorldTemplates();
    assert.equal(worlds.length, 1);
    assert.equal(worlds[0].id, "elder-sea-abc12345");
    assert.equal(worlds[0].summary, template.metadata.summary);

    const loaded = await stateManager.loadWorldTemplate("elder-sea-abc12345");
    assert.equal(loaded.metadata.genre, "space_opera");
    assert.match(loaded.world, /stormlit archipelagos/);
    assert.equal(loaded.characters[0].name, "Mira");
  });
});

test("archiveCurrentWorld deduplicates identical source worlds", async () => {
  await withTempWorkspace(async ({ stateManager }) => {
    await stateManager.saveWorld("# Dawn Archive\n\nThe world remembers in crystal.");
    await stateManager.saveCharacters([{ name: "Tarin", role: "keeper" }]);
    await stateManager.saveState({
      genre: "sanderson_fantasy",
      location: "The Dawn Archive",
    });
    await stateManager.appendStory("# AIdventure\n\nA keeper opened the crystal vault.");

    const first = await stateManager.archiveCurrentWorld({
      world: "# Dawn Archive\n\nReusable lore.",
      canon: "## Canon\n\nThe vault was opened once.",
      characters: [{ name: "Tarin", role: "keeper" }],
      metadata: {
        name: "Dawn Archive",
        genre: "sanderson_fantasy",
        sourceStoryType: "sanderson_fantasy",
        summary: "A crystalline world where memory is stored in living vaults.",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await stateManager.archiveCurrentWorld({
      world: "# Dawn Archive\n\nDifferent wording should be ignored for duplicates.",
      canon: "## Canon\n\nA conflicting canon text should not create a second world.",
      characters: [{ name: "Tarin", role: "keeper" }],
      metadata: {
        name: "Dawn Archive Revised",
        genre: "sanderson_fantasy",
        sourceStoryType: "sanderson_fantasy",
        summary: "Another summary",
      },
    });

    const worlds = await stateManager.listWorldTemplates();
    assert.equal(worlds.length, 1);
    assert.equal(first.metadata.id, second.metadata.id);
    assert.ok(Date.parse(second.metadata.lastPlayedAt) >= Date.parse(first.metadata.lastPlayedAt));
  });
});
