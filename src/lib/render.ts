/** Map and timeline PNGs for the CLI / MCP / web previews (no text; the editor and runtimes label things). */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { activeEntry, dayList, isNight, route, states, toMinutes } from "../shared/engine.js";
import { FACINGS, type World } from "../shared/types.js";
import { encodePng, decodePng } from "./png.js";
import { hex, Raster } from "./raster.js";
import { dirs } from "./workspace.js";

const cache = new Map<string, { width: number; height: number; data: Uint8Array } | null>();
async function png(file: string) {
  if (!cache.has(file)) cache.set(file, existsSync(file) ? decodePng(await readFile(file)) : null);
  return cache.get(file)!;
}

function blitImg(r: Raster, img: { width: number; height: number; data: Uint8Array }, sx: number, sy: number, w: number, h: number, dx: number, dy: number, tint?: [number, number, number]) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((sy + y) * img.width + sx + x) * 4;
      const a = img.data[i + 3]!;
      if (!a) continue;
      let c: [number, number, number] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      if (tint) c = [Math.round((c[0] * tint[0]) / 255), Math.round((c[1] * tint[1]) / 255), Math.round((c[2] * tint[2]) / 255)];
      r.set(dx + x, dy + y, [c[0], c[1], c[2], a]);
    }
}

export const NIGHT_TINT: [number, number, number] = [150, 160, 215];

/** The map with every NPC where the schedule puts it at (day, minute); walking NPCs show their route. */
export async function renderMapRaster(root: string, world: World, day: number, minute: number, opts: { night?: boolean; routes?: boolean; frame?: number } = {}): Promise<Raster> {
  const ts = world.map.tileSize;
  const night = opts.night ?? isNight(world.clock, minute);
  const r = new Raster(world.map.width * ts, world.map.height * ts, night ? "#1c2238" : "#79c48a");
  const mapId = world.map.id;
  const bg = (night ? await png(path.join(dirs(root).maps, `${mapId}_night.png`)) : null) ?? (await png(path.join(dirs(root).maps, `${mapId}.png`)));
  if (bg) blitImg(r, bg, 0, 0, Math.min(bg.width, r.width), Math.min(bg.height, r.height), 0, 0);
  else for (let y = 0; y < world.map.height; y++) for (let x = 0; x < world.map.width; x++) if (world.map.collision[y]![x] === "#") r.rect(x * ts, y * ts, ts, ts, night ? "#2c3350" : "#4f8a5a");
  const sts = states(world, day, minute, night).filter((s) => !s.indoors).sort((a, b) => a.y - b.y);
  if (opts.routes !== false)
    for (const s of sts) {
      if (!s.moving) continue;
      const npc = world.npcs.find((n) => n.id === s.id)!;
      const act = activeEntry(world, npc, day, minute, night)!;
      const path = route(world, act.from, act.entry.place);
      const c = hex(npc.color ?? "#f4ae3d");
      for (const [x, y] of path.slice(Math.floor(s.progress))) r.rect(x * ts + ts / 2 - 1, y * ts + ts / 2 - 1, 2, 2, [c[0], c[1], c[2], 200]);
    }
  for (const s of sts) {
    const npc = world.npcs.find((n) => n.id === s.id)!;
    const px = Math.round(s.x * ts + ts / 2);
    const py = Math.round(s.y * ts + ts);
    r.ellipse(px - 7, py - 4, 14, 5, [0, 0, 0, 90]);
    const sheet = await png(path.join(dirs(root).characters, `${npc.sprite}.png`));
    const row = Math.max(0, FACINGS.indexOf(s.facing));
    const col = s.moving ? [1, 2, 3, 2][(opts.frame ?? Math.floor(s.progress * 2)) % 4]! : 0;
    if (sheet) blitImg(r, sheet, col * 48, row * 48, 48, 48, px - 24, py - 46, night ? NIGHT_TINT : undefined);
    else r.rect(px - 4, py - 14, 8, 12, npc.color ?? "#f4ae3d");
    r.rect(px - 3, py - 50, 6, 3, npc.color ?? "#f4ae3d");
  }
  return r;
}

export async function renderMapPng(root: string, world: World, day: number, minute: number, opts: { night?: boolean; routes?: boolean; scale?: number; crop?: [number, number, number, number] } = {}) {
  let r = await renderMapRaster(root, world, day, minute, opts);
  if (opts.crop) {
    const [cx, cy, cw, ch] = opts.crop;
    const c = new Raster(cw, ch, "#000000");
    c.blit(r, -cx, -cy);
    r = c;
  }
  const s = r.scaled(Math.max(1, Math.min(6, opts.scale ?? 1)));
  return encodePng(s.width, s.height, s.data);
}

const ACT_COLORS = ["#f4ae3d", "#79c48a", "#6fb3e0", "#e5806c", "#c58be0", "#d8d2c0", "#5fae6e", "#f0a030", "#b8432f", "#4f8fb0", "#e6c35c", "#8fd0c0", "#c8506a", "#a08a6a", "#7ab0e0", "#e09060", "#90a0e8", "#b0d070"];
export const activityColor = (world: World, a: string) => (a === "walk" ? "#f7ebd3" : ACT_COLORS[Object.keys(world.activities).indexOf(a) % ACT_COLORS.length] ?? "#97805f");

/** One row per NPC over 24 h (2 minutes per pixel): activity colours, walking in cream, night shaded, hour ticks. */
export function timelineRaster(world: World, day: number, night?: boolean): Raster {
  const rowH = 16;
  const left = 12;
  const W = left + 720 + 4;
  const H = 10 + world.npcs.length * rowH + 4;
  const r = new Raster(W, H, "#1e150e");
  for (let m = 0; m < 1440; m += 2) if (night ?? isNight(world.clock, m)) r.rect(left + m / 2, 0, 1, H, "#161b2c");
  for (let h = 0; h <= 24; h++) r.rect(left + h * 30, 0, 1, h % 6 === 0 ? 8 : 4, "#97805f");
  world.npcs.forEach((n, i) => {
    const y = 10 + i * rowH;
    r.rect(2, y + 2, 7, rowH - 4, n.color ?? "#f4ae3d");
    for (let m = 0; m < 1440; m += 2) {
      const st = states(world, day, m, night).find((s) => s.id === n.id)!;
      const c = activityColor(world, st.moving ? "walk" : st.activity);
      r.rect(left + m / 2, y + 1, 1, rowH - 2, st.indoors ? shadeHex(c) : c);
    }
    for (const x of dayList(world, n, day, night ?? false)) r.rect(left + toMinutes(x.e.at) / 2, y, 1, rowH, "#0d0906");
  });
  return r;
}
const shadeHex = (c: string) => {
  const [a, b, d] = hex(c);
  return `#${[a, b, d].map((v) => Math.round(v * 0.55).toString(16).padStart(2, "0")).join("")}`;
};
