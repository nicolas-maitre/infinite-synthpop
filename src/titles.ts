/**
 * Song titles, one generator per genre (genres.ts `title`). Each draws only from the "title" stream
 * it is given, so titles never change the music, and the same seed always gets the same title.
 */
import type { Rng } from "./rng";

// ── Synthpop ──────────────────────────────────────────────────────────────────────────────────

const ADJECTIVES = [
  "Electric",
  "Silent",
  "Blue",
  "Cold",
  "Broken",
  "Neon",
  "Distant",
  "Restless",
  "Endless",
  "Paper",
  "Velvet",
  "Crystal",
  "Hollow",
  "Northern",
  "Midnight",
  "Secret",
  "Fragile",
  "Burning",
  "Perfect",
];
const NOUNS = [
  "Machine",
  "Promise",
  "Signal",
  "Confession",
  "Weather",
  "Station",
  "Kingdom",
  "Mirror",
  "Fever",
  "Shadow",
  "Summer",
  "Distance",
  "Heaven",
  "Motion",
  "Language",
  "Ritual",
  "Harbour",
  "Empire",
];
const ELEMENTS = [
  "Glass",
  "Rain",
  "Steel",
  "Smoke",
  "Gold",
  "Ice",
  "Fire",
  "Light",
  "Dust",
  "Silence",
  "Thunder",
  "Wire",
  "Static",
  "Chrome",
];
const PLACES = ["World", "City", "Age", "Land", "Night", "House", "Sea"];

/** Synthpop: cold and moody, after the British and German records (the third pattern is shaped
 * like "The Different Story (World of Lust and Crime)"). */
