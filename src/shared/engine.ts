/**
 * Easy NPC engine — pure and deterministic, so the CLI, Godot (npc_engine.gd, parity-tested) and Pixi agree.
 *
 *   state(world, id, day, minute, night?) → where an NPC is, what it is doing, which way it faces
 *
 * Schedules are stateless: an NPC leaves for its current entry's place at the entry time and walks the A* route
 * from the previous entry's place at its speed. Save files therefore only need the clock and the affinity.
 */
import type { Clock, DialogueRef, Facing, Npc, Place, ScheduleEntry, TileMap, Weekday, World } from "./types.js";
import { WEEKDAYS } from "./types.js";

export const DEFAULT_CLOCK: Clock = { dayStart: "06:00", nightStart: "19:00", secondsPerMinute: 1, speed: 3, firstWeekday: "mon" };

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return NaN;
  return h * 60 + mm;
}
export const fmtTime = (minute: number) => {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const weekday = (clock: Clock, day: number): Weekday => WEEKDAYS[(((WEEKDAYS.indexOf(clock.firstWeekday) + day) % 7) + 7) % 7]!;

export function isNight(clock: Clock, minute: number): boolean {
  const m = ((minute % 1440) + 1440) % 1440;
  const a = toMinutes(clock.dayStart);
  const b = toMinutes(clock.nightStart);
  return a < b ? m < a || m >= b : m >= b && m < a;
}

// ------------------------------------------------------------------ grid + A*
export const walkable = (map: TileMap, x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.collision[y]?.[x] !== "#";

const DIRS: Array<[number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Nearest walkable tile (BFS in DIRS order); the tile itself when walkable. */
export function nearestWalkable(map: TileMap, x: number, y: number): [number, number] | null {
  if (walkable(map, x, y)) return [x, y];
  const seen = new Set<number>([y * map.width + x]);
  const q: Array<[number, number]> = [[x, y]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i]!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const k = ny * map.width + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      if (walkable(map, nx, ny)) return [nx, ny];
      q.push([nx, ny]);
    }
  }
  return null;
}

/**
 * 4-way A* with Manhattan distance. Ties: lowest f, then lowest h, then first pushed — written the same way in
 * GDScript so both pick the same route. Returns tiles from start to goal inclusive, [] when unreachable.
 */
export function findPath(map: TileMap, from: [number, number], to: [number, number]): Array<[number, number]> {
  const W = map.width;
  const [sx, sy] = from;
  const [gx, gy] = to;
  if (!walkable(map, sx, sy) || !walkable(map, gx, gy)) return [];
  if (sx === gx && sy === gy) return [[sx, sy]];
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  const g = new Map<number, number>([[sy * W + sx, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  // open list entries: [f, h, seq, key]
  const open: Array<[number, number, number, number]> = [[h(sx, sy), h(sx, sy), 0, sy * W + sx]];
  let seq = 1;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) bi = i;
    }
    const [, , , key] = open.splice(bi, 1)[0]!;
    if (closed.has(key)) continue;
    closed.add(key);
    const cx = key % W;
    const cy = Math.floor(key / W);
    if (cx === gx && cy === gy) {
      const path: Array<[number, number]> = [];
      let k: number | undefined = key;
      while (k !== undefined) {
        path.push([k % W, Math.floor(k / W)]);
        k = came.get(k);
      }
      return path.reverse();
    }
    const cg = g.get(key)!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(map, nx, ny)) continue;
      const nk = ny * W + nx;
      if (closed.has(nk)) continue;
      const ng = cg + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, key);
        const nh = h(nx, ny);
        open.push([ng + nh, nh, seq++, nk]);
      }
    }
  }
  return [];
}

// ------------------------------------------------------------------ schedules
export interface Active {
  entry: ScheduleEntry;
  index: number;
  start: number;
  /** Place the NPC walks from (previous active entry, or home). */
  from: string;
  /** Minutes since the entry started (≥ 0, wraps over midnight). */
  elapsed: number;
}

export const entryMatches = (e: ScheduleEntry, wd: Weekday, night: boolean) => (!e.days || e.days.includes(wd)) && (!e.when || e.when === "any" || (e.when === "night") === night);

/** The schedule entry in force at (day, minute): the latest matching entry that has started, else yesterday's last. */
export function dayList(world: World, npc: Npc, day: number, night: boolean) {
  const wd = weekday(world.clock, day);
  return npc.schedule.map((e, i) => ({ e, i, t: toMinutes(e.at) })).filter((x) => entryMatches(x.e, wd, night)).sort((a, b) => a.t - b.t || a.i - b.i);
}

