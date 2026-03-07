/**
 * Story Type Configurations
 *
 * Defines different genres/styles of adventures with their specific
 * prompts, tone guidance, and writing style instructions for the LLM.
 */

export const STORY_TYPES = {
  sanderson_fantasy: {
    name: "Sanderson-Style Fantasy",
    description: "Epic fantasy with intricate magic systems and complex worldbuilding",

    world_tone: `Create a Brandon Sanderson-style fantasy world with these characteristics:
- A HARD MAGIC SYSTEM with clear rules, costs, and limitations (think Allomancy, Surgebinding)
- Magic should feel like a science with discoverable principles
- Detailed worldbuilding with unique cultures, religions, and social structures
- Complex political intrigue and competing factions
- Characters who are clever and use magic creatively within its constraints
- Epic scope but grounded in personal struggles
- Mystery elements woven into the world's history and magic
- Consequences for magic use (physical, social, or both)`,

    narrative_style: `Write in Brandon Sanderson's style:
- Clear, accessible prose with occasional elegant turns of phrase
- Action sequences that are detailed and easy to visualize
- Magic use described with precision and internal consistency
- Characters who think through problems logically
- Reveal world details through action and dialogue, not exposition dumps
- Build tension through escalating stakes and clever problem-solving
- Include moments of wonder when magic does something impressive
- Balance epic moments with intimate character beats`,
  },

  tolkien_fantasy: {
    name: "Tolkien-Style Fantasy",
    description: "Classic high fantasy in the tradition of Middle-earth",

    world_tone: `Create a J.R.R. Tolkien-style fantasy world with these characteristics:
- Rich mythology and ancient history stretching back ages
- Multiple distinct races/peoples with their own languages and cultures
- A clear struggle between good and evil, light and darkness
- Magic that is rare, mysterious, and often subtle
- Deep connection to nature and the land itself
- Ancient artifacts and places of power with storied histories
- A sense of a fading golden age and creeping shadow
- Themes of sacrifice, courage, and fellowship`,

    narrative_style: `Write in J.R.R. Tolkien's style:
- Elevated, lyrical prose with archaic touches where appropriate
- Rich sensory descriptions of landscapes and environments
- A tone that balances the epic and the pastoral
- Songs, poetry, or fragments of lore woven into the narrative
- Evil depicted as corruption and decay, not mere brutality
- Heroism shown through moral choices as much as martial prowess
- A sense of deep history and weight to important moments
- Hope and beauty even in the darkest times`,
  },

  space_opera: {
    name: "Space Opera Sci-Fi",
    description: "Grand space adventure in the style of Hyperion Cantos or John Scalzi",

    world_tone: `Create a space opera universe with these characteristics:
- A vast galactic civilization spanning multiple worlds and species
- Advanced but comprehensible technology (FTL travel, AI, biotech, etc.)
- Complex interstellar politics, factions, and competing interests
- Ancient mysteries or precursor civilizations
- Questions of consciousness, identity, and what it means to be human
- Time dilation, relativistic effects, or other hard SF concepts used thoughtfully
- Diverse alien cultures with their own values and perspectives
- Technology that enables the plot but doesn't solve all problems
- Blend literary depth (Hyperion) with action and wit (Scalzi)`,

    narrative_style: `Write in the style of Dan Simmons (Hyperion) meets John Scalzi:
- Sharp, intelligent prose that moves quickly but carries depth
- Witty dialogue and internal monologue, especially in tense situations
- Vivid descriptions of alien worlds and cosmic vistas
- Technology described functionally without lengthy explanations
- Characters who are smart, resourceful, and often sarcastic
- Mix philosophical questions with action and adventure
- Multiple perspectives or frame narratives when appropriate
- Humor that doesn't undercut genuine stakes or emotion
- A sense of wonder at the vastness and strangeness of space`,
  },

  cosmic_horror: {
    name: "Cosmic Horror",
    description: "Creepy, unsettling tales in the style of Lovecraft and Stephen King",

    world_tone: `Create a world of cosmic horror with these characteristics:
- Reality is thinner and stranger than it appears
- Ancient, incomprehensible forces lurk at the edges of perception
- Knowledge itself can be dangerous or corrupting
- Small-town or isolated settings where strange things happen
- A sense that humanity is insignificant in the larger cosmos
- Gradual revelation of terrible truths
- The supernatural follows alien logic, not human morality
- Atmosphere of mounting dread and wrongness
- Combine Lovecraft's cosmic scope with King's human psychology and character work`,

    narrative_style: `Write in the style of H.P. Lovecraft meets Stephen King:
- Build atmosphere through accumulating detail and growing unease
- Start with the mundane before revealing the strange
- Use sensory details to evoke discomfort: wrong smells, unsettling textures, sounds that shouldn't be
- Suggest horror more than explicitly showing it at first
- Characters are ordinary people confronting the extraordinary
- Include visceral, grounded details (King) alongside cosmic dread (Lovecraft)
- Fear comes from loss of control and understanding
- Prose that becomes more fragmented or intense as horror escalates
- Things are worse than they first appear, and worse still when fully revealed
- Even small victories come at a cost`,
  },
};

/**
 * Get the list of story types for display in the menu.
 */
export function getStoryTypeMenu() {
  return Object.entries(STORY_TYPES).map(([key, config], index) => ({
    key,
    number: index + 1,
    name: config.name,
    description: config.description,
  }));
}

/**
 * Get a story type configuration by key.
 */
export function getStoryType(key) {
  return STORY_TYPES[key] || STORY_TYPES.sanderson_fantasy;
}
