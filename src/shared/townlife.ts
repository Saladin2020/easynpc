/**
 * Easy NPC town life — smooth time-of-day lighting phases, shop opening hours, train / flight timetables and
 * flooding (น้ำท่วม) driven by the calendar weather. Pure, so the CLI, Godot (npc_engine.gd, parity-tested) and Pixi agree.
 *
 *   phaseAt(minute) / lighting(world, minute) → { phase, tint [r,g,b], dark 0..1, lamps 0..1 }
 *   shopStatus(world, id, day, minute, flood?) → { open, reason, opensAt, closesAt }
 *   departures(world, station, day, minute, { kind?, n? }) / serviceAt(world, station, day, minute, kind?)
 *   floodLevel(world, day, minute?) → 0..1 · floodEffects(level) → { stage, walk, npcsIndoors, stallsClosed }
 */
import { date, eventsOn, weatherOn } from "./calendar.js";
import type { Name, Weather, Weekday, World } from "./types.js";

const n = (th: string, en: string, ms: string): Name => ({ th, en, ms });
const wrap = (m: number) => ((Math.floor(m) % 1440) + 1440) % 1440;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
export const hhmm = (minute: number) => {
  const m = wrap(minute);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const toMin = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// ------------------------------------------------------------------ lighting
export const LIGHT_PHASES = ["late_night", "dawn", "morning", "noon", "afternoon", "sunset", "evening", "night"] as const;
export type LightPhase = (typeof LIGHT_PHASES)[number];
export const PHASE_INFO: Record<LightPhase, { from: string; name: Name }> = {
  late_night: { from: "23:00", name: n("ดึกสงัด", "Late night", "Larut malam") },
  dawn: { from: "05:00", name: n("รุ่งสาง", "Dawn", "Subuh hari") },
  morning: { from: "06:30", name: n("เช้า", "Morning", "Pagi") },
  noon: { from: "11:00", name: n("เที่ยง", "Noon", "Tengah hari") },
  afternoon: { from: "14:00", name: n("บ่าย", "Afternoon", "Petang") },
  sunset: { from: "17:00", name: n("เย็น · พระอาทิตย์ตก", "Sunset", "Senja") },
  evening: { from: "18:30", name: n("หัวค่ำ", "Evening", "Awal malam") },
  night: { from: "20:00", name: n("กลางคืน", "Night", "Malam") },
};

export interface LightKey {
  at: string;
  /** Multiply tint "#rrggbb" (white = no change). */
  tint: string;
  /** Darkness overlay 0..1. */
  dark: number;
  /** Street lamps / lit windows 0..1. */
  lamps: number;
}
export interface Lighting {
  keys: LightKey[];
}
/** Keyframes blended with smoothstep; wraps at midnight. */
export const DEFAULT_LIGHTING: Lighting = {
  keys: [
    { at: "00:00", tint: "#46508c", dark: 0.6, lamps: 1 },
    { at: "04:30", tint: "#46508c", dark: 0.6, lamps: 1 },
    { at: "05:30", tint: "#9078aa", dark: 0.42, lamps: 0.8 },
    { at: "06:30", tint: "#ffb08c", dark: 0.18, lamps: 0.3 },
    { at: "07:30", tint: "#ffe2c4", dark: 0.04, lamps: 0 },
    { at: "10:00", tint: "#fff6e8", dark: 0, lamps: 0 },
    { at: "12:00", tint: "#ffffff", dark: 0, lamps: 0 },
    { at: "15:00", tint: "#fff4dc", dark: 0, lamps: 0 },
    { at: "17:15", tint: "#ffbe82", dark: 0.08, lamps: 0.1 },
    { at: "18:15", tint: "#fa8c64", dark: 0.2, lamps: 0.5 },
    { at: "19:00", tint: "#aa6ea0", dark: 0.36, lamps: 0.9 },
    { at: "20:30", tint: "#6064b4", dark: 0.52, lamps: 1 },
    { at: "23:00", tint: "#464e96", dark: 0.6, lamps: 1 },
  ],
};

export function phaseAt(minute: number): LightPhase {
  const m = wrap(minute);
  let best: LightPhase = "late_night";
  let bestAt = -1;
  for (const p of LIGHT_PHASES) {
    const a = toMin(PHASE_INFO[p].from);
    if (a <= m && a > bestAt) (best = p), (bestAt = a);
  }
  return best;
}

const hexRgb = (h: string): [number, number, number] => {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

export interface LightState {
  phase: LightPhase;
  tint: [number, number, number];
  /** 0xRRGGBB of tint. */
  tintHex: number;
  dark: number;
  lamps: number;
}

export function lighting(world: Pick<World, "lighting">, minute: number): LightState {
  const keys = [...(world.lighting ?? DEFAULT_LIGHTING).keys].map((k) => ({ ...k, m: toMin(k.at) })).filter((k) => !Number.isNaN(k.m)).sort((a, b) => a.m - b.m);
  const m = minute - Math.floor(minute / 1440) * 1440;
  let a = keys[keys.length - 1]!;
  let b = keys[0]!;
  let am = a.m - 1440;
  let bm = b.m;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]!.m <= m) {
      a = keys[i]!;
      am = a.m;
      b = keys[(i + 1) % keys.length]!;
      bm = i + 1 < keys.length ? b.m : b.m + 1440;
    }
  }
  const span = bm - am;
  const raw = span > 0 ? (m - am) / span : 0;
  const t = raw * raw * (3 - 2 * raw);
  const ca = hexRgb(a.tint);
  const cb = hexRgb(b.tint);
  const tint: [number, number, number] = [0, 1, 2].map((i) => Math.round(ca[i]! + (cb[i]! - ca[i]!) * t)) as [number, number, number];
  return { phase: phaseAt(minute), tint, tintHex: (tint[0] << 16) | (tint[1] << 8) | tint[2], dark: round3(a.dark + (b.dark - a.dark) * t), lamps: round3(a.lamps + (b.lamps - a.lamps) * t) };
}

