/** AI-backed voxel glTF fish (non-monetized; original species — no Pokémon IP). */

export const FISH_GLB_FILES = ['coral-bit', 'aqua-block', 'pearl-voxel'] as const;

export type FishGlbId = (typeof FISH_GLB_FILES)[number];

/** Map API species ids → shipped glTF models (3 hero meshes). */
export const SPECIES_GLB: Record<string, FishGlbId> = {
  'lily-guppy': 'coral-bit',
  'coral-wisp': 'coral-bit',
  'copper-fin': 'coral-bit',
  'pebble-minnow': 'aqua-block',
  'mist-tetra': 'aqua-block',
  'reed-perch': 'aqua-block',
  'jade-veil': 'aqua-block',
  'sand-dart': 'pearl-voxel',
  'amber-loach': 'pearl-voxel',
  'moon-scale': 'pearl-voxel',
  'aurora-koi': 'pearl-voxel',
  'abyss-lantern': 'aqua-block',
  // hero ids if ever rolled directly
  'coral-bit': 'coral-bit',
  'aqua-block': 'aqua-block',
  'pearl-voxel': 'pearl-voxel'
};

export function glbUrlForSpecies(speciesId: string): string {
  const id = SPECIES_GLB[speciesId] ?? FISH_GLB_FILES[hashSpecies(speciesId) % FISH_GLB_FILES.length];
  return `/assets/fish/${id}.glb`;
}

function hashSpecies(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
