// Booth config (public/config.json). Fetched at startup so staff can change it without a rebuild.
import { z } from 'zod';

export const ConfigSchema = z.strictObject({
  deviceId: z.string().min(1).default('booth-1'),
  defaultLevel: z.enum(['quick-run', 'full-route', 'expert']).default('full-route'),
  /** Scenario files to load, relative to the site root. */
  scenarios: z.array(z.string().min(1)).min(1),
  idle: z
    .strictObject({
      /** Results and leaderboard screens return to the attract loop after this long without a touch. */
      resultsSec: z.number().positive().default(20),
      /** A race is abandoned (not saved) after this long without a touch. */
      raceSec: z.number().positive().default(45),
      /** Name entry and scenario card return to the attract loop after this long. */
      setupSec: z.number().positive().default(30),
    })
    .default({ resultsSec: 20, raceSec: 45, setupSec: 30 }),
  volume: z.number().min(0).max(1).default(0.8),
  muted: z.boolean().default(false),
  adminPin: z.string().regex(/^\d{4}$/, 'adminPin must be 4 digits'),
  /** Local time (HH:MM) when the Today board resets each morning. */
  leaderboardResetTime: z.string().regex(/^\d{2}:\d{2}$/).default('06:00'),
  ctaUrl: z.string().url(),
  /** Optional image of the QR code for ctaUrl (supplied by BinSentry), relative to the site root. */
  ctaQrImage: z.string().optional(),
  leadCapture: z.enum(['off', 'light', 'full']).default('light'),
});

export type BoothConfig = z.infer<typeof ConfigSchema>;

export async function loadConfig(url = 'config.json'): Promise<BoothConfig> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const r = ConfigSchema.safeParse(await res.json());
  if (!r.success) throw new Error(`${url} is not valid:\n${z.prettifyError(r.error)}`);
  return r.data;
}
