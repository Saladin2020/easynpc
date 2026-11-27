#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp } from "./server/app.js";
import { defaultWebRoot } from "./server/base.js";
import { resolveToken } from "./shared/requestGuard.js";
import { WEATHER_INFO, eventsOn, fmtTime, forecast, hearts, heartEventDue, newBond, weatherAt } from "./shared/engine.js";
import { FACINGS, WEEKDAYS, WHEN, type ScheduleEntry } from "./shared/types.js";
import { EXPORT_PRESETS, exportNpcs, type ExportPreset } from "./lib/export.js";
import { npcDay, parseTime, pathBetween, removeEntry, setEntry, simulateBond, whereAt } from "./lib/ops.js";
import { encodePng } from "./lib/png.js";
import { renderMapPng, timelineRaster } from "./lib/render.js";
import { checkWorkspace, initWorkspace, loadWorld, loadWorldStrict, resolveWorkspace, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYNPC_WORKSPACE?.trim() || process.env.EASYNPC_HOME?.trim() || process.cwd();
  return resolveWorkspace(v);
}
const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};
type Nm = { th: string; en: string; ms?: string };
const nm = (n: Nm | undefined, lang = "th") => (n ? (n as unknown as Record<string, string>)[lang] || n.th : "");
const nightOpt = (v?: string) => (v === undefined ? undefined : v === "auto" ? undefined : v !== "false" && v !== "0");

program.name("easynpc").description("NPC daily schedules (day/night aware) with A* on Easy Tilemap maps, affinity, Easy Dialogue / Easy Quest hooks → Godot 4.3+ autoload, PixiJS v8 runtime").version("0.1.0");

