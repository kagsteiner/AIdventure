# Genre Guide

AIdventure now supports multiple story types with genre-specific worldbuilding and narrative styles.

## Available Story Types

### 1. Sanderson-Style Fantasy
**Epic fantasy with intricate magic systems**

Inspired by Brandon Sanderson's work, this genre features:
- Hard magic systems with clear rules and limitations (like Allomancy or Surgebinding)
- Magic as a discoverable science with costs and consequences
- Complex worldbuilding with unique cultures and political structures
- Characters who solve problems through clever use of magic within constraints
- Clear, accessible prose with detailed action sequences
- Mystery elements woven into the world's history

### 2. Tolkien-Style Fantasy
**Classic high fantasy in the tradition of Middle-earth**

Following J.R.R. Tolkien's approach:
- Rich mythology and ancient history spanning ages
- Multiple distinct peoples with their own languages and cultures
- Clear struggle between good and evil
- Magic that is rare, mysterious, and subtle
- Deep connection to nature and the land
- Elevated, lyrical prose with archaic touches
- Songs, poetry, and fragments of lore
- Themes of sacrifice, courage, and fellowship

### 3. Space Opera Sci-Fi
**Grand galactic adventures**

In the style of Dan Simmons' Hyperion Cantos and John Scalzi:
- Vast galactic civilization spanning multiple worlds and species
- Advanced but comprehensible technology (FTL, AI, biotech)
- Complex interstellar politics and factions
- Ancient mysteries and precursor civilizations
- Questions of consciousness, identity, and humanity
- Sharp, intelligent prose with wit and humor
- Vivid descriptions of alien worlds and cosmic vistas
- Philosophical depth mixed with action and adventure

### 4. Cosmic Horror
**Creepy, unsettling tales**

Blending H.P. Lovecraft and Stephen King:
- Reality is thinner and stranger than it appears
- Ancient, incomprehensible forces at the edges of perception
- Knowledge that can be dangerous or corrupting
- Small-town or isolated settings
- Humanity's insignificance in the larger cosmos
- Atmospheric prose building dread through detail
- Gradual revelation of terrible truths
- Ordinary people confronting the extraordinary
- Mix of cosmic dread and visceral, grounded horror

## How It Works

### Story Selection
When starting a new game, players choose their preferred story type. This choice affects:

1. **World Generation**: The initial world/universe is built according to genre conventions
2. **Narrative Style**: All prose follows the writing style of the associated authors
3. **Tone and Atmosphere**: The overall feel matches the genre expectations
4. **Magic/Technology Systems**: Appropriate to the genre (hard magic vs. soft magic vs. tech vs. supernatural)

### Technical Implementation

The genre system is implemented through:

- **`engine/story_types.js`**: Defines each genre with specific prompts
  - `world_tone`: Instructions for worldbuilding
  - `narrative_style`: Instructions for prose style and pacing

- **`engine/world_builder.js`**: Generates initial world using genre-specific prompts

- **`engine/game_master.js`**: Processes each turn using genre-appropriate narrative style

- **State persistence**: The selected genre is saved in `game/state.json` and used consistently throughout the adventure

### Adding New Genres

To add a new story type:

1. Add a new entry to `STORY_TYPES` in `engine/story_types.js`
2. Include both `world_tone` and `narrative_style` instructions
3. Consider specific authors or works that exemplify the style
4. The system will automatically pick up the new genre in the selection menu

## Examples of Genre Differences

### Opening for Sanderson Fantasy
*"You draw a bead of metal from the vial at your belt, swallowing it in one practiced motion. The familiar burn of pewter ignites in your stomach, and suddenly your muscles sing with borrowed strength..."*

### Opening for Tolkien Fantasy
*"Long have you walked the winding roads of Eriador, and longer still lie the shadows that stretch from the Misty Mountains. In this twilit hour, you stand before the weathered gates of Bree, where the lamps of Men kindle against the encroaching dark..."*

### Opening for Space Opera
*"The transit needle punches through realspace with its usual nauseating lurch. Through the viewport, Covenant Station hangs against the orange glow of the gas giant like a chandelier made of ships, habitats, and centuries of accumulated orbital junk. Your neural interface chirps—you've got seven priority messages and a warrant for your arrest. Must be Tuesday."*

### Opening for Cosmic Horror
*"The town of Millbrook shouldn't exist. Not anymore. Not after what happened in '47. But here it is, clinging to the Maine coast like a barnacle on a rotting hull. The fog rolls in thick tonight, and somewhere in its depths, you hear something that might be singing. It's not a human voice."*

## Writing Quality

All genres use the same sophisticated prompting techniques to ensure:
- Consistent world logic and character behavior
- Meaningful choices with consequences
- Rich sensory detail and atmosphere
- Appropriate pacing and tension
- Style that genuinely reflects the target authors

The system emphasizes **showing over telling**, maintaining **internal consistency**, and respecting the **established rules** of each genre.
