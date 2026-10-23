// Fixed design resolutions scaled to fit the screen: 1920x1080 for the booth, 1440x1080 (4:3) for iPad.
// Scenario coordinates are on a 1920x1080 map, drawn smaller so the HUD never covers a bin.

export type LayoutMode = 'wide' | 'tablet';

export interface Layout {
  mode: LayoutMode;
  /** Design size. */
  W: number;
  H: number;
  /** Design-to-screen scale and letterbox offset, in CSS pixels. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Map-to-design transform. */
  map: { x: number; y: number; s: number };
}

export const MAP_W = 1920;
export const MAP_H = 1080;

export function computeLayout(width: number, height: number): Layout {
  const mode: LayoutMode = width / height >= 1.55 ? 'wide' : 'tablet';
  const W = mode === 'wide' ? 1920 : 1440;
  const H = 1080;
  const scale = Math.min(width / W, height / H);
  // The map sits between the top bar and the bottom panels (truck gauges, loading panel) so no bin is ever covered.
  const map = mode === 'wide' ? { x: (W - MAP_W * 0.8) / 2, y: 30, s: 0.8 } : { x: (W - MAP_W * 0.7) / 2, y: 90, s: 0.7 };
  return { mode, W, H, scale, offsetX: (width - W * scale) / 2, offsetY: (height - H * scale) / 2, map };
}

export function mapToDesign(l: Layout, x: number, y: number): { x: number; y: number } {
  return { x: l.map.x + x * l.map.s, y: l.map.y + y * l.map.s };
}

export function screenToDesign(l: Layout, clientX: number, clientY: number): { x: number; y: number } {
  return { x: (clientX - l.offsetX) / l.scale, y: (clientY - l.offsetY) / l.scale };
}

export function designToMap(l: Layout, x: number, y: number): { x: number; y: number } {
  return { x: (x - l.map.x) / l.map.s, y: (y - l.map.y) / l.map.s };
}
