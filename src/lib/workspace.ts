import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CALENDAR, DEFAULT_CLOCK, DEFAULT_FLOOD, findPath, parseHours, nearestWalkable, placeTile, routeKey, routePairs, toMinutes } from "../shared/engine.js";
import { CULTURES, FACINGS, FORMAT, WEATHERS, WEEKDAYS, WHEN, type Calendar, type Clock, type Diagnostic, type Name, type Npc, type NpcDoc, type Place, type TileMap, type World } from "../shared/types.js";
import type { Flood, Lighting, Shop, TransitLine } from "../shared/townlife.js";
import { assertSafeId, pkgRoot, resolveInside, resolveWorkspace, SAMPLES_DIR } from "./fsx.js";

export { assertSafeId, resolveWorkspace, resolveInside };

export const dirs = (root: string) => ({ npcs: path.join(root, "npcs"), maps: path.join(root, "maps"), characters: path.join(root, "characters"), dialogues: path.join(root, "dialogues"), quests: path.join(root, "quests"), exports: path.join(root, "exports") });

export async function initWorkspace(root: string, opts: { force?: boolean } = {}) {
  const written: string[] = [];
  for (const sub of ["npcs", "maps", "characters", "dialogues", "quests"]) {
    const src = path.join(SAMPLES_DIR, sub);
    const dst = path.join(root, sub);
    await mkdir(dst, { recursive: true });
    if (!existsSync(src)) continue;
    for (const f of await readdir(src)) {
      const t = path.join(dst, f);
      if (existsSync(t) && !opts.force) continue;
      await copyFile(path.join(src, f), t);
      written.push(t);
    }
  }
  return written;
}

export interface DocFile {
  id: string;
  file: string;
  doc?: NpcDoc;
  parseError?: string;
}

