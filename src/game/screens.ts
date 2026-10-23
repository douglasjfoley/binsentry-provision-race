// Full-screen cards over the map: attract, driver name, scenario card, results, leaderboard and call to action.
import type { Scenario } from '../scenario/schema.ts';
import type { BoardEntry, RunRecord } from './board.ts';
import type { BoothConfig } from './config.ts';
import { copy } from './copy.ts';
import { feedChip, fmtSec, h, onTap, setText } from './dom.ts';
import { cleanName } from './names.ts';

function boardList(entries: BoardEntry[], highlight?: string, limit = 10): HTMLElement {
  if (!entries.length) return h('div', { class: 'board-empty' }, copy.board.empty);
  return h(
    'ol',
    { class: 'board-list' },
    ...entries.slice(0, limit).map((e) =>
      h(
        'li',
        { class: e.run.runId === highlight ? 'me' : '' },
        h('span', { class: 'rank' }, String(e.rank)),
        h('span', { class: 'who' }, e.run.driverName, e.run.company ? h('span', { class: 'company' }, e.run.company) : null),
        h('span', { class: 'time' }, `${fmtSec(e.run.playerSec)} s`),
      ),
    ),
  );
}

export function attractScreen(o: { today: BoardEntry[]; pvSec: number; level: string; onStart: () => void }): HTMLElement {
  const el = h(
    'div',
    { class: 'screen attract' },
    h('div', { class: 'lockup' }, copy.attract.lockup),
    h('div', { class: 'attract-main' }, h('h1', {}, copy.attract.headline), h('div', { class: 'tap-hint' }, copy.attract.tap)),
    h(
      'div',
      { class: 'attract-board card' },
      h('h2', {}, copy.attract.topToday),
      h('div', { class: 'level-name' }, copy.levels[o.level] ?? o.level),
      h('div', { class: 'to-beat' }, copy.board.toBeat(fmtSec(o.pvSec))),
      o.today.length ? boardList(o.today, undefined, 5) : h('div', { class: 'board-empty' }, copy.attract.empty),
    ),
  );
  onTap(el, () => o.onStart());
  return el;
}

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function nameScreen(o: { onDone: (name: string, company: string) => void }): HTMLElement {
  const values = { name: '', company: '' };
  const max = { name: 12, company: 24 };
  let field: 'name' | 'company' = 'name';
  const nameEl = h('div', { class: 'field active' });
  const companyEl = h('div', { class: 'field' });
  const render = () => {
    setText(nameEl, values.name || copy.name.nameHint);
    setText(companyEl, values.company || copy.name.companyHint);
    nameEl.classList.toggle('placeholder', !values.name);
    companyEl.classList.toggle('placeholder', !values.company);
    nameEl.classList.toggle('active', field === 'name');
    companyEl.classList.toggle('active', field === 'company');
  };
  onTap(nameEl, () => ((field = 'name'), render()));
  onTap(companyEl, () => ((field = 'company'), render()));
  const key = (label: string, fn: () => void, cls = '') => {
    const k = h('div', { class: `key ${cls}` }, label);
    onTap(k, () => (fn(), render()));
    return k;
  };
  const type = (c: string) => {
    if (values[field].length < max[field]) values[field] += c;
  };
  const finish = (skip: boolean) =>
    o.onDone(skip ? copy.name.guest : cleanName(values.name, copy.name.guest), skip ? '' : cleanName(values.company, '', max.company));
  const el = h(
    'div',
    { class: 'screen name card-screen' },
    h(
      'div',
      { class: 'card wide-card' },
      h('h1', {}, copy.name.title),
      h('div', { class: 'fields' }, nameEl, companyEl),
      h(
        'div',
        { class: 'keyboard' },
        ...ROWS.map((r, i) =>
          h('div', { class: 'key-row' }, ...r.split('').map((c) => key(c, () => type(c))), i === 2 ? key(copy.name.back, () => (values[field] = values[field].slice(0, -1)), 'wide') : null),
        ),
        h('div', { class: 'key-row' }, key(copy.name.skip, () => finish(true), 'wide muted'), key(copy.name.space, () => type(' '), 'space'), key(copy.name.start, () => finish(false), 'wide primary')),
      ),
    ),
  );
  render();
  return el;
}