program
  .command("init")
  .description("Create npcs/ maps/ characters/ dialogues/ quests/ with the multicultural village sample (10 NPCs, 18 places)")
  .option("--force", "Overwrite sample files")
  .option("--workspace <path>")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const written = await initWorkspace(root, { force: o.force });
      const s = await workspaceSummary(root);
      console.log(`Initialized Easy NPC workspace at ${root} (${written.length} files)`);
      console.log(`  npcs/        ${s.docs.map((d) => `${d}.easynpc.json`).join(", ")} — ${s.npcs.length} NPCs, ${s.places.length} places`);
      console.log(`  maps/        ${s.map?.file ?? "(no map)"} + day/night renders`);
      console.log("  characters/  Easy Sprite top-down sheets · dialogues/ .ezd · quests/ .ezq · exports/");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy NPC workspace ${s.root}`);
    console.log(`  map: ${s.map ? `${s.map.id} ${s.map.width}×${s.map.height} tiles (${s.map.file})` : "(none)"}`);
    if (s.clock) console.log(`  clock: day ${s.clock.dayStart} · night ${s.clock.nightStart} · ${s.clock.secondsPerMinute}s per game minute · speed ${s.clock.speed} tiles/min · day 0 = ${s.clock.firstWeekday}`);
    console.log(`  ${s.npcs.length} NPCs · ${s.places.length} places · ${Object.keys(s.activities).length} activities · export: ${EXPORT_PRESETS.join(", ")}`);
    if (s.errors.length) console.log(`  ${s.errors.length} ERRORS (run check)`);
  });

program
  .command("list")
  .description("List npcs | places | activities")
  .argument("[kind]", "npcs | places | activities", "npcs")
  .option("--lang <l>", "th | en | ms", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (kind: string, o: { workspace?: string; json?: boolean; lang: string }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (kind === "npcs") {
      if (o.json) return console.log(JSON.stringify({ npcs: s.npcs }, null, 2));
      for (const n of s.npcs) console.log(`${n.id.padEnd(10)} ${String(o.lang === "en" ? n.en : n.th).padEnd(16)} sprite=${n.sprite} home=${n.home} entries=${n.entries}${n.quests.length ? ` quests=${n.quests.join("/")}` : ""}`);
    } else if (kind === "places") {
      if (o.json) return console.log(JSON.stringify({ places: s.places }, null, 2));
      for (const p of s.places) console.log(`${p.id.padEnd(14)} ${String(p.x).padStart(3)},${String(p.y).padEnd(3)} ${o.lang === "en" ? p.en : p.th}`);
    } else if (kind === "activities") {
      if (o.json) return console.log(JSON.stringify({ activities: s.activities }, null, 2));
      for (const [id, n] of Object.entries(s.activities)) console.log(`${id.padEnd(14)} ${nm(n as Nm, o.lang)}`);
    } else fail(`unknown kind ${kind} (npcs | places | activities)`);
  });

program
  .command("schedule <npc>")
  .description("One NPC's day: entries with route length, walk time and arrival")
  .option("--day <n>", "Game day (0 = clock.firstWeekday)", "0")
  .option("--night", "Use the night entries (forced night, e.g. a rainy evening)")
  .option("--lang <l>", "th | en | ms", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string, o: { day: string; night?: boolean; lang: string; workspace?: string; json?: boolean }) => {
    try {
      const world = await loadWorldStrict(workspaceOf(o.workspace));
      const d = npcDay(world, id, Number(o.day), !!o.night);
      if (o.json) return console.log(JSON.stringify(d, null, 2));
      console.log(`${nm(d.name, o.lang)} · day ${d.day} (${d.weekday})${o.night ? " · night entries" : ""}`);
      for (const e of d.entries) console.log(`  ${e.at} → ${e.arrive}  ${nm(world.places[e.place]?.name, o.lang).padEnd(18)} ${nm(world.activities[e.activity], o.lang) || e.activity}${e.tiles ? `  (${e.tiles} tiles from ${e.from})` : ""}${e.indoors ? "  [indoors]" : ""}${e.when !== "any" ? `  [${e.when}]` : ""}${e.days ? `  [${e.days.join(",")}]` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("where")
  .description("Where everyone is at a time: easynpc where --day 4 --at 12:30")
  .option("--day <n>", "Game day", "0")
  .option("--at <hh:mm>", "Time", "08:00")
  .option("--night <v>", "auto | true | false (force)")
  .option("--lang <l>", "th | en | ms", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { day: string; at: string; night?: string; lang: string; workspace?: string; json?: boolean }) => {
    try {
      const world = await loadWorldStrict(workspaceOf(o.workspace));
      const r = whereAt(world, Number(o.day), parseTime(o.at), nightOpt(o.night));
      if (o.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`day ${r.day} (${r.weekday}) ${r.time}${r.night ? " · night" : ""}`);
      for (const s of r.npcs) console.log(`  ${nm(s.name, o.lang).padEnd(14)} ${s.moving ? `walking → ${nm(world.places[s.place]?.name, o.lang)} (${Math.floor(s.progress)}/${s.routeLength})` : `${nm(world.activities[s.activity], o.lang) || s.activity} @ ${nm(world.places[s.place]?.name, o.lang)}${s.indoors ? " [indoors]" : ""}`}  ${s.x},${s.y} ${s.facing}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("path <from> <to>")
  .description("A* route between two places (ids) or tiles (x,y)")
  .option("--workspace <path>")
  .option("--json")
  .action(async (from: string, to: string, o: { workspace?: string; json?: boolean }) => {
    try {
      const r = pathBetween(await loadWorldStrict(workspaceOf(o.workspace)), from, to);
      if (o.json) return console.log(JSON.stringify(r));
      console.log(r.reachable ? `${r.tiles} tiles: ${r.path.map(([x, y]) => `${x},${y}`).join(" ")}` : `unreachable ${r.from} → ${r.to}`);
      if (!r.reachable) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("calendar")
  .description("Dates, seasons, festivals and daily weather: easynpc calendar --from 56 --days 28")
  .option("--from <day>", "First game day (0-based)", "0")
  .option("--days <n>", "Days", "14")
  .option("--lang <th|en|ms>", "Language", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { from: string; days: string; lang: string; workspace?: string; json?: boolean }) => {
    try {
      const world = await loadWorldStrict(workspaceOf(o.workspace));
      const rows = forecast(world, Number(o.from), Number(o.days));
      if (o.json) return console.log(JSON.stringify({ calendar: world.calendar, days: rows }, null, 2));
      const cal = world.calendar!;
      for (const r of rows) {
        const season = cal.seasons.find((x) => x.id === r.season)?.name;
        const evs = eventsOn(world, r.day).map((e) => `${nm(e.name, o.lang)}${e.from ? ` ${e.from}–${e.to ?? ""}` : ""}`);
        console.log(`day ${String(r.day).padStart(3)}  Y${r.year} ${nm(season, o.lang).padEnd(10)} ${String(r.dayOfSeason).padStart(2)} (${r.weekday})  ${nm(WEATHER_INFO[r.weather].name, o.lang).padEnd(8)}${r.weather === "fog" ? `→${weatherAt(world, r.day, 720)}` : ""}${evs.length ? `  ★ ${evs.join(", ")}` : ""}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("hearts <npc>")
  .description("Hearts and heart events at a number of affinity points: easynpc hearts fatimah --points 25")
  .option("--points <n>", "Affinity points", "0")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string, o: { points: string; workspace?: string; json?: boolean }) => {
    try {
      const world = await loadWorldStrict(workspaceOf(o.workspace));
      const npc = world.npcs.find((x) => x.id === id);
      if (!npc) throw new Error(`unknown npc "${id}"`);
      const b = newBond(npc);
      b.points = Number(o.points);
      const r = { npc: id, points: b.points, hearts: hearts(npc, b.points), heartSize: npc.affinity?.heartSize ?? 10, due: heartEventDue(npc, b), events: npc.affinity?.heartEvents ?? [] };
      if (o.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`${id}: ${r.points} pts = ${"♥".repeat(r.hearts)}${r.hearts ? "" : "0"} (${r.heartSize}/heart)  next event: ${r.due ? `${r.due.id} (${r.due.hearts}♥)` : "-"}`);
      for (const e of r.events) console.log(`  ${e.hearts}♥ ${e.id}${e.name ? ` ${e.name.th} · ${e.name.en}` : ""}${e.quest ? `  quest ${e.quest}` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("bond <npc>")
  .description("Simulate talking (and gifts) over days: easynpc bond fatimah --days 7 --gift kurma")
  .option("--days <n>", "Days", "7")
  .option("--gift <item>", "Gift this Easy Items id every day")
  .option("--at <hh:mm>", "Time of the visit", "10:00")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string, o: { days: string; gift?: string; at: string; workspace?: string; json?: boolean }) => {
    try {
      const world = await loadWorldStrict(workspaceOf(o.workspace));
      const r = simulateBond(world, id, Array.from({ length: Number(o.days) }, (_, d) => ({ day: d, time: o.at, gift: o.gift })));
      if (o.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`${id}: start ${r.start}`);
      for (const s of r.steps) {
        const g = s.gift as { kind: string; delta: number } | undefined;
        const dl = s.dialogue as { dialogue: string; node?: string } | null;
        console.log(`  day ${s.day} ${s.time}  talk +${s.talk}${g ? `  gift ${g.kind} ${g.delta >= 0 ? "+" : ""}${g.delta}` : ""}  → ${s.points} (${s.level ?? "-"})  dialogue ${dl ? `${dl.dialogue}${dl.node ? `#${dl.node}` : ""}` : "-"}${(s.quests as string[]).length ? `  quests ${(s.quests as string[]).join(",")}` : ""}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("set-entry <npc> <at> <place> <activity>")
  .description("Add or replace a schedule entry: easynpc set-entry adam 16:00 beach play --days sat,sun")
  .option("--days <list>", `Weekdays (${WEEKDAYS.join(",")})`)
  .option("--when <w>", WHEN.join(" | "))
  .option("--facing <f>", FACINGS.join(" | "))
  .option("--indoors")
  .option("--dialogue <id[#node]>", "Easy Dialogue script (and node) while doing this")
  .option("--dry-run", "Validate only")
  .option("--workspace <path>")
  .action(async (id: string, at: string, place: string, activity: string, o: { days?: string; when?: string; facing?: string; indoors?: boolean; dialogue?: string; dryRun?: boolean; workspace?: string }) => {
    try {
      const e: ScheduleEntry = { at, place, activity };
      if (o.days) e.days = o.days.split(",") as ScheduleEntry["days"];
      if (o.when) e.when = o.when as ScheduleEntry["when"];
      if (o.facing) e.facing = o.facing as ScheduleEntry["facing"];
      if (o.indoors) e.indoors = true;
      if (o.dialogue) e.dialogue = { dialogue: o.dialogue.split("#")[0]!, ...(o.dialogue.includes("#") ? { node: o.dialogue.split("#")[1] } : {}) };
      const r = await setEntry(workspaceOf(o.workspace), id, e, { dryRun: o.dryRun });
      for (const x of r.errors) console.log(`ERROR ${x.path}: ${x.message}`);
      if (r.errors.length) process.exit(1);
      console.log(o.dryRun ? "valid (dry run, nothing written)" : `saved ${r.file}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("remove-entry <npc> <at>")
  .description("Remove the schedule entry at a time")
  .option("--days <list>")
  .option("--when <w>")
  .option("--workspace <path>")
  .action(async (id: string, at: string, o: { days?: string; when?: string; workspace?: string }) => {
    try {
      const r = await removeEntry(workspaceOf(o.workspace), id, at, { days: o.days?.split(","), when: o.when });
      for (const x of r.errors) console.log(`ERROR ${x.path}: ${x.message}`);
      if (r.errors.length) process.exit(1);
      console.log(`saved ${r.file}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description("Validate schedules, places, routes, halal gifts, and Easy Dialogue / Easy Quest references")
  .option("--dialogues <dir>", "Folder of .ezd files (default dialogues/)")
  .option("--quests <dir>", "Folder of .ezq files (default quests/)")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { dialogues?: string; quests?: string; workspace?: string; json?: boolean }) => {
    const r = await checkWorkspace(workspaceOf(o.workspace), { dialogues: o.dialogues, quests: o.quests });
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const e of r.errors) console.log(`ERROR ${e.path}: ${e.message}`);
      for (const w of r.warnings) console.log(`warn  ${w.path}: ${w.message}`);
      console.log(`${r.errors.length} errors, ${r.warnings.length} warnings · ${r.cross.npcs} NPCs · ${r.cross.places} places · ${r.cross.routes} routes · ${r.cross.dialogues} dialogue refs · ${r.cross.quests} quest hooks`);
    }
    if (r.errors.length) process.exit(1);
  });

program
  .command("render")
  .description("PNG: map (NPCs at a time) or timeline (everyone's day)")
  .argument("[what]", "map | timeline", "map")
  .requiredOption("--out <png>", "Output file")
  .option("--day <n>", "Game day", "0")
  .option("--at <hh:mm>", "Time (map)", "08:00")
  .option("--night <v>", "auto | true | false")
  .option("--no-routes", "Hide the route dots of walking NPCs")
  .option("--crop <x,y,w,h>", "Crop in map pixels")
  .option("--scale <n>", "Scale", "1")
  .option("--workspace <path>")
  .action(async (what: string, o: { out: string; day: string; at: string; night?: string; routes: boolean; crop?: string; scale: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const world = await loadWorldStrict(root);
      const out = path.resolve(o.out);
      await mkdir(path.dirname(out), { recursive: true });
      if (what === "timeline") {
        const t = timelineRaster(world, Number(o.day), nightOpt(o.night)).scaled(Math.max(1, Number(o.scale)));
        await writeFile(out, encodePng(t.width, t.height, t.data));
      } else if (what === "map") {
        const crop = o.crop?.split(",").map(Number) as [number, number, number, number] | undefined;
        await writeFile(out, await renderMapPng(root, world, Number(o.day), parseTime(o.at), { night: nightOpt(o.night), routes: o.routes, scale: Number(o.scale), crop }));
      } else return fail(`unknown render ${what} (map | timeline)`);
      console.log(`wrote ${out}${what === "map" ? ` · day ${o.day} ${fmtTime(parseTime(o.at))}` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description("Export: godot | pixi | png | json | all")
  .option("--preset <p>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (single preset)")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { preset: ExportPreset; out?: string; workspace?: string; json?: boolean }) => {
    try {
      const res = await exportNpcs(workspaceOf(o.workspace), { preset: o.preset, out: o.out, trustedPaths: true });
      if (o.json) return console.log(JSON.stringify({ ...res, files: res.files.length }, null, 2));
      for (const d of res.dirs) console.log(`exported ${d}`);
      console.log(`  ${res.files.length} files · ${res.npcs} NPCs · ${res.places} places · ${res.routes} routes`);
      for (const w of res.warnings) console.log(`  warning: ${w}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8958)")
  .option("--port <n>", "Port", "8958")
  .option("--host <h>", "Host", "127.0.0.1")
  .option("--dev", "API only (use the Vite UI on :5195)")
  .option("--no-open")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    const { errors } = await loadWorld(root, { routes: false });
    if (errors.length) console.log(`warning: workspace has ${errors.length} errors (see the Check tab)`);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    serve({ fetch: app.fetch, port: Number(o.port), hostname: o.host });
    const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${o.port}/${token ? `?token=${token}` : ""}`;
    console.log(`Easy NPC ${o.dev ? "API" : "editor"} on http://${o.host}:${o.port} · workspace ${root}`);
    if (token) console.log(`Token (needed off loopback): ${token}`);
    if (o.open && !o.dev && process.stdout.isTTY) await open(url).catch(() => {});
  });

program.parseAsync().catch(fail);