/**
 * The schedule entry in force at (day, minute): the latest matching entry that has started, else yesterday's last.
 * The NPC walks from the place of the entry before it (yesterday's last for the first entry of the day).
 */
export function activeEntry(world: World, npc: Npc, day: number, minute: number, night?: boolean): Active | null {
  const n = night ?? isNight(world.clock, minute);
  const m = ((minute % 1440) + 1440) % 1440;
  const today = dayList(world, npc, day, n);
  const started = today.filter((x) => x.t <= m);
  if (started.length) {
    const cur = started[started.length - 1]!;
    const prev = started.length > 1 ? started[started.length - 2]!.e.place : (dayList(world, npc, day - 1, n).pop()?.e.place ?? npc.home);
    return { entry: cur.e, index: cur.i, start: cur.t, from: prev, elapsed: m - cur.t };
  }
  const y = dayList(world, npc, day - 1, n);
  const cur = y[y.length - 1];
  if (!cur) return null;
  const prev = (y[y.length - 2] ?? cur).e.place;
  return { entry: cur.e, index: cur.i, start: cur.t, from: prev, elapsed: m + 1440 - cur.t };
}

/** Every (from, to) place pair a schedule can walk, over a week, by day and by night. */
export function routePairs(world: World): Array<[string, string]> {
  const out = new Map<string, [string, string]>();
  for (const npc of world.npcs)
    for (let d = 0; d < 7; d++)
      for (const n of [false, true]) {
        const today = dayList(world, npc, d, n);
        const y = dayList(world, npc, d - 1, n);
        let prev = y.length ? y[y.length - 1]!.e.place : npc.home;
        for (const x of today) {
          out.set(routeKey(prev, x.e.place), [prev, x.e.place]);
          prev = x.e.place;
        }
        if (y.length > 1) out.set(routeKey(y[y.length - 2]!.e.place, y[y.length - 1]!.e.place), [y[y.length - 2]!.e.place, y[y.length - 1]!.e.place]);
      }
  return [...out.values()].sort((a, b) => routeKey(...a).localeCompare(routeKey(...b)));
}

export const routeKey = (a: string, b: string) => `${a}>${b}`;

export function placeTile(world: World, id: string): [number, number] | null {
  const p: Place | undefined = world.places[id];
  if (!p) return null;
  return nearestWalkable(world.map, p.x, p.y);
}

export function route(world: World, from: string, to: string): Array<[number, number]> {
  const pre = world.routes?.[routeKey(from, to)];
  if (pre) return pre;
  const a = placeTile(world, from);
  const b = placeTile(world, to);
  if (!a || !b) return [];
  return findPath(world.map, a, b);
}

export interface NpcState {
  id: string;
  /** Tile position (fractional while walking). */
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  activity: string;
  place: string;
  /** Hidden inside a building. */
  indoors: boolean;
  night: boolean;
  entry: number;
  /** Tiles walked / route length. */
  progress: number;
  routeLength: number;
}

const facingOf = (dx: number, dy: number): Facing => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : dx < 0 ? "left" : "front") : dy > 0 ? "front" : "back");

export function state(world: World, id: string, day: number, minute: number, night?: boolean): NpcState | null {
  const npc = world.npcs.find((n) => n.id === id);
  if (!npc) return null;
  const n = night ?? isNight(world.clock, minute);
  const act = activeEntry(world, npc, day, minute, n);
  const home = placeTile(world, npc.home) ?? [0, 0];
  if (!act) return { id, x: home[0], y: home[1], facing: "front", moving: false, activity: "idle", place: npc.home, indoors: false, night: n, entry: -1, progress: 0, routeLength: 0 };
  const path = route(world, act.from, act.entry.place);
  const speed = npc.speed ?? world.clock.speed;
  const len = Math.max(0, path.length - 1);
  const walked = act.elapsed * speed;
  if (!path.length) {
    const t = placeTile(world, act.entry.place) ?? home;
    return { id, x: t[0], y: t[1], facing: act.entry.facing ?? world.places[act.entry.place]?.facing ?? "front", moving: false, activity: act.entry.activity, place: act.entry.place, indoors: !!act.entry.indoors, night: n, entry: act.index, progress: 0, routeLength: 0 };
  }
  if (walked >= len) {
    const [x, y] = path[path.length - 1]!;
    const last = path.length > 1 ? path[path.length - 2]! : path[0]!;
    const face = act.entry.facing ?? world.places[act.entry.place]?.facing ?? (path.length > 1 ? facingOf(x - last[0], y - last[1]) : "front");
    return { id, x, y, facing: face, moving: false, activity: act.entry.activity, place: act.entry.place, indoors: !!act.entry.indoors, night: n, entry: act.index, progress: len, routeLength: len };
  }
  const i = Math.floor(walked);
  const f = walked - i;
  const [ax, ay] = path[i]!;
  const [bx, by] = path[i + 1]!;
  return { id, x: ax + (bx - ax) * f, y: ay + (by - ay) * f, facing: facingOf(bx - ax, by - ay), moving: true, activity: "walk", place: act.entry.place, indoors: false, night: n, entry: act.index, progress: walked, routeLength: len };
}

