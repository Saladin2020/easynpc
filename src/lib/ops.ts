/** Operations shared by the CLI, the web API and the MCP server. */
import { activeEntry, dayList, findPath, fmtTime, isNight, placeTile, route, state, states, toMinutes, weekday, level, dialogueFor, questsFor, newBond, talk, gift, type NpcState } from "../shared/engine.js";
import type { Npc, NpcDoc, ScheduleEntry, World } from "../shared/types.js";
import { FORMAT } from "../shared/types.js";
import { listDocs, loadWorldStrict, readDoc, saveDoc } from "./workspace.js";

export function parseTime(t: string | number | undefined, def = 0): number {
  if (t === undefined || t === "") return def;
  if (typeof t === "number") return t;
  const m = toMinutes(t);
  if (Number.isNaN(m)) throw new Error(`time "${t}" is not HH:MM`);
  return m;
}

/** Everyone at (day, time): position, activity, place, whether walking / indoors. */
export function whereAt(world: World, day: number, minute: number, night?: boolean) {
  return {
    day,
    weekday: weekday(world.clock, day),
    time: fmtTime(minute),
    night: night ?? isNight(world.clock, minute),
    npcs: states(world, day, minute, night).map((s) => ({ ...s, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, name: world.npcs.find((n) => n.id === s.id)!.name })),
  };
}

/** One NPC's day: each entry with travel time and arrival. */
export function npcDay(world: World, id: string, day: number, night = false) {
  const npc = world.npcs.find((n) => n.id === id);
  if (!npc) throw new Error(`No NPC ${id} (${world.npcs.map((n) => n.id).join(", ")})`);
  const list = dayList(world, npc, day, night);
  const speed = npc.speed ?? world.clock.speed;
  return {
    id,
    name: npc.name,
    day,
    weekday: weekday(world.clock, day),
    night,
    entries: list.map((x) => {
      const act = activeEntry(world, npc, day, x.t, night)!;
      const r = route(world, act.from, x.e.place);
      const walk = Math.max(0, r.length - 1) / speed;
      return { at: x.e.at, from: act.from, place: x.e.place, activity: x.e.activity, tiles: Math.max(0, r.length - 1), walkMinutes: Math.round(walk * 10) / 10, arrive: fmtTime(x.t + Math.ceil(walk)), indoors: !!x.e.indoors, when: x.e.when ?? "any", days: x.e.days ?? null, dialogue: x.e.dialogue ?? null };
    }),
  };
}

export function pathBetween(world: World, from: string, to: string) {
  const a = world.places[from] ? placeTile(world, from) : parseTile(from);
  const b = world.places[to] ? placeTile(world, to) : parseTile(to);
  if (!a || !b) throw new Error(`Unknown place (use a place id or x,y): ${!a ? from : to}`);
  const p = findPath(world.map, a, b);
  return { from: a, to: b, tiles: Math.max(0, p.length - 1), reachable: p.length > 0, path: p };
}
const parseTile = (s: string): [number, number] | null => {
  const m = /^(\d+),(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** Talk / gift simulation over several days (affinity curve, which dialogue opens, which quests appear). */
export function simulateBond(world: World, id: string, plan: Array<{ day: number; time?: string; talk?: boolean; gift?: string }>) {
  const npc = world.npcs.find((n) => n.id === id);
  if (!npc) throw new Error(`No NPC ${id}`);
  const b = newBond(npc);
  return {
    id,
    start: b.points,
    steps: plan.map((p) => {
      const m = parseTime(p.time, 600);
      const out: Record<string, unknown> = { day: p.day, time: fmtTime(m) };
      if (p.talk !== false) out.talk = talk(npc, b, p.day);
      if (p.gift) out.gift = { item: p.gift, ...gift(npc, b, p.gift, p.day) };
      const lv = level(npc, b.points);
      out.points = b.points;
      out.level = lv.name?.en ?? null;
      out.levelTh = lv.name?.th ?? null;
      out.dialogue = dialogueFor(world, npc, b, p.day, m);
      out.quests = questsFor(npc, b, m);
      return out;
    }),
  };
}

/** Find which document holds an NPC (default: the first document). */
async function docFor(root: string, npcId?: string): Promise<{ id: string; doc: NpcDoc }> {
  const docs = await listDocs(root);
  for (const d of docs) if (d.doc?.npcs?.some((n) => n.id === npcId)) return { id: d.id, doc: d.doc };
  const first = docs.find((d) => d.doc);
  if (first) return { id: first.id, doc: first.doc! };
  return { id: "village", doc: { format: FORMAT, npcs: [] } };
}

/** Add or replace an NPC (whole object). Validated before writing. */
export async function upsertNpc(root: string, npc: Npc, opts: { doc?: string; dryRun?: boolean } = {}) {
  const t = opts.doc ? { id: opts.doc, doc: (await readDoc(root, opts.doc)) ?? { format: FORMAT, npcs: [] } } : await docFor(root, npc.id);
  const npcs = [...(t.doc.npcs ?? [])];
  const i = npcs.findIndex((n) => n.id === npc.id);
  if (i >= 0) npcs[i] = npc;
  else npcs.push(npc);
  return saveDoc(root, t.id, { ...t.doc, npcs }, { dryRun: opts.dryRun });
}

/** Add or replace the schedule entry at `at` (same time + same days/when) for an NPC. */
export async function setEntry(root: string, id: string, entry: ScheduleEntry, opts: { dryRun?: boolean } = {}) {
  const t = await docFor(root, id);
  const npc = t.doc.npcs?.find((n) => n.id === id);
  if (!npc) throw new Error(`No NPC ${id}`);
  const same = (e: ScheduleEntry) => e.at === entry.at && JSON.stringify(e.days ?? null) === JSON.stringify(entry.days ?? null) && (e.when ?? "any") === (entry.when ?? "any");
  const schedule = [...npc.schedule.filter((e) => !same(e)), entry].sort((a, b) => toMinutes(a.at) - toMinutes(b.at));
  return upsertNpc(root, { ...npc, schedule }, { doc: t.id, dryRun: opts.dryRun });
}

export async function removeEntry(root: string, id: string, at: string, opts: { days?: string[]; when?: string } = {}) {
  const t = await docFor(root, id);
  const npc = t.doc.npcs?.find((n) => n.id === id);
  if (!npc) throw new Error(`No NPC ${id}`);
  const schedule = npc.schedule.filter((e) => !(e.at === at && (!opts.days || JSON.stringify(e.days ?? null) === JSON.stringify(opts.days)) && (!opts.when || (e.when ?? "any") === opts.when)));
  if (schedule.length === npc.schedule.length) throw new Error(`${id} has no entry at ${at}`);
  return upsertNpc(root, { ...npc, schedule }, { doc: t.id });
}

export { loadWorldStrict, state, type NpcState };
