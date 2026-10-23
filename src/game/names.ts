// Driver name cleanup and a small profanity filter. Staff can still hide any entry from the admin panel.

// Lowercase stems; a name is rejected if any stem appears in it once letters are normalized.
const BLOCKED = [
  'fuk', 'fuck', 'fck', 'shit', 'sht', 'cunt', 'dick', 'cock', 'puss', 'twat', 'wank', 'slut', 'whore', 'bitch', 'bastard',
  'nigg', 'fag', 'retard', 'rape', 'nazi', 'kkk', 'hitler', 'penis', 'vagin', 'anus', 'tits', 'boob', 'porn', 'sex', 'cum', 'jizz',
  'ass', 'arse', 'piss', 'crap', 'damn', 'hell', 'wtf', 'stfu', 'gtfo', 'kys', 'fu', 'suck',
];
// These only count as a whole word, so "Cassie", "Hellen", "Dickson", "Ashton", "Grapevine" and "Peacock Farms" are fine.
const WHOLE_ONLY = new Set(['ass', 'hell', 'fu', 'cum', 'sex', 'anus', 'crap', 'damn', 'suck', 'kkk', 'wtf', 'kys', 'arse', 'piss', 'dick', 'cock', 'tits', 'puss', 'boob', 'rape', 'fag', 'sht']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

export function isClean(text: string): boolean {
  const words = text.split(/[\s\-_.,&/]+/).map(normalize).filter(Boolean);
  const joined = words.join('');
  return !BLOCKED.some((w) => (WHOLE_ONLY.has(w) ? words.includes(w) : joined.includes(w)));
}

/** Trim and limit a typed name. Returns the fallback if empty or blocked. */
export function cleanName(raw: string, fallback: string, max = 12): string {
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, max);
  return s && isClean(s) ? s : fallback;
}