/** Every NPC at once. */
export const states = (world: World, day: number, minute: number, night?: boolean) => world.npcs.map((n) => state(world, n.id, day, minute, night)!);

// ------------------------------------------------------------------ affinity
export interface Bond {
  points: number;
  lastTalk: number;
  lastGift: number;
}

export const newBond = (npc: Npc): Bond => ({ points: npc.affinity?.start ?? 0, lastTalk: -1, lastGift: -1 });
const clampPts = (npc: Npc, p: number) => Math.max(0, Math.min(npc.affinity?.max ?? 100, p));

export const GIFT_POINTS = { loved: 8, liked: 4, neutral: 1, disliked: -4 } as const;

export function giftKind(npc: Npc, item: string): keyof typeof GIFT_POINTS {
  const g = npc.affinity?.gifts ?? {};
  if (g.loved?.includes(item)) return "loved";
  if (g.liked?.includes(item)) return "liked";
  if (g.disliked?.includes(item)) return "disliked";
  return "neutral";
}

/** First talk of the day adds affinity.talk points. Returns the change. */
export function talk(npc: Npc, b: Bond, day: number): number {
  if (b.lastTalk === day) return 0;
  b.lastTalk = day;
  const before = b.points;
  b.points = clampPts(npc, b.points + (npc.affinity?.talk ?? 1));
  return b.points - before;
}

/** One gift per day counts. Returns { kind, delta } (delta 0 when already gifted today). */
export function gift(npc: Npc, b: Bond, item: string, day: number): { kind: keyof typeof GIFT_POINTS; delta: number } {
  const kind = giftKind(npc, item);
  if (b.lastGift === day) return { kind, delta: 0 };
  b.lastGift = day;
  const before = b.points;
  b.points = clampPts(npc, b.points + GIFT_POINTS[kind]);
  return { kind, delta: b.points - before };
}

export function level(npc: Npc, points: number): { index: number; at: number; name: { th: string; en: string; ms?: string } | null; dialogue?: DialogueRef } {
  const lv = [...(npc.affinity?.levels ?? [])].sort((a, b) => a.at - b.at);
  let idx = -1;
  lv.forEach((l, i) => {
    if (points >= l.at) idx = i;
  });
  const l = lv[idx];
  return { index: idx, at: l?.at ?? 0, name: l?.name ?? null, dialogue: l?.dialogue };
}

/** Which dialogue to open when the player talks: activity entry > highest affinity level > NPC default. */
export function dialogueFor(world: World, npc: Npc, b: Bond, day: number, minute: number, night?: boolean): DialogueRef | null {
  const act = activeEntry(world, npc, day, minute, night);
  const st = state(world, npc.id, day, minute, night);
  if (act?.entry.dialogue && st && !st.moving) return act.entry.dialogue;
  const lv = level(npc, b.points);
  return lv.dialogue ?? npc.dialogue ?? null;
}

/** Quests this NPC offers now (affinity and time window). */
export function questsFor(npc: Npc, b: Bond, minute: number): string[] {
  const m = ((minute % 1440) + 1440) % 1440;
  return (npc.quests ?? [])
    .filter((q) => b.points >= (q.minAffinity ?? 0))
    .filter((q) => {
      const a = q.from ? toMinutes(q.from) : 0;
      const z = q.to ? toMinutes(q.to) : 1440;
      return a <= z ? m >= a && m < z : m >= a || m < z;
    })
    .map((q) => q.quest);
}

/** Nearest NPC to a tile within `radius` tiles that is not indoors. */
export function nearest(world: World, day: number, minute: number, x: number, y: number, radius = 1.5, night?: boolean): NpcState | null {
  let best: NpcState | null = null;
  let bd = Infinity;
  for (const s of states(world, day, minute, night)) {
    if (s.indoors) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= radius && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
