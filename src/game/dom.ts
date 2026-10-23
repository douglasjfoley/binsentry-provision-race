// Tiny DOM helpers for the HTML overlays.

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; style?: string; onTap?: (e: PointerEvent) => void; [attr: string]: unknown } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'onTap') onTap(el, v as (e: PointerEvent) => void);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Tap handler: fires on pointerdown for instant feedback (booth players tap hard and fast). */
export function onTap(el: HTMLElement, fn: (e: PointerEvent) => void): void {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 150);
    fn(e);
  });
}

/** Set text only when it changed (avoids layout work every frame). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** A feed's marker: colored shape + letter, so feed is never shown by color alone. */
export function feedChip(feedIndex: number, color: string, label: string, big = false): HTMLElement {
  return h('span', { class: `feed-chip shape-${feedIndex % 3}${big ? ' big' : ''}`, style: `--feed:${color}` }, label.charAt(0).toUpperCase());
}

export function fmtSec(sec: number): string {
  return sec.toFixed(1);
}
