import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { date, departures, eventsOn, floodEffects, floodLevel, lighting, shopStatus, findPath, gift, hash01, heartEventDue, hearts, markHeartEvent, newBond, routeKey, state, talk, level, questsFor, walkable, weatherAt, weatherOn } from "../shared/engine.js";
import { mulberry32 } from "../shared/rng.js";
import { EXPORT_PRESETS, type ExportPreset, type World } from "../shared/types.js";
import { FONT_DIR, resolveInside, RUNTIME_DIR, Writer } from "./fsx.js";
import { encodePng } from "./png.js";
import { renderMapPng, timelineRaster } from "./render.js";
import { dirs, loadWorldStrict } from "./workspace.js";

export { EXPORT_PRESETS, type ExportPreset };
export const VERSION = "0.1.0";

export interface ExportOptions {
  preset?: ExportPreset;
  out?: string;
  trustedPaths?: boolean;
}

export interface ExportResult {
  dirs: string[];
  files: string[];
  npcs: number;
  places: number;
  routes: number;
  warnings: string[];
}

/** The world file every runtime loads. */
export function worldJson(world: World) {
  return { format: "easynpc-world/1", version: VERSION, ...world };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Reference values test_npc.gd checks the GDScript engine against. */
export function parityData(world: World) {
  const states: unknown[] = [];
  for (const day of [0, 4, 5, 6])
    for (let m = 0; m < 1440; m += 23)
      for (const npc of world.npcs) {
        const s = state(world, npc.id, day, m)!;
        states.push({ id: npc.id, day, minute: m, x: round(s.x), y: round(s.y), facing: s.facing, moving: s.moving, activity: s.activity, place: s.place, indoors: s.indoors, entry: s.entry });
      }
  // forced night (the game's N toggle / weather) at day-time minutes
  for (const m of [600, 780, 900])
    for (const npc of world.npcs) {
      const s = state(world, npc.id, 2, m, true)!;
      states.push({ id: npc.id, day: 2, minute: m, night: true, x: round(s.x), y: round(s.y), facing: s.facing, moving: s.moving, activity: s.activity, place: s.place, indoors: s.indoors, entry: s.entry });
    }
  const rnd = mulberry32(2024);
  const free: Array<[number, number]> = [];
  for (let y = 0; y < world.map.height; y++) for (let x = 0; x < world.map.width; x++) if (walkable(world.map, x, y)) free.push([x, y]);
  const paths = [];
  for (let i = 0; i < 24 && free.length; i++) {
    const a = free[Math.floor(rnd() * free.length)]!;
    const b = free[Math.floor(rnd() * free.length)]!;
    paths.push({ from: a, to: b, path: findPath(world.map, a, b).map(([x, y]) => `${x},${y}`).join(" ") });
  }
  const bonds = world.npcs.slice(0, 4).map((npc) => {
    const b = newBond(npc);
    const items = [...(npc.affinity?.gifts?.loved ?? []), ...(npc.affinity?.gifts?.disliked ?? []), "rice"];
    const log: unknown[] = [];
    for (let d = 0; d < 6; d++) {
      log.push(["talk", d, talk(npc, b, d)]);
      log.push(["talk", d, talk(npc, b, d)]);
      const it = items[d % items.length]!;
      const g = gift(npc, b, it, d);
      log.push(["gift", d, it, g.kind, g.delta]);
      log.push(["level", level(npc, b.points).index, questsFor(npc, b, 600 + d * 120).join("+")]);
    }
    return { id: npc.id, points: b.points, log };
  });
  // calendar + weather + hearts (Easy NPC calendar)
  const days = [];
  for (let d = 0; d < 200; d += 3) days.push({ day: d, date: date(world, d), weather: weatherOn(world, d), fog11: weatherAt(world, d, 690), events: eventsOn(world, d).map((e) => e.id), market8: eventsOn(world, d, 480).map((e) => e.id) });
  const hashes = [0, 1, 7, 99, 123456].flatMap((seed) => [0, 5, 77, 1000].map((day) => [seed, day, round(hash01(seed, day, 1))]));
  const heartsLog = world.npcs.slice(0, 4).map((npc) => {
    const b = newBond(npc);
    const log: unknown[] = [];
    for (let p = 0; p <= 60; p += 7) {
      b.points = p;
      const e = heartEventDue(npc, b);
      log.push([p, hearts(npc, p), e?.id ?? ""]);
      if (e) markHeartEvent(b, e.id);
    }
    log.push(["refuse", gift(npc, newBond(npc), "x", 0, ["pork"]).kind]);
    return { id: npc.id, log };
  });
  // town life: lighting, shop hours, timetables, flooding
  const light = [];
  for (let m = 0; m < 1440; m += 17) light.push({ minute: m, ...lighting(world, m) });
  const shopRows = [];
  for (const id of Object.keys(world.shops ?? {})) for (const day of [0, 5, 12]) for (const m of [300, 420, 700, 1000, 1290]) for (const fl of [0, 0.4, 0.7]) shopRows.push({ id, day, minute: m, flood: fl, ...shopStatus(world, id, day, m, fl) });
  const stations = [...new Set((world.transit?.lines ?? []).map((l) => l.from))];
  const deps = [];
  for (const st of stations) for (const day of [0, 3, 40]) for (const m of [0, 400, 700, 1300]) deps.push({ station: st, day, minute: m, list: departures(world, st, day, m, { n: 5 }) });
  const floods = [];
  for (let d = 0; d < 120; d += 2) for (const m of [0, 360, 1440]) { const lv = floodLevel(world, d, m); floods.push({ day: d, minute: m, level: lv, stage: floodEffects(lv).stage }); }
  return { states, paths, bonds, routes: Object.keys(world.routes ?? {}).length, days, hashes, hearts: heartsLog, town: { light, shops: shopRows, deps, floods } };
}

export async function exportNpcs(root: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const world = await loadWorldStrict(root);
  const preset = opts.preset ?? "all";
  if (!EXPORT_PRESETS.includes(preset)) throw new Error(`Unknown preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  if (preset === "all" && opts.out) throw new Error("--out needs a single preset (godot, pixi, png or json)");
  const presets: ExportPreset[] = preset === "all" ? ["godot", "pixi", "png", "json"] : [preset];
  const res: ExportResult = { dirs: [], files: [], npcs: world.npcs.length, places: Object.keys(world.places).length, routes: Object.keys(world.routes ?? {}).length, warnings: [] };
  for (const p of presets) {
    const out = opts.out ? (opts.trustedPaths ? path.resolve(root, opts.out) : resolveInside(root, opts.out)) : path.join(dirs(root).exports, `easynpc-${p}`);
    const w = new Writer(out);
    if (p === "json") await w.write("easynpc.world.json", `${JSON.stringify(worldJson(world), null, 2)}\n`);
    if (p === "png") await exportPng(w, root, world);
    if (p === "pixi") await exportPixi(w, root, world, res);
    if (p === "godot") await exportGodot(w, root, world, res);
    res.dirs.push(out);
    res.files.push(...w.files);
  }
  return res;
}

async function exportPng(w: Writer, root: string, world: World) {
  for (const [name, m] of [["morning", 7 * 60 + 30], ["noon", 12 * 60 + 20], ["evening", 17 * 60 + 40], ["night", 20 * 60 + 30]] as const)
    await w.write(`map-${name}.png`, await renderMapPng(root, world, 4, m, { scale: 1 }));
  for (const day of [0, 4]) {
    const t = timelineRaster(world, day).scaled(2);
    await w.write(`timeline-day${day}.png`, encodePng(t.width, t.height, t.data));
  }
  await w.write("timeline.json", `${JSON.stringify({ format: "easynpc-timeline/1", scale: "2 px per game minute at 2×", npcs: world.npcs.map((n) => ({ id: n.id, name: n.name, color: n.color })) }, null, 2)}\n`);
}

/** Map backgrounds + character sheets the runtimes draw. */
async function writeArt(w: Writer, root: string, world: World, res: ExportResult, sub: string) {
  const id = world.map.id;
  for (const f of [`${id}.png`, `${id}_night.png`]) {
    const p = path.join(dirs(root).maps, f);
    if (existsSync(p)) await w.write(`${sub}maps/${f}`, await readFile(p));
    else res.warnings.push(`maps/${f} missing: render it with easytilemap render ${id} --no-characters${f.includes("night") ? " --night" : ""} --scale 1`);
  }
  for (const s of new Set(world.npcs.map((n) => n.sprite))) {
    const p = path.join(dirs(root).characters, `${s}.png`);
    if (existsSync(p)) await w.write(`${sub}characters/${s}.png`, await readFile(p));
    else res.warnings.push(`characters/${s}.png missing: the NPC is drawn as a marker`);
  }
}

// ---------------------------------------------------------------- PixiJS
async function exportPixi(w: Writer, root: string, world: World, res: ExportResult) {
  await writeArt(w, root, world, res, "");
  await w.write("easynpc.world.json", `${JSON.stringify(worldJson(world))}\n`);
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easynpc-core.js"), "easynpc-core.js");
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easynpc-pixi.js"), "easynpc-pixi.js");
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `fonts/${f}`);
  await w.write("index.html", pixiDemo(world));
  await w.write("README.txt", `Easy NPC ${VERSION} — PixiJS v8 export
Serve this folder over HTTP (fetch needs it):  python3 -m http.server   then open index.html

  easynpc.world.json   map collision, clock, places, NPCs, schedules, precomputed routes
  easynpc-core.js      the schedule / A* / affinity engine (same code as the CLI; also runs in Node)
  easynpc-pixi.js      loadNpcs(PIXI, "easynpc.world.json") → { world, engine, view(opts) }
                       view: { container, update(dtSeconds), setTime(day, minute), setNight(bool|null),
                               talk(id), gift(id, item), nearest(x, y), bonds, on(event, fn) }
  maps/                Easy Tilemap renders (day + night, no baked characters)
  characters/          Easy Sprite top-down sheets (48 px frames; rows front, right, back, left)
  fonts/               Kanit (SIL OFL 1.1) for Thai labels

Events: "talk" (npc, dialogueRef, delta), "gift" (npc, item, kind, delta), "arrive" (npc, place, activity).
Hook them to Easy Dialogue (dialogueRef.dialogue / node) and Easy Quest (emit "talk_<id>", "gift_<id>").
`);
}

function pixiDemo(world: World): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Easy NPC · PixiJS demo</title>
  <style>
    @font-face { font-family: Kanit; src: url(fonts/Kanit-Regular.ttf); }
    html, body { margin: 0; min-height: 100vh; background: #140e0a; color: #f7ebd3; font-family: Kanit, system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
    #bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    button { background: #3a2819; color: #f7ebd3; border: 1px solid #523822; padding: 3px 8px; font: inherit; cursor: pointer; }
    button.on { background: #f4ae3d; color: #2a1606; }
    #clock { min-width: 140px; text-align: center; }
    canvas { image-rendering: pixelated; width: ${world.map.width * world.map.tileSize}px; height: ${world.map.height * world.map.tileSize}px; }
  </style>
</head>
<body>
  <div id="bar">
    <span id="clock"></span>
    <button data-jump="-60">−1h</button><button data-jump="60">+1h</button><button data-jump="1440">+1 day</button>
    <button data-speed="1">1×</button><button data-speed="10">10×</button><button data-speed="60">60×</button>
    <button id="night">N</button>
    <button data-lang="th">ไทย</button><button data-lang="en">EN</button><button data-lang="ms">BM</button>
  </div>
  <div id="stage"></div>
  <div id="log"></div>
  <script type="module">
    async function pixi() {
      try { await import("./pixi.min.js"); if (globalThis.PIXI) return globalThis.PIXI; } catch {}
      return await import("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs");
    }
    const PIXI = await pixi();
    await document.fonts.load("12px Kanit").catch(() => {});
    const { loadNpcs } = await import("./easynpc-pixi.js");
    const npcs = await loadNpcs(PIXI, "easynpc.world.json");
    const app = new PIXI.Application();
    const W = npcs.world.map.width * npcs.world.map.tileSize, H = npcs.world.map.height * npcs.world.map.tileSize;
    await app.init({ width: W, height: H, background: "#140e0a", antialias: false, resolution: 1 });
    document.getElementById("stage").appendChild(app.canvas);
    const q = new URLSearchParams(location.search);
    let speed = Number(q.get("speed") ?? 10);
    const view = await npcs.view({ day: Number(q.get("day") ?? 4), minute: q.has("t") ? npcs.engine.toMinutes(q.get("t")) : 7 * 60, lang: q.get("lang") ?? "th", labels: !q.has("nolabels"), activity: q.has("activity") });
    if (q.has("night")) view.setNight(true);
    app.stage.addChild(view.container);
    const clock = document.getElementById("clock"), log = document.getElementById("log");
    const draw = () => { clock.textContent = view.label(); document.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === speed || b.dataset.lang === view.lang || (b.id === "night" && view.forcedNight === true))); };
    app.ticker.add((t) => { if (!q.has("paused")) view.update((t.deltaMS / 1000) * speed); draw(); });
    document.querySelectorAll("[data-jump]").forEach((b) => b.onclick = () => view.setTime(view.day, view.minute + Number(b.dataset.jump)));
    document.querySelectorAll("[data-speed]").forEach((b) => b.onclick = () => { speed = Number(b.dataset.speed); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.onclick = () => view.setLang(b.dataset.lang));
    document.getElementById("night").onclick = () => view.setNight(view.forcedNight ? null : true);
    view.on("talk", (n, ref, delta) => { log.textContent = n.name[view.lang] + (ref ? " → " + ref.dialogue + (ref.node ? "#" + ref.node : "") : "") + (delta ? "  +" + delta : ""); });
    app.canvas.addEventListener("click", (e) => {
      const r = app.canvas.getBoundingClientRect();
      const s = view.nearest((e.clientX - r.left) / npcs.world.map.tileSize * (W / r.width) - 0.5, (e.clientY - r.top) / npcs.world.map.tileSize * (H / r.height) - 0.5, 2);
      if (s) view.talk(s.id);
    });
    draw();
    window.__npc = { npcs, view, app };
    window.__ready = true;
  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- Godot
async function exportGodot(w: Writer, root: string, world: World, res: ExportResult) {
  const g = path.join(RUNTIME_DIR, "godot");
  await writeArt(w, root, world, res, "easynpc/");
  await w.write("easynpc/easynpc.world.json", `${JSON.stringify(worldJson(world))}\n`);
  await w.write("easynpc/parity.json", `${JSON.stringify(parityData(world))}\n`);
  for (const f of ["easynpc.gd", "npc_engine.gd", "npc_world.gd"]) await w.copy(path.join(g, f), `easynpc/${f}`);
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `easynpc/fonts/${f}`);
  for (const f of ["main.gd", "test_npc.gd", "capture.gd"]) await w.copy(path.join(g, f), f);
  const W = world.map.width * world.map.tileSize;
  const H = world.map.height * world.map.tileSize;
  await w.write("main.tscn", `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node2D"]
script = ExtResource("1")
`);
  await w.write("project.godot", `; Engine configuration file.
config_version=5

[application]

config/name="Easy NPC demo"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[autoload]

NPCs="*res://easynpc/easynpc.gd"

[display]

window/size/viewport_width=${W}
window/size/viewport_height=${H}
window/stretch/mode="viewport"
window/stretch/scale_mode="integer"

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`);
  await w.write("README.txt", `Easy NPC ${VERSION} — Godot 4.3+ export
Open this folder in Godot 4.3+ and press F5 (village with the clock running; N = force night, T = talk to the
nearest NPC to the mouse, [ ] = speed), or copy easynpc/ into your game and add
  Project Settings → Autoload → res://easynpc/easynpc.gd as "NPCs"

  easynpc/easynpc.gd        NPCs autoload: game clock (day, minute, weekday, night), bonds (affinity), talk/gift,
                            dialogue_for(id), quests_for(id), to_dict()/from_dict() for Easy Save.
                            Signals: time_changed, night_changed, arrived(id, place, activity), talked(id, ref, delta),
                            gifted(id, item, kind, delta), level_up(id, level)
  easynpc/npc_engine.gd     EasyNpcEngine: schedules + A* (parity-tested with the TypeScript engine)
  easynpc/npc_world.gd      EasyNpcWorld (Node2D): draws the map and walking NPC sprites; add it to your scene
  easynpc/maps, characters  Easy Tilemap renders and Easy Sprite sheets
  test_npc.gd               godot --headless --path . --script res://test_npc.gd   → prints OK
  capture.gd                frame capture for previews (needs a renderer)

Easy Quest: when /root/QuestManager exists, talking emits "talk_<npc>", gifts emit "gift_<npc>" and
"gift_<npc>_<item>", and affinity levels set the flag "npc_<npc>_level_<n>".
Easy Dialogue: dialogue_for(id) returns { dialogue, node } for your Easy Dialogue runner.
`);
}