export function cardScreen(o: { scenario: Scenario; onStart: () => void }): HTMLElement {
  const s = o.scenario;
  const el = h(
    'div',
    { class: 'screen card-screen scenario-card' },
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'level-name' }, copy.levels[s.level] ?? s.level),
      h('h1', {}, s.name),
      h('p', { class: 'pitch' }, copy.card.pitch(s.bins.length, s.feeds.length)),
      h('p', { class: 'setup' }, s.setup),
      h('div', { class: 'legend' }, ...s.feeds.map((f, i) => h('div', { class: 'legend-item' }, feedChip(i, f.color, f.label, true), f.label))),
      h('p', { class: 'how' }, copy.card.howTo),
      h('div', { class: 'tap-hint' }, copy.card.tap),
    ),
  );
  onTap(el, () => o.onStart());
  return el;
}

export interface ResultsData {
  run: RunRecord;
  scenario: Scenario;
  rank: number;
  km: number;
}

export function resultsScreen(o: ResultsData & { onPlayAgain: () => void; onBoard: () => void }): HTMLElement {
  const r = o.run;
  const gap = r.playerSec - r.provisionSec;
  const real = Math.round(r.playerSec * o.scenario.rates.secToRealMinutes);
  const stat = (label: string, value: string) => h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
  const again = h('div', { class: 'button primary' }, copy.results.playAgain);
  const board = h('div', { class: 'button' }, copy.results.leaderboard);
  onTap(again, () => o.onPlayAgain());
  onTap(board, () => o.onBoard());
  return h(
    'div',
    { class: 'screen card-screen results' },
    h(
      'div',
      { class: 'card wide-card' },
      h(
        'div',
        { class: 'times' },
        h(
          'div',
          { class: 'time-box you' },
          h('div', { class: 'time-label' }, copy.results.you),
          h('div', { class: 'time-value' }, `${fmtSec(r.playerSec)} s`),
          r.outOfFeed ? h('div', { class: 'time-note' }, copy.results.includesPenalties(r.outOfFeed * o.scenario.rates.outOfFeedPenaltySec)) : null,
        ),
        h('div', { class: 'time-box pv' }, h('div', { class: 'time-label' }, copy.results.provision), h('div', { class: 'time-value' }, `${fmtSec(r.provisionSec)} s`)),
      ),
      h('div', { class: 'gap' }, gap >= 0 ? copy.results.gapBehind(fmtSec(gap)) : copy.results.gapAhead(fmtSec(-gap))),
      h('div', { class: 'real-world' }, copy.results.realWorld(Math.floor(real / 60), real % 60)),
      h(
        'div',
        { class: 'stats' },
        stat(copy.results.distance, `${o.km.toFixed(1)} km`),
        stat(copy.results.trips, String(r.trips)),
        stat(copy.results.deciding, `${fmtSec(r.decisionSec)} s`),
        stat(copy.results.outOfFeed, String(r.outOfFeed)),
      ),
      h('p', { class: 'estimates' }, copy.results.estimates),
      h('div', { class: 'rank' }, o.rank ? copy.results.rank(o.rank) : copy.results.unranked),
      h('div', { class: 'buttons' }, board, again),
    ),
  );
}

export function boardScreen(o: {
  level: string;
  pvSec: number;
  today: BoardEntry[];
  allShow: BoardEntry[];
  highlight?: string;
  config: BoothConfig;
  onPlayAgain: () => void;
}): HTMLElement {
  const again = h('div', { class: 'button primary' }, copy.board.playAgain);
  onTap(again, () => o.onPlayAgain());
  const qr = o.config.ctaQrImage
    ? h('img', { class: 'qr', src: o.config.ctaQrImage, alt: o.config.ctaUrl })
    : h('div', { class: 'qr placeholder' }, 'QR code', h('small', {}, o.config.ctaUrl.replace(/^https?:\/\//, '').replace(/\?.*/, '')));
  return h(
    'div',
    { class: 'screen card-screen leaderboard' },
    h(
      'div',
      { class: 'card wide-card' },
      h('div', { class: 'level-name' }, copy.levels[o.level] ?? o.level),
      h('div', { class: 'to-beat' }, copy.board.toBeat(fmtSec(o.pvSec))),
      h(
        'div',
        { class: 'boards' },
        h('div', { class: 'board' }, h('h2', {}, copy.board.today), boardList(o.today, o.highlight)),
        h('div', { class: 'board' }, h('h2', {}, copy.board.allShow), boardList(o.allShow, o.highlight)),
        h('div', { class: 'cta' }, h('p', { class: 'cta-line' }, copy.board.cta), qr, h('div', { class: 'scan' }, copy.board.scan), h('div', { class: 'talk' }, copy.board.talk)),
      ),
      h('div', { class: 'buttons' }, again),
    ),
  );
}

export function messageScreen(text: string): HTMLElement {
  return h('div', { class: 'screen card-screen' }, h('div', { class: 'card' }, h('p', {}, text)));
}
