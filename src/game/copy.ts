// Every on-screen string lives here so brand review covers one file (tests/copy.test.ts enforces the rules:
// "ProVision" with a capital V, "artificial intelligence" spelled out, no em dashes, no banned words).
// Stats such as "70,000+ bins" must come from BinSentry's approved claims list.

const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const word = (n: number) => numberWords[n] ?? String(n);

export const copy = {
  attract: {
    headline: 'Can you beat ProVision?',
    tap: 'Tap anywhere to start',
    lockup: 'BinSentry ProVision',
    topToday: "Today's top drivers",
    empty: 'No times yet today. Be the first.',
  },
  name: {
    title: 'Pick a driver name',
    nameHint: 'Initials or first name',
    companyHint: 'Company (optional)',
    skip: 'Skip',
    start: 'Start',
    guest: 'Guest',
    space: 'Space',
    back: 'Delete',
  },
  card: {
    pitch: (bins: number, feeds: number) =>
      `${cap(word(bins))} bins. ${cap(word(feeds))} feeds. One truck. Get every bin filled before anything runs out.`,
    howTo: 'Tap the mill to load. Tap a bin to deliver. The clock never stops.',
    tap: 'Tap to start',
  },
  race: {
    planning: 'ProVision is planning...',
    progress: (done: number, total: number) => `ProVision: ${done} of ${total} bins`,
    provisionDone: (sec: string) => `ProVision finished: ${sec} s`,
    banner: 'ProVision finished. Keep going!',
    wrongFeed: 'Wrong feed',
    outOfFeed: (sec: number) => `Out of feed! +${sec} s`,
    penalty: (sec: number) => `+${sec} s penalties`,
    estimate: (tons: string) => `about ${tons} t`,
    exact: (tons: string) => `${tons} t`,
    full: 'Full',
    truck: 'Your truck',
    empty: 'Empty',
  },
  load: {
    title: 'Load the truck',
    hint: 'Tap a feed to fill a compartment. Tap a compartment to empty it.',
    needed: 'Still needed',
    go: 'Go',
    topUp: 'top up',
    onBoard: (tons: string) => `${tons} t on board`,
  },
  results: {
    you: 'Your time',
    includesPenalties: (sec: number) => `includes ${sec} s of out-of-feed penalties`,
    provision: 'ProVision',
    gapBehind: (sec: string) => `${sec} s behind ProVision`,
    gapAhead: (sec: string) => `${sec} s ahead of ProVision`,
    distance: 'Distance driven',
    trips: 'Trips from the mill',
    deciding: 'Time spent deciding',
    outOfFeed: 'Bins that ran out',
    realWorld: (h: number, m: number) => `${h} h ${m} m on the road`,
    estimates: 'You planned on estimates. ProVision planned on measured bin levels.',
    rank: (n: number) => `You're number ${n} on today's board`,
    unranked: 'Play again to get on the board',
    playAgain: 'Play again',
    leaderboard: 'See leaderboard',
  },
  board: {
    today: 'Today',
    allShow: 'All show',
    toBeat: (sec: string) => `ProVision: ${sec} s. The time to beat.`,
    cta: 'This is what ProVision does across 70,000+ bins, every day.',
    scan: 'Scan to see how',
    talk: 'Talk to our team',
    playAgain: 'Play again',
    empty: 'No times yet.',
  },
  levels: { 'quick-run': 'Quick Run', 'full-route': 'Full Route', expert: 'Expert' } as Record<string, string>,
  errors: {
    noScenario: 'No playable scenario for this level. Ask a BinSentry team member.',
  },
};
