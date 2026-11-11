// Snow crystal "species" - based on real snow crystal types.
// classify() turns the growth record of a crystal into one of these.

export const SPECIES = [
  {
    id: 'hex', name: 'Hexagonal Plate', rarity: 'Common',
    hint: 'Avoid the mists and fall through dry air.',
    fact: 'The simplest snow crystal: a flat six-sided prism. Every snowflake starts out as one.',
  },
  {
    id: 'star', name: 'Simple Star', rarity: 'Common',
    hint: 'Ride the mint Needle Drift.',
    fact: 'Thin, fast-growing arms form when the air is around -5 °C.',
  },
  {
    id: 'stellar', name: 'Stellar Plate', rarity: 'Common',
    hint: 'Mix lavender Plate Haze with a little Needle Drift.',
    fact: 'Broad, flat arms grow near -2 °C and -12 °C, in only moderately humid air.',
  },
  {
    id: 'sectored', name: 'Sectored Plate', rarity: 'Uncommon',
    hint: 'Spend a long time inside lavender Plate Haze.',
    fact: 'Ridges split each arm into flat sectors - a sign of slow, steady growth.',
  },
  {
    id: 'dendrite', name: 'Stellar Dendrite', rarity: 'Uncommon',
    hint: 'Fly through the blue Frost Mist.',
    fact: 'The classic "Christmas" snowflake. Side branches sprout at -15 °C in humid air.',
  },
  {
    id: 'mixed', name: 'Plate with Branches', rarity: 'Uncommon',
    hint: 'Plate Haze first, Frost Mist later.',
    fact: 'Its journey is written in ice: plates near the centre grew high up, branches near the tips grew lower down.',
  },
  {
    id: 'fern', name: 'Fernlike Dendrite', rarity: 'Rare',
    hint: 'Hug the bright heart of the Frost Mist.',
    fact: 'In very humid air, side branches grow side branches of their own - just like a fern leaf.',
  },
  {
    id: 'rimed', name: 'Rimed Crystal', rarity: 'Uncommon',
    hint: 'Drift through grey Cloud Droplets.',
    fact: 'Tiny supercooled water droplets froze onto it the moment they touched.',
  },
  {
    id: 'graupel', name: 'Graupel', rarity: 'Rare',
    hint: 'Soak up a LOT of Cloud Droplets.',
    fact: 'So heavily rimed that the crystal turned into a soft pellet of ice. It bounces when it lands!',
  },
  {
    id: 'rounded', name: 'Rounded Crystal', rarity: 'Common',
    hint: 'Brush through warm air... and survive.',
    fact: 'A brief warm spell softens the sharp edges. Its arms will never be as sharp again.',
  },
  {
    id: 'triangle', name: 'Triangular Crystal', rarity: 'Very rare',
    hint: 'Lose three arms - every second one.',
    fact: 'Real triangular snowflakes exist. Scientists are still not sure how they form.',
  },
  {
    id: 'twelve', name: 'Twelve-branched Star', rarity: 'Very rare',
    hint: 'Catch a golden Twin Spark early in your fall.',
    fact: 'Two six-armed crystals frozen together, rotated by 30 degrees.',
  },
  {
    id: 'perfect', name: 'Perfect Dendrite', rarity: 'Legendary',
    hint: 'A huge fern dendrite: all six arms intact, never touched warm air.',
    fact: 'Wilson Bentley photographed over 5,000 snowflakes on black velvet. He never found two alike.',
  },
];

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export function classify(st) {
  if (st.rime >= 75) return 'graupel';
  if (st.twin && st.R > 26) return 'twelve';
  if (st.broken === 3 && st.brokenIdx.every((i) => i % 2 === st.brokenIdx[0] % 2)) return 'triangle';
  if (st.rime >= 24) return 'rimed';
  if (st.melt >= 14) return 'rounded';
  if (st.nFern >= 10 && st.nB >= 12 && st.broken === 0 && st.R >= 112 && st.melt < 1) return 'perfect';
  if (st.nFern >= 3 && st.nB >= 5) return 'fern';
  if (st.plateFrac >= 0.3 && st.nB >= 4) return 'mixed';
  if (st.nB >= 4) return 'dendrite';
  if (st.plateFrac >= 0.55 && st.R >= 20) return 'sectored';
  if (st.plateFrac >= 0.22 && st.len >= 8) return 'stellar';
  if (st.len < 9 || (st.len < st.core * 1.4 && st.nB < 2)) return 'hex';
  return 'star';
}

/** Real snowflakes are roughly 0.5-5 mm across. */
export const diameterMM = (R) => (R * 2 * 0.022).toFixed(1);

export function beautyScore(st, landingMult = 1) {
  const size = Math.pow(Math.max(1, st.R), 1.25);
  const complexity = 1 + st.nB * 0.05 + st.nFern * 0.05 + st.plateFrac * 0.6 + (st.twin ? 0.6 : 0) + Math.min(0.4, st.rime * 0.004);
  const sym = Math.pow(st.sym, 2);
  const meltPenalty = 1 - Math.min(0.5, st.melt * 0.012);
  return Math.round(size * complexity * sym * meltPenalty * landingMult * 10);
}
