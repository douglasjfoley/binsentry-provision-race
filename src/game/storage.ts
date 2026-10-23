// On-device storage (IndexedDB via idb-keyval). Falls back to memory if IndexedDB is unavailable,
// so the game still runs (without persistence) in a private browsing window.
import { createStore, get, set, type UseStore } from 'idb-keyval';
import type { RunRecord } from './board.ts';

export interface AdminSettings {
  /** Level chosen in the admin panel; null means the config default. */
  level: string | null;
  volume: number | null;
  muted: boolean | null;
  manualResetAt: number;
  frozenAt: number;
}

const DEFAULT_SETTINGS: AdminSettings = { level: null, volume: null, muted: null, manualResetAt: 0, frozenAt: 0 };

let store: UseStore | null = null;
const memory = new Map<string, unknown>();

async function read<T>(key: string, fallback: T): Promise<T> {
  if (store) {
    try {
      return ((await get(key, store)) as T | undefined) ?? fallback;
    } catch (e) {
      console.warn('IndexedDB read failed, using memory', e);
      store = null;
    }
  }
  return (memory.get(key) as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  if (!store) return;
  try {
    await set(key, value, store);
  } catch (e) {
    console.warn('IndexedDB write failed, using memory', e);
    store = null;
  }
}

export class Storage {
  runs: RunRecord[] = [];
  settings: AdminSettings = { ...DEFAULT_SETTINGS };

  async open(): Promise<void> {
    try {
      store = createStore('race-the-route', 'kv');
    } catch {
      store = null;
    }
    this.runs = await read<RunRecord[]>('runs', []);
    this.settings = { ...DEFAULT_SETTINGS, ...(await read<Partial<AdminSettings>>('settings', {})) };
  }

  async addRun(run: RunRecord): Promise<void> {
    this.runs.push(run);
    await write('runs', this.runs);
  }

  async setHidden(runId: string, hidden: boolean): Promise<void> {
    const r = this.runs.find((x) => x.runId === runId);
    if (r) r.hidden = hidden;
    await write('runs', this.runs);
  }

  async updateSettings(patch: Partial<AdminSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await write('settings', this.settings);
  }
}
