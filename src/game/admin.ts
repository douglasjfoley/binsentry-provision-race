// Hidden staff panel: five taps in the top-left corner within 3 s, then the 4-digit PIN from config.json.
import type { Scenario } from '../scenario/schema.ts';
import { rankBoard, todayStart, toCsv, type BoardSettings } from './board.ts';
import type { BoothConfig } from './config.ts';
import { copy } from './copy.ts';
import { fmtSec, h, onTap } from './dom.ts';
import type { Storage } from './storage.ts';

const CORNER = 140;
const TAPS = 5;
const WINDOW_MS = 3000;

export interface AdminDeps {
  config: BoothConfig;
  storage: Storage;
  scenarios: Scenario[];
  rejected: { file: string; error: string }[];
  build: string;
  level: () => string;
  setLevel: (level: string) => void;
  boardSettings: () => BoardSettings;
  onClose: () => void;
}

export class Admin {
  readonly el = h('div', { class: 'admin' });
  private taps: number[] = [];
  private deps: AdminDeps;
  open = false;

  constructor(deps: AdminDeps) {
    this.deps = deps;
  }

  /** Feed every tap (design coordinates). Returns true when the tap opened the PIN pad. */
  cornerTap(x: number, y: number, now: number): boolean {
    if (this.open || x > CORNER || y > CORNER) return false;
    this.taps = [...this.taps.filter((t) => now - t < WINDOW_MS), now];
    if (this.taps.length < TAPS) return false;
    this.taps = [];
    this.showPin();
    return true;
  }

  close(): void {
    this.open = false;
    this.el.replaceChildren();
    this.el.classList.remove('show');
    this.deps.onClose();
  }

  private showPin(): void {
    this.open = true;
    this.el.classList.add('show');
    let entered = '';
    const dots = h('div', { class: 'pin-dots' });
    const render = () => dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('span', { class: i < entered.length ? 'on' : '' })));
    const pad = h('div', { class: 'pin-pad' });
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', 'Del']) {
      const b = h('div', { class: 'key' }, k);
      onTap(b, () => {
        if (k === 'Cancel') return this.close();
        if (k === 'Del') entered = entered.slice(0, -1);
        else entered += k;
        if (entered.length === 4) {
          if (entered === this.deps.config.adminPin) return this.showPanel();
          entered = '';
          dots.classList.add('wrong');
          setTimeout(() => dots.classList.remove('wrong'), 400);
        }
        render();
      });
      pad.append(b);
    }
    render();
    this.el.replaceChildren(h('div', { class: 'admin-card pin' }, h('h2', {}, 'Staff PIN'), dots, pad));
  }

  private showPanel(): void {
    const d = this.deps;
    const st = d.storage;
    const section = (title: string, ...body: (HTMLElement | string)[]) => h('section', {}, h('h3', {}, title), ...body);
    const button = (label: string, fn: () => void | Promise<void>, cls = '') => {
      const b = h('div', { class: `button small ${cls}` }, label);
      onTap(b, async () => {
        await fn();
        this.showPanel();
      });
      return b;
    };

    const level = d.level();
    const levels = (['quick-run', 'full-route', 'expert'] as const).map((l) => {
      const has = d.scenarios.some((s) => s.level === l);
      return button(`${copy.levels[l]}${has ? '' : ' (none)'}`, () => (has ? d.setLevel(l) : undefined), l === level ? 'primary' : has ? '' : 'disabled');
    });

    const volume = st.settings.volume ?? d.config.volume;
    const muted = st.settings.muted ?? d.config.muted;
    const bs = d.boardSettings();
    const now = Date.now();
    const recent = rankBoard(st.runs, level, 0, { ...bs, frozenAt: 0 }, 15);
    const hiddenRuns = st.runs.filter((r) => r.hidden && r.level === level);

    const exportCsv = () => {
      const blob = new Blob([toCsv(st.runs)], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `race-the-route-${d.config.deviceId}-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
    };

    let confirmReset = false;
    const resetBtn = h('div', { class: 'button small danger' }, "Reset today's board");
    onTap(resetBtn, async () => {
      if (!confirmReset) {
        confirmReset = true;
        resetBtn.textContent = 'Tap again to confirm';
        return;
      }
      await st.updateSettings({ manualResetAt: Date.now() });
      this.showPanel();
    });

    const completed = st.runs.filter((r) => r.completed);
    const todayPlays = st.runs.filter((r) => r.startedAt >= todayStart(now, bs));

    this.el.replaceChildren(
      h(
        'div',
        { class: 'admin-card' },
        h('div', { class: 'admin-head' }, h('h2', {}, 'Staff panel'), button('Close', () => this.close(), 'primary')),
        section('Level', h('div', { class: 'row' }, ...levels)),
        section(
          'Sound',
          h(
            'div',
            { class: 'row' },
            button(muted ? 'Unmute' : 'Mute', () => st.updateSettings({ muted: !muted })),
            button('Volume -', () => st.updateSettings({ volume: Math.max(0, Math.round((volume - 0.1) * 10) / 10) })),
            h('span', { class: 'value' }, `${Math.round(volume * 100)}%`),
            button('Volume +', () => st.updateSettings({ volume: Math.min(1, Math.round((volume + 0.1) * 10) / 10) })),
          ),
        ),
        section(
          'Leaderboard',
          h(
            'div',
            { class: 'row' },
            resetBtn,
            button(bs.frozenAt ? 'Unfreeze board' : 'Freeze board', () => st.updateSettings({ frozenAt: bs.frozenAt ? 0 : Date.now() })),
            button('Export runs as CSV', exportCsv),
          ),
          h('p', { class: 'note' }, `${todayPlays.length} plays today, ${completed.length} completed runs stored.${bs.frozenAt ? ` Frozen since ${new Date(bs.frozenAt).toLocaleTimeString()}.` : ''}`),
        ),
        section(
          'Hide a name',
          h(
            'div',
            { class: 'name-list' },
            ...[...recent.map((e) => e.run), ...hiddenRuns].map((r) =>
              h(
                'div',
                { class: `name-row${r.hidden ? ' hidden' : ''}` },
                h('span', {}, `${r.driverName}${r.company ? `, ${r.company}` : ''}`),
                h('span', {}, `${fmtSec(r.playerSec)} s`),
                button(r.hidden ? 'Show' : 'Hide', () => st.setHidden(r.runId, !r.hidden)),
              ),
            ),
          ),
        ),
        section(
          'Build and scenarios',
          h('p', { class: 'note' }, `Build ${d.build}, device ${d.config.deviceId}`),
          ...d.scenarios.map((s) => h('p', { class: 'note mono' }, `${s.id}  ${s.level}  checksum ${s.guarantee.inputsHash}  ProVision ${fmtSec(s.provision.planningSec + s.provision.finishSec)} s`)),
          ...d.rejected.map((r) => h('p', { class: 'note mono bad' }, `REFUSED ${r.file}: ${r.error}`)),
          h('div', { class: 'row' }, button('Reload app', () => location.reload())),
        ),
      ),
    );
  }
}