export async function listDocs(root: string): Promise<DocFile[]> {
  const d = dirs(root).npcs;
  if (!existsSync(d)) return [];
  const out: DocFile[] = [];
  for (const f of (await readdir(d)).filter((x) => x.endsWith(".easynpc.json")).sort()) {
    const file = path.join(d, f);
    try {
      out.push({ id: f.slice(0, -13), file, doc: JSON.parse(await readFile(file, "utf8")) as NpcDoc });
    } catch (e) {
      out.push({ id: f.slice(0, -13), file, parseError: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function readDoc(root: string, id: string): Promise<NpcDoc | null> {
  const f = path.join(dirs(root).npcs, `${assertSafeId(id, "document id")}.easynpc.json`);
  return existsSync(f) ? (JSON.parse(await readFile(f, "utf8")) as NpcDoc) : null;
}

export async function loadMap(root: string, rel: string): Promise<TileMap> {
  const file = resolveInside(root, rel);
  if (!existsSync(file)) throw new Error(`Map ${rel} not found (export it with: easytilemap export <map> --preset pixi, then copy <map>.tilemap.json into maps/)`);
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  let collision = raw.collision as string[] | undefined;
  if (!collision && raw.layers && typeof raw.layers === "object") collision = (raw.layers as Record<string, string[]>).collision;
  if (!Array.isArray(collision)) throw new Error(`${rel}: no collision grid (use the .tilemap.json from easytilemap export)`);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (collision.length !== height || collision.some((r) => r.length !== width)) throw new Error(`${rel}: collision grid is not ${width}×${height}`);
  return { id: String(raw.id ?? path.basename(rel).replace(/\..*$/, "")), width, height, tileSize: Number(raw.tileSize ?? 16), collision };
}

/** Spawn points of an Easy Tilemap export as places (pixels → tiles). */
export async function mapSpawns(root: string, rel: string): Promise<Record<string, Place>> {
  const raw = JSON.parse(await readFile(resolveInside(root, rel), "utf8")) as { tileSize?: number; spawns?: Array<{ name: string; x: number; y: number }>; layers?: unknown };
  const ts = raw.tileSize ?? 16;
  const px = !raw.layers; // exports use pixels, source maps use tiles
  return Object.fromEntries((raw.spawns ?? []).map((s) => [s.name, { x: px ? Math.floor(s.x / ts) : s.x, y: px ? Math.floor(s.y / ts) : s.y }]));
}

export interface LoadResult {
  world: World | null;
  docs: DocFile[];
  sources: Record<string, string>;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  mapFile?: string;
}

const SACRED = /\b(prophet|muhammad|allah|quran|koran|jesus|buddha image)\b|นบี|ศาสดา|อัลกุรอาน|อัลลอฮ์|พระพุทธรูป|คัมภีร์/i;
const NOT_HALAL = /pork|bacon|ham\b|lard|moo_|_moo|beer|wine|whisky|sake|alcohol|lao_khao|หมู|เหล้า|เบียร์/i;
const RITUAL = /\b(prayer|worship|sermon|ordination|alms|merit|mass|eid prayer)\b|ละหมาด|บวช|ตักบาตร|ทำบุญ|เทศน์|พิธีกรรม/i;
const nameOk = (n: unknown): n is Name => !!n && typeof n === "object" && typeof (n as Name).th === "string" && !!(n as Name).th && typeof (n as Name).en === "string" && !!(n as Name).en;

/** Merge every npcs/*.easynpc.json into one world and validate it. */
export async function loadWorld(root: string, opts: { routes?: boolean } = {}): Promise<LoadResult> {
  const docs = await listDocs(root);
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const sources: Record<string, string> = {};
  const err = (p: string, message: string) => errors.push({ path: p, message });
  const warn = (p: string, message: string) => warnings.push({ path: p, message });
  let mapRel: string | undefined;
  let clock: Clock = { ...DEFAULT_CLOCK };
  const calendar: Calendar = structuredClone(DEFAULT_CALENDAR);
  const places: Record<string, Place> = {};
  const activities: Record<string, Name> = {};
  const npcs: Npc[] = [];
  let lighting: Lighting | undefined;
  const shops: Record<string, Shop> = {};
  const lines: TransitLine[] = [];
  let flood: Flood = structuredClone(DEFAULT_FLOOD);
  let floodSet = false;
  for (const d of docs) {
    const f = `npcs/${d.id}.easynpc.json`;
    if (d.parseError) {
      err(f, `JSON: ${d.parseError}`);
      continue;
    }
    const doc = d.doc!;
    if (doc.format !== FORMAT) err(f, `format must be "${FORMAT}"`);
    if (doc.map) {
      if (mapRel && mapRel !== doc.map) err(f, `map ${doc.map} differs from ${mapRel} (one map per workspace)`);
      mapRel ??= doc.map;
    }
    if (doc.clock) {
      clock = { ...clock, ...doc.clock };
      for (const k of ["dayStart", "nightStart"] as const) if (doc.clock[k] !== undefined && Number.isNaN(toMinutes(doc.clock[k]!))) err(`${f}:clock.${k}`, `"${doc.clock[k]}" is not HH:MM`);
      if (doc.clock.speed !== undefined && !(doc.clock.speed > 0)) err(`${f}:clock.speed`, "speed must be > 0 (tiles per game minute)");
      if (doc.clock.firstWeekday && !WEEKDAYS.includes(doc.clock.firstWeekday)) err(`${f}:clock.firstWeekday`, `use ${WEEKDAYS.join("|")}`);
    }
    if (doc.calendar) {
      const c = doc.calendar;
      for (const k of ["daysPerSeason", "startYear", "weatherSeed", "persistence"] as const) if (c[k] !== undefined) calendar[k] = c[k]!;
      if (c.seasons) calendar.seasons = c.seasons;
      if (c.events) calendar.events = c.events;
      if (!(calendar.daysPerSeason >= 1)) err(`${f}:calendar.daysPerSeason`, "must be >= 1");
      if (!(calendar.persistence >= 0 && calendar.persistence <= 1)) err(`${f}:calendar.persistence`, "must be between 0 and 1");
      if (!calendar.seasons.length) err(`${f}:calendar.seasons`, "needs at least one season");
      for (const [i, se] of calendar.seasons.entries()) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(se.id ?? "")) err(`${f}:calendar.seasons[${i}]`, "id must match ^[a-z0-9][a-z0-9_-]*$");
        if (!nameOk(se.name)) err(`${f}:calendar.seasons[${i}].name`, "name needs th and en");
        for (const k of Object.keys(se.weather ?? {})) if (!(WEATHERS as readonly string[]).includes(k)) err(`${f}:calendar.seasons[${i}].weather.${k}`, `use ${WEATHERS.join("|")}`);
      }
      for (const [i, ev] of calendar.events.entries()) {
        const q = `${f}:calendar.events[${i}]${ev?.id ? `(${ev.id})` : ""}`;
        if (!nameOk(ev.name)) err(`${q}.name`, "name needs th and en");
        if (ev.season && !calendar.seasons.some((x) => x.id === ev.season)) err(`${q}.season`, `unknown season "${ev.season}"`);
        if (ev.weekday && !WEEKDAYS.includes(ev.weekday)) err(`${q}.weekday`, `use ${WEEKDAYS.join("|")}`);
        for (const k of ["from", "to"] as const) if (ev[k] && Number.isNaN(toMinutes(ev[k]!))) err(`${q}.${k}`, "not HH:MM");
        for (const t of [ev.name?.th, ev.name?.en]) if (t && (SACRED.test(t) || RITUAL.test(t))) err(q, `content rule: festivals stay multicultural and non-ritual (market, harvest, kites, boats) ("${t}")`);
      }
    }
    // town life: lighting keyframes, shop hours, transit timetables, flooding
    if (doc.lighting) {
      if (!Array.isArray(doc.lighting.keys) || doc.lighting.keys.length < 2) err(`${f}:lighting.keys`, "needs at least two keyframes");
      for (const [i, k] of (doc.lighting.keys ?? []).entries()) {
        if (Number.isNaN(toMinutes(k.at ?? ""))) err(`${f}:lighting.keys[${i}].at`, `"${k.at}" is not HH:MM`);
        if (!/^#[0-9a-fA-F]{6}$/.test(k.tint ?? "")) err(`${f}:lighting.keys[${i}].tint`, "tint must be #rrggbb");
        for (const q of ["dark", "lamps"] as const) if (!(k[q] >= 0 && k[q] <= 1)) err(`${f}:lighting.keys[${i}].${q}`, "must be between 0 and 1");
      }
      lighting = doc.lighting;
    }
    for (const [id, sh] of Object.entries(doc.shops ?? {})) {
      const q = `${f}:shops.${id}`;
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) err(q, "shop id must match ^[a-z0-9][a-z0-9_-]*$");
      if (shops[id]) err(q, "duplicate shop");
      if (!nameOk(sh.name)) err(`${q}.name`, "name needs th and en");
      if (!parseHours(sh.hours)) err(`${q}.hours`, `"${sh.hours}" is not HH:MM-HH:MM`);
      if (sh.closedOn?.some((x) => !WEEKDAYS.includes(x))) err(`${q}.closedOn`, `use ${WEEKDAYS.join(", ")}`);
      if (sh.kind && !["shop", "stall", "counter"].includes(sh.kind)) err(`${q}.kind`, "use shop|stall|counter");
      shops[id] = sh;
    }
    for (const [i, l] of (doc.transit?.lines ?? []).entries()) {
      const q = `${f}:transit.lines[${i}]${l?.id ? `(${l.id})` : ""}`;
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(l.id ?? "")) err(q, "id must match ^[a-z0-9][a-z0-9_-]*$");
      if (lines.some((x) => x.id === l.id)) err(q, "duplicate line id");
      if (l.kind !== "train" && l.kind !== "flight") err(`${q}.kind`, "use train|flight");
      if (!nameOk(l.name)) err(`${q}.name`, "name needs th and en");
      if (!l.from || !l.to || l.from === l.to) err(q, "from and to must be two different stations / airports");
      if (!Array.isArray(l.departs) || !l.departs.length || l.departs.some((t) => Number.isNaN(toMinutes(t)))) err(`${q}.departs`, "needs HH:MM departure times");
      if (!(l.minutes > 0)) err(`${q}.minutes`, "travel minutes must be > 0");
      if (l.days?.some((x) => !WEEKDAYS.includes(x))) err(`${q}.days`, `use ${WEEKDAYS.join(", ")}`);
      lines.push(l);
    }
    if (doc.flood) {
      floodSet = true;
      flood = { ...flood, ...doc.flood, rise: { ...flood.rise, ...(doc.flood.rise ?? {}) } };
      for (const k of Object.keys(doc.flood.rise ?? {})) if (!(WEATHERS as readonly string[]).includes(k)) err(`${f}:flood.rise.${k}`, `use ${WEATHERS.join("|")}`);
      if (!(flood.drain >= 0 && flood.drain <= 1)) err(`${f}:flood.drain`, "must be between 0 and 1");
      if (!(Number.isInteger(flood.window) && flood.window >= 1 && flood.window <= 60)) err(`${f}:flood.window`, "integer days 1..60");
    }
    for (const [id, p] of Object.entries(doc.places ?? {})) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) err(`${f}:places.${id}`, "place id must match ^[a-z0-9][a-z0-9_-]*$");
      if (places[id]) err(`${f}:places.${id}`, `duplicate place (also in ${sources[`place:${id}`]})`);
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) err(`${f}:places.${id}`, "x and y must be integer tiles");
      if (p.facing && !FACINGS.includes(p.facing)) err(`${f}:places.${id}.facing`, `use ${FACINGS.join("|")}`);
      places[id] = p;
      sources[`place:${id}`] = `${d.id}.easynpc.json`;
    }
    Object.assign(activities, doc.activities ?? {});
    (doc.npcs ?? []).forEach((n, i) => {
      const p = `${f}:npcs[${i}]${n?.id ? `(${n.id})` : ""}`;
      if (!n || typeof n !== "object") return err(p, "npc must be an object");
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(n.id ?? "")) err(p, "id must match ^[a-z0-9][a-z0-9_-]*$");
      if (npcs.some((x) => x.id === n.id)) err(p, `duplicate npc id "${n.id}" (also in ${sources[`npc:${n.id}`]})`);
      if (!nameOk(n.name)) err(`${p}.name`, "name needs th and en");
      if (!n.sprite || !/^[a-z0-9][a-z0-9_-]*$/.test(n.sprite)) err(`${p}.sprite`, "sprite must be an Easy Sprite top-down sheet id (characters/<id>.png)");
      else if (!existsSync(path.join(dirs(root).characters, `${n.sprite}.png`))) warn(`${p}.sprite`, `characters/${n.sprite}.png not found (the NPC is drawn as a marker)`);
      if (n.culture && !CULTURES.includes(n.culture)) err(`${p}.culture`, `use ${CULTURES.join("|")}`);
      if (n.speed !== undefined && !(n.speed > 0)) err(`${p}.speed`, "speed must be > 0");
      if (!Array.isArray(n.schedule) || !n.schedule.length) err(`${p}.schedule`, "schedule needs at least one entry");
      for (const [k, e] of (n.schedule ?? []).entries()) {
        const q = `${p}.schedule[${k}]`;
        if (Number.isNaN(toMinutes(e.at ?? ""))) err(q, `at "${e.at}" is not HH:MM`);
        if (!e.activity) err(q, "activity is required");
        if (e.days && (!Array.isArray(e.days) || e.days.some((x) => !WEEKDAYS.includes(x)))) err(`${q}.days`, `use ${WEEKDAYS.join(", ")}`);
        if (e.when && !WHEN.includes(e.when)) err(`${q}.when`, `use ${WHEN.join("|")}`);
        if (e.facing && !FACINGS.includes(e.facing)) err(`${q}.facing`, `use ${FACINGS.join("|")}`);
        for (const k of ["weather", "notWeather"] as const) if (e[k] && (!Array.isArray(e[k]) || e[k]!.some((x) => !(WEATHERS as readonly string[]).includes(x)))) err(`${q}.${k}`, `use ${WEATHERS.join(", ")}`);
      }
      const he = n.affinity?.heartEvents ?? [];
      for (const [k, h] of he.entries()) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(h.id ?? "")) err(`${p}.affinity.heartEvents[${k}]`, "id must match ^[a-z0-9][a-z0-9_-]*$");
        if (!(Number.isInteger(h.hearts) && h.hearts >= 1)) err(`${p}.affinity.heartEvents[${k}].hearts`, "hearts must be an integer >= 1");
        if (he.findIndex((x) => x.id === h.id) !== k) err(`${p}.affinity.heartEvents[${k}]`, `duplicate heart event "${h.id}"`);
      }
      const lv = n.affinity?.levels ?? [];
      if (lv.some((l, j) => j > 0 && l.at <= lv[j - 1]!.at)) err(`${p}.affinity.levels`, "levels must be in increasing order of at");
      for (const l of lv) if (!nameOk(l.name)) err(`${p}.affinity.levels`, `level at ${l.at} needs a name with th and en`);
      if (n.affinity?.max !== undefined && n.affinity.max <= 0) err(`${p}.affinity.max`, "max must be > 0");
      const gifts = [...(n.affinity?.gifts?.loved ?? []), ...(n.affinity?.gifts?.liked ?? [])];
      if (n.culture === "malay" && gifts.some((g) => NOT_HALAL.test(g))) err(`${p}.affinity.gifts`, `a Muslim neighbour cannot love or like a non-halal item (${gifts.filter((g) => NOT_HALAL.test(g)).join(", ")})`);
      for (const t of [n.name?.th, n.name?.en, n.role?.th, n.role?.en]) if (t && SACRED.test(t)) err(p, `content rule: no sacred figures or scripture as NPCs ("${t}")`);
      for (const qh of n.quests ?? []) for (const k of ["from", "to"] as const) if (qh[k] && Number.isNaN(toMinutes(qh[k]!))) err(`${p}.quests(${qh.quest}).${k}`, "not HH:MM");
      npcs.push(n);
      sources[`npc:${n.id}`] = `${d.id}.easynpc.json`;
    });
  }
  if (!docs.length) err("npcs/", "no npcs/*.easynpc.json (run easynpc init)");
  if (!mapRel) {
    err("npcs/", "no document sets map (an Easy Tilemap .tilemap.json)");
    return { world: null, docs, sources, errors, warnings };
  }
  let map: TileMap;
  try {
    map = await loadMap(root, mapRel);
  } catch (e) {
    err(mapRel, e instanceof Error ? e.message : String(e));
    return { world: null, docs, sources, errors, warnings, mapFile: mapRel };
  }
  // map spawns become places when not defined
  for (const [id, p] of Object.entries(await mapSpawns(root, mapRel))) if (!places[id] && id !== "player") places[id] = p;
  const world: World = { map, clock, places, npcs, activities, calendar };
  if (floodSet) world.flood = flood;
  if (lighting) world.lighting = lighting;
  if (Object.keys(shops).length) world.shops = shops;
  if (lines.length) world.transit = { lines };
  for (const [id, p] of Object.entries(places)) {
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) err(`place ${id}`, `(${p.x},${p.y}) is outside the ${map.width}×${map.height} map`);
    else if (map.collision[p.y]![p.x] === "#") {
      const t = nearestWalkable(map, p.x, p.y);
      warn(`place ${id}`, `(${p.x},${p.y}) is blocked; NPCs stand at the nearest walkable tile ${t ? `(${t[0]},${t[1]})` : "— none"}`);
    }
  }
  for (const n of npcs) {
    const p = `npc ${n.id}`;
    for (const ref of [n.home, ...(n.schedule ?? []).map((e) => e.place)]) if (ref && !places[ref]) err(p, `unknown place "${ref}" (${Object.keys(places).join(", ")})`);
    for (const e of n.schedule ?? []) if (e.activity && Object.keys(activities).length && !activities[e.activity]) warn(p, `activity "${e.activity}" has no display name in activities`);
  }
  if (!errors.length && opts.routes !== false) {
    const routes: Record<string, Array<[number, number]>> = {};
    for (const [a, b] of routePairs(world)) {
      const ta = placeTile(world, a);
      const tb = placeTile(world, b);
      const r = ta && tb ? findPath(map, ta, tb) : [];
      if (!r.length) err(`route ${a} → ${b}`, `no walkable path on ${map.id} (blocked by collision)`);
      routes[routeKey(a, b)] = r;
    }
    world.routes = routes;
  }
  return { world, docs, sources, errors, warnings, mapFile: mapRel };
}