// ------------------------------------------------------------------ shops
export interface Shop {
  name: Name;
  /** "08:00-18:00" (overnight like "18:00-02:00" is fine). */
  hours: string;
  closedOn?: Weekday[];
  /** Only open while this calendar event runs (a ตลาดนัด stall on market day). */
  event?: string;
  /** Halal-only stall (Easy Items stock is checked by Easy Kit). */
  halal?: boolean;
  /** Stalls / ground-floor shops shut at this flood level (default 0.6; stalls 0.35). */
  floodClose?: number;
  kind?: "shop" | "stall" | "counter";
}
export type ShopReason = "open" | "hours" | "closed_day" | "event" | "flood" | "unknown";
export interface ShopStatus {
  open: boolean;
  reason: ShopReason;
  opensAt: string | null;
  closesAt: string | null;
}

export function parseHours(h: string): [number, number] | null {
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(h ?? "");
  if (!m) return null;
  const a = toMin(m[1]!);
  const b = toMin(m[2]!);
  return Number.isNaN(a) || Number.isNaN(b) ? null : [a, b];
}

export function shopStatus(world: Pick<World, "shops" | "calendar" | "clock">, id: string, day: number, minute: number, flood = 0): ShopStatus {
  const s = world.shops?.[id];
  const hrs = s ? parseHours(s.hours) : null;
  if (!s || !hrs) return { open: false, reason: "unknown", opensAt: null, closesAt: null };
  const [a, b] = hrs;
  const m = wrap(minute);
  const inHours = a < b ? m >= a && m < b : m >= a || m < b;
  const opensAt = hhmm(a);
  const closesAt = hhmm(b);
  const wd = date(world, day).weekday;
  if (s.closedOn?.includes(wd)) return { open: false, reason: "closed_day", opensAt, closesAt };
  if (s.event && !eventsOn(world, day).some((e) => e.id === s.event)) return { open: false, reason: "event", opensAt, closesAt };
  if (flood >= (s.floodClose ?? (s.kind === "stall" ? 0.35 : 0.6))) return { open: false, reason: "flood", opensAt, closesAt };
  return { open: inHours, reason: inHours ? "open" : "hours", opensAt, closesAt };
}

// ------------------------------------------------------------------ timetables
export type TransitKind = "train" | "flight";
export interface TransitLine {
  id: string;
  kind: TransitKind;
  name: Name;
  from: string;
  to: string;
  departs: string[];
  /** Travel time in game minutes. */
  minutes: number;
  /** Boarding opens this many minutes before departure (train at the platform / gate open). Default 15. */
  board?: number;
  days?: Weekday[];
  /** Fare in coins (ticket counter). */
  fare?: number;
}
export interface Transit {
  lines: TransitLine[];
}
export type DepartureStatus = "scheduled" | "boarding" | "delayed" | "cancelled";
export interface Departure {
  line: string;
  kind: TransitKind;
  from: string;
  to: string;
  day: number;
  depart: string;
  /** Minutes since day 0 00:00 (after delay). */
  at: number;
  arrive: number;
  delay: number;
  status: DepartureStatus;
  fare: number;
}

