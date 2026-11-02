/** Placeholder AI pixel sprites — replace with human-made art before public launch. */

export const FISH_SPRITE_FILES = [
  'pink-guppy',
  'golden-fish',
  'blue-angel',
  'clown-stripe',
  'purple-deep',
  'green-stripe',
  'pearl-white',
  'coral-red'
] as const;

export type FishSpriteId = (typeof FISH_SPRITE_FILES)[number];

/** Map API species ids → sliced sprite filenames. */
export const SPECIES_SPRITE: Record<string, FishSpriteId> = {
  'lily-guppy': 'pink-guppy',
  'sand-dart': 'golden-fish',
  'amber-loach': 'golden-fish',
  'aurora-koi': 'golden-fish',
  'pebble-minnow': 'blue-angel',
  'mist-tetra': 'blue-angel',
  'moon-scale': 'pearl-white',
  'copper-fin': 'clown-stripe',
  'coral-wisp': 'coral-red',
  'reed-perch': 'green-stripe',
  'jade-veil': 'green-stripe',
  'abyss-lantern': 'purple-deep'
};

export function spriteUrlForSpecies(speciesId: string): string {
  const id = SPECIES_SPRITE[speciesId] ?? FISH_SPRITE_FILES[hashSpecies(speciesId) % FISH_SPRITE_FILES.length];
  return `/assets/fish/${id}.png`;
}

function hashSpecies(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