export async function loadWorldStrict(root: string): Promise<World> {
  const r = await loadWorld(root);
  if (r.errors.length || !r.world) throw new Error(`Workspace has errors:\n${r.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  return r.world;
}

export async function saveDoc(root: string, id: string, doc: unknown, opts: { dryRun?: boolean } = {}) {
  assertSafeId(id, "document id");
  const file = path.join(dirs(root).npcs, `${id}.easynpc.json`);
  const prev = existsSync(file) ? await readFile(file, "utf8") : null;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await loadWorld(root);
  if (r.errors.length || opts.dryRun) {
    if (prev === null) await import("node:fs/promises").then((m) => m.rm(file));
    else await writeFile(file, prev);
  }
  return { saved: !r.errors.length && !opts.dryRun, file, errors: r.errors, warnings: r.warnings };
}

// ------------------------------------------------------------------ Easy Dialogue / Easy Quest cross-checks
export interface EzdInfo {
  id: string;
  file: string;
  start?: string;
  nodes: string[];
  chars: string[];
}

export async function scanDialogues(dir: string): Promise<EzdInfo[]> {
  if (!existsSync(dir)) return [];
  const out: EzdInfo[] = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".ezd")).sort()) {
    const t = await readFile(path.join(dir, f), "utf8");
    const id = /^@id\s+(\S+)/m.exec(t)?.[1] ?? f.slice(0, -4);
    out.push({ id, file: f, start: /^@start\s+(\S+)/m.exec(t)?.[1], nodes: [...t.matchAll(/^===\s+(\S+)/gm)].map((m) => m[1]!), chars: [...t.matchAll(/^@char\s+(\S+)/gm)].map((m) => m[1]!) });
  }
  return out;
}

export async function scanQuests(dir: string): Promise<Array<{ id: string; file: string; quests: Array<{ id: string; giver?: string }> }>> {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".ezq")).sort()) {
    const t = await readFile(path.join(dir, f), "utf8");
    const quests: Array<{ id: string; giver?: string }> = [];
    for (const line of t.split(/\r?\n/)) {
      const m = /^===\s+(\S+)/.exec(line);
      if (m) quests.push({ id: m[1]! });
      const g = /^giver\s+(\S+)/.exec(line.trim());
      if (g && quests.length) quests[quests.length - 1]!.giver = g[1];
    }
    out.push({ id: /^@id\s+(\S+)/m.exec(t)?.[1] ?? f.slice(0, -4), file: f, quests });
  }
  return out;
}

export interface CheckResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  cross: { dialogues: number; quests: number; routes: number; places: number; npcs: number };
}

export async function checkWorkspace(root: string, opts: { dialogues?: string; quests?: string } = {}): Promise<CheckResult> {
  const r = await loadWorld(root);
  const errors = [...r.errors];
  const warnings = [...r.warnings];
  const cross = { dialogues: 0, quests: 0, routes: Object.keys(r.world?.routes ?? {}).length, places: Object.keys(r.world?.places ?? {}).length, npcs: r.world?.npcs.length ?? 0 };
  if (!r.world) return { errors, warnings, cross };
  const dDir = opts.dialogues ? path.resolve(root, opts.dialogues) : dirs(root).dialogues;
  const qDir = opts.quests ? path.resolve(root, opts.quests) : dirs(root).quests;
  const ezd = await scanDialogues(dDir);
  const ezq = await scanQuests(qDir);
  const refs: Array<{ npc: string; where: string; ref: { dialogue: string; node?: string } }> = [];
  for (const n of r.world.npcs) {
    if (n.dialogue) refs.push({ npc: n.id, where: "dialogue", ref: n.dialogue });
    for (const l of n.affinity?.levels ?? []) if (l.dialogue) refs.push({ npc: n.id, where: `affinity ${l.at}`, ref: l.dialogue });
    for (const e of n.schedule) if (e.dialogue) refs.push({ npc: n.id, where: `schedule ${e.at}`, ref: e.dialogue });
  }
  if (refs.length && !ezd.length) warnings.push({ path: path.relative(root, dDir) || ".", message: "no .ezd files to check dialogue references against" });
  else
    for (const x of refs) {
      const s = ezd.find((d) => d.id === x.ref.dialogue);
      if (!s) errors.push({ path: `npc ${x.npc} (${x.where})`, message: `Easy Dialogue script "${x.ref.dialogue}" not found in ${path.relative(root, dDir)}` });
      else {
        cross.dialogues++;
        if (x.ref.node && !s.nodes.includes(x.ref.node)) errors.push({ path: `npc ${x.npc} (${x.where})`, message: `${s.file} has no node "${x.ref.node}" (${s.nodes.join(", ")})` });
        if (!s.chars.includes(x.npc)) warnings.push({ path: `npc ${x.npc}`, message: `${s.file} has no @char ${x.npc} (portrait / name will not match)` });
      }
    }
  const allQuests = ezq.flatMap((f) => f.quests.map((q) => ({ ...q, file: f.file })));
  for (const n of r.world.npcs)
    for (const q of n.quests ?? []) {
      const found = allQuests.find((x) => x.id === q.quest);
      if (!ezq.length) warnings.push({ path: `npc ${n.id}`, message: `no .ezq files to check quest "${q.quest}" against` });
      else if (!found) errors.push({ path: `npc ${n.id}`, message: `Easy Quest quest "${q.quest}" not found in ${path.relative(root, qDir)}` });
      else {
        cross.quests++;
        if (found.giver && found.giver !== n.id) warnings.push({ path: `npc ${n.id}`, message: `quest ${q.quest} in ${found.file} has giver ${found.giver}, not ${n.id}` });
      }
    }
  return { errors, warnings, cross };
}

export async function workspaceSummary(root: string) {
  const r = await loadWorld(root, { routes: false });
  const w = r.world;
  return {
    root,
    docs: r.docs.map((d) => d.id),
    map: w ? { id: w.map.id, file: r.mapFile, width: w.map.width, height: w.map.height, tileSize: w.map.tileSize } : null,
    clock: w?.clock ?? null,
    places: w ? Object.entries(w.places).map(([id, p]) => ({ id, x: p.x, y: p.y, th: p.name?.th ?? id, en: p.name?.en ?? id })) : [],
    npcs: (w?.npcs ?? []).map((n) => ({ id: n.id, th: n.name?.th, en: n.name?.en, role: n.role?.th ?? null, sprite: n.sprite, culture: n.culture ?? null, home: n.home, entries: n.schedule?.length ?? 0, quests: (n.quests ?? []).map((q) => q.quest), color: n.color ?? null })),
    activities: w?.activities ?? {},
    errors: r.errors,
    warnings: r.warnings,
  };
}

export const SAMPLE_PKG = pkgRoot;