/** Weather / flood effect on a service (deterministic). */
export function disruption(kind: TransitKind, weather: Weather, flood: number): { delay: number; cancelled: boolean } {
  if (kind === "train") return flood >= 0.85 ? { delay: 0, cancelled: true } : { delay: flood >= 0.6 ? 30 : flood >= 0.35 ? 10 : 0, cancelled: false };
  return weather === "storm" ? { delay: 45, cancelled: false } : weather === "fog" ? { delay: 20, cancelled: false } : { delay: 0, cancelled: false };
}

/** Upcoming departures from a station / airport, today and tomorrow, soonest first. */
export function departures(world: World, station: string, day: number, minute: number, o: { kind?: TransitKind; n?: number } = {}): Departure[] {
  const out: Departure[] = [];
  const now = day * 1440 + minute;
  for (const d of [day, day + 1]) {
    const wd = date(world, d).weekday;
    const fl = floodLevel(world, d);
    const we = world.calendar ? weatherOn(world, d) : "clear";
    for (const l of world.transit?.lines ?? []) {
      if (l.from !== station || (o.kind && l.kind !== o.kind) || (l.days && !l.days.includes(wd))) continue;
      const dis = disruption(l.kind, we, fl);
      for (const t of l.departs) {
        const base = toMin(t);
        if (Number.isNaN(base)) continue;
        const at = d * 1440 + base + dis.delay;
        if (at < now) continue;
        const board = l.board ?? 15;
        const status: DepartureStatus = dis.cancelled ? "cancelled" : now >= at - board ? "boarding" : dis.delay > 0 ? "delayed" : "scheduled";
        out.push({ line: l.id, kind: l.kind, from: l.from, to: l.to, day: d, depart: hhmm(base), at, arrive: at + l.minutes, delay: dis.delay, status, fare: l.fare ?? 0 });
      }
    }
  }
  out.sort((a, b) => a.at - b.at || (a.line < b.line ? -1 : 1));
  return out.slice(0, o.n ?? 8);
}

/** The service at the platform / gate right now (boarding window), or null. */
export function serviceAt(world: World, station: string, day: number, minute: number, kind?: TransitKind): Departure | null {
  return departures(world, station, day, minute, { kind, n: 4 }).find((d) => d.status === "boarding") ?? null;
}

// ------------------------------------------------------------------ flooding
export interface Flood {
  /** Level added at the end of a day with this weather. */
  rise: Partial<Record<Weather, number>>;
  /** Drained per day. */
  drain: number;
  /** Days of history considered. */
  window: number;
}
export const DEFAULT_FLOOD: Flood = { rise: { rain: 0.22, storm: 0.45 }, drain: 0.18, window: 8 };
export const FLOOD_STAGES = ["dry", "puddles", "ankle", "knee", "waist"] as const;
export type FloodStage = (typeof FLOOD_STAGES)[number];
export const FLOOD_INFO: Record<FloodStage, { at: number; walk: number; name: Name }> = {
  dry: { at: 0, walk: 1, name: n("แห้ง", "Dry", "Kering") },
  puddles: { at: 0.15, walk: 0.95, name: n("น้ำขัง", "Puddles", "Lopak air") },
  ankle: { at: 0.35, walk: 0.8, name: n("น้ำท่วมตาตุ่ม", "Ankle-deep flood", "Banjir paras buku lali") },
  knee: { at: 0.6, walk: 0.6, name: n("น้ำท่วมเข่า", "Knee-deep flood", "Banjir paras lutut") },
  waist: { at: 0.85, walk: 0.45, name: n("น้ำท่วมสูง", "Deep flood", "Banjir dalam") },
};

const floodAfter = (world: Pick<World, "flood" | "calendar" | "clock">, day: number): number => {
  if (!world.calendar || day < 0) return 0;
  const f = world.flood ?? DEFAULT_FLOOD;
  let level = 0;
  for (let d = Math.max(0, day - f.window + 1); d <= day; d++) level = Math.min(1, Math.max(0, level - f.drain) + (f.rise[weatherOn(world, d)] ?? 0));
  return level;
};

/** Flood level 0..1: rises through the day after rain / storms, drains on dry days. */
export function floodLevel(world: Pick<World, "flood" | "calendar" | "clock">, day: number, minute = 1440): number {
  const prev = floodAfter(world, day - 1);
  const cur = floodAfter(world, day);
  const t = Math.min(1, Math.max(0, minute / 720));
  return round3(prev + (cur - prev) * t);
}

export function floodStage(level: number): FloodStage {
  let s: FloodStage = "dry";
  for (const k of FLOOD_STAGES) if (level >= FLOOD_INFO[k].at) s = k;
  return s;
}

export function floodEffects(level: number) {
  const stage = floodStage(level);
  return { stage, walk: FLOOD_INFO[stage].walk, npcsIndoors: level >= 0.6, stallsClosed: level >= 0.35, trainsCancelled: level >= 0.85 };
}