export function synthpopTitle(rng: Rng): string {
  const pattern = rng.int(0, 3);
  let title: string;
  if (pattern === 0) title = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 1) title = `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
  else if (pattern === 2) {
    const a = rng.pick(ELEMENTS);
    let b = rng.pick(ELEMENTS);
    if (b === a) b = rng.pick(ELEMENTS);
    title = `${rng.pick(NOUNS)} (${rng.pick(PLACES)} of ${a} and ${b})`;
  } else title = `${rng.pick(NOUNS)} ${rng.pick(["Of", "In", "For"])} ${rng.pick(NOUNS)}`;
  if (rng.chance(0.2)) title += rng.pick([" (12″ Mix)", " (Extended)", " (Dub)"]);
  return title;
}

// ── Italo disco and Euro-disco ────────────────────────────────────────────────────────────────

// Warmer and more romantic: night, love and names, imperatives sung to someone, compound "concept"
// nouns, a little Italian, and English that's sometimes slightly off (after "The Night", "Get
// Closer", "Self Control", "Crazy Juliet", "Innocent Love", "Touch in the Night", "Love Spy").

const NIGHT_NOUNS = ["Night", "Rain", "Dream", "Moon", "Heat", "Fire", "Stranger", "Game"];
const VERBS = ["Get", "Hold", "Touch", "Call", "Take", "Kiss", "Save", "Show", "Give", "Feel"];
const OBJECTS = [
  "Me Tonight",
  "Closer",
  "Me Now",
  "My Heart",
  "the Night",
  "Your Love",
  "Me Again",
  "Me Higher",
  "the Fire",
];
const NAME_ADJECTIVES = ["Crazy", "Lonely", "Sweet", "Little", "Pretty", "Wild", "Lady", "Dear"];
const NAMES = [
  "Juliet",
  "Maria",
  "Diana",
  "Angela",
  "Monica",
  "Sylvia",
  "Johnny",
  "Romeo",
  "Lucia",
];
const LOVE_ADJECTIVES = [
  "Innocent",
  "Endless",
  "Secret",
  "Midnight",
  "Electric",
  "Dangerous",
  "Magic",
  "Tender",
  "Crazy",
  "Foolish",
];
const LOVE_NOUNS = ["Love", "Heart", "Lover", "Kiss", "Dancer", "Eyes"];
const IN_THE = ["Touch", "Lovers", "Dancing", "Heartbeat", "Shadows", "Strangers", "Fire", "Tears"];
const SETTINGS = ["Night", "Rain", "Dark", "Moonlight", "City", "Fire", "Wind"];
const CONCEPTS = ["Love", "Space", "Future", "Time", "Body", "Heart", "Night", "Star", "Cyber"];
const DEVICES = ["Machine", "Control", "Lover", "Spy", "Fever", "Dancer", "Game", "Station", "Boy"];
/** Correct Italian, so no generated agreement mistakes. */
const ITALIAN = [
  "Amore Mio",
  "Bella Notte",
  "Notte Blu",
  "Dolce Estate",
  "Stella d'Amore",
  "Luna Nuova",
  "Ciao Ciao Amore",
  "Ancora Tu",
  "Notte Magica",
];
const SHOUTS = ["Hey", "Go", "Run", "Oh", "Bye", "Stop"];

/** Italo disco and Euro-disco: love, night and names, sung in English that's not quite native. */
export function italoTitle(rng: Rng): string {
  const pattern = rng.weighted<number>([
    [0, 2], // The Night
    [1, 3], // Get Closer
    [2, 2], // Crazy Juliet
    [3, 3], // Innocent Love
    [4, 2], // Touch in the Night
    [5, 2], // Self Control, Love Spy
    [6, 1], // Amore Mio
    [7, 0.5], // Hey! Hey! Hey!
  ]);
  let title: string;
  if (pattern === 0) title = `The ${rng.pick(NIGHT_NOUNS)}`;
  else if (pattern === 1) title = `${rng.pick(VERBS)} ${rng.pick(OBJECTS)}`;
  else if (pattern === 2) title = `${rng.pick(NAME_ADJECTIVES)} ${rng.pick(NAMES)}`;
  else if (pattern === 3) title = `${rng.pick(LOVE_ADJECTIVES)} ${rng.pick(LOVE_NOUNS)}`;
  else if (pattern === 4) {
    const what = rng.pick(IN_THE);
    let where = rng.pick(SETTINGS);
    if (where === what) where = "Night";
    title = `${what} in the ${where}`;
  } else if (pattern === 5) {
    const a = rng.pick(CONCEPTS);
    let b = rng.pick(DEVICES);
    if (b === a) b = "Machine";
    title = `${a} ${b}`;
  } else if (pattern === 6) title = rng.pick(ITALIAN);
  else {
    const shout = rng.pick(SHOUTS);
    title = `${shout}! ${shout}! ${shout}!`;
  }
  // Maxi singles came in several cuts, named on the sleeve.
  if (rng.chance(0.25))
    title += rng.pick([" (Extended Version)", " (Maxi Version)", " (Vocal)", " (Remix)"]);
  return title;
}

const CAN_WAIT = ["Heaven", "Paradise", "Tomorrow", "Forever", "Midnight", "Romance", "Destiny"];
const SECRET_ADJECTIVES = [
  "Innocent",
  "Everlasting",
  "Secret",
  "Silent",
  "Hidden",
  "Forbidden",
  "Fragile",
  "Precious",
  "Stolen",
];
const SECRET_NOUNS = ["Love", "Land", "Heart", "Dreams", "Mirrors", "Island", "Desire", "Promise"];
const SANDRA_ADJECTIVES = ["Crazy", "Little", "Lonely", "Poor", "Dancing", "Pretty", "Silly"];
const SANDRA_NAMES = [
  "Loreen",
  "Magdalena",
  "Isabel",
  "Carmen",
  "Angelina",
  "Marlene",
  "Josephine",
  "Rosalie",
];
const AROUND = ["Around", "Into", "Beyond", "Behind", "Under"];
const AROUND_WHAT = [
  "My Heart",
  "Your Heart",
  "a Secret Land",
  "the Mirror",
  "the Silence",
  "a Distant Sky",
  "Your Eyes",
];
const PLEAS = ["Stop", "Wait", "Listen", "Hold On", "Come Back", "Stay"];
const PLEA_ENDS = [
  "for a Minute",
  "to Your Heart",
  "Tonight",
  "to Me",
  "Forever",
  "a Little Longer",
];
const PAIRS_A = ["Sisters", "Angels", "Lovers", "Strangers", "Shadows", "Heroes"];
const PAIRS_B = ["Brothers", "Saints", "Fools", "Dreamers", "Liars", "Thieves"];

/** Euro-disco, Sandra's way: "Heaven Can Wait", an adjective and a noun ("Innocent Love"), an
 * adjective and a name ("Crazy Juliet"), "Around My Heart", pleas ("Stop for a Minute") and pairs
 * ("Sisters and Brothers"). A list of its own, so Italo's titles stay as they were. */
export function euroTitle(rng: Rng): string {
  const pattern = rng.weighted<number>([
    [0, 2], // Heaven Can Wait
    [1, 3], // Innocent Love, Everlasting Love, Secret Land
    [2, 2], // Crazy Juliet, Little Girl
    [3, 2], // Around My Heart, Into a Secret Land
    [4, 1.5], // Stop for a Minute
    [5, 1], // Sisters and Brothers
  ]);
  let title: string;
  if (pattern === 0) title = `${rng.pick(CAN_WAIT)} Can Wait`;
  else if (pattern === 1) title = `${rng.pick(SECRET_ADJECTIVES)} ${rng.pick(SECRET_NOUNS)}`;
  else if (pattern === 2) title = `${rng.pick(SANDRA_ADJECTIVES)} ${rng.pick(SANDRA_NAMES)}`;
  else if (pattern === 3) title = `${rng.pick(AROUND)} ${rng.pick(AROUND_WHAT)}`;
  else if (pattern === 4) title = `${rng.pick(PLEAS)} ${rng.pick(PLEA_ENDS)}`;
  else title = `${rng.pick(PAIRS_A)} and ${rng.pick(PAIRS_B)}`;
  // The singles came as 7″ and 12″ cuts, named on the sleeve.
  if (rng.chance(0.2))
    title += rng.pick([" (Extended Version)", " (Single Version)", " (Dub Mix)"]);
  return title;
}
