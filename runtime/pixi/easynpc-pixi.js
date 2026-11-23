/**
 * Easy NPC — PixiJS v8 runtime. MIT.
 *   const npcs = await loadNpcs(PIXI, "easynpc.world.json");
 *   view opts: { day, minute, lang: "th"|"en"|"ms", labels: true, activity: false }
 *   const view = await npcs.view({ day: 0, minute: 420, lang: "th" });  app.stage.addChild(view.container);
 *   app.ticker.add((t) => view.update(t.deltaMS / 1000));
 * The schedule / A* / affinity logic is easynpc-core.js — the same engine the CLI and Godot export use.
 */
import * as engine from "./easynpc-core.js";

const FACINGS = ["front", "right", "back", "left"];
const WALK = [1, 2, 3, 2];
const DAYS = {
  th: { mon: "จันทร์", tue: "อังคาร", wed: "พุธ", thu: "พฤหัสฯ", fri: "ศุกร์", sat: "เสาร์", sun: "อาทิตย์" },
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
  ms: { mon: "Isnin", tue: "Selasa", wed: "Rabu", thu: "Khamis", fri: "Jumaat", sat: "Sabtu", sun: "Ahad" },
};

export async function loadNpcs(PIXI, url) {
  const base = new URL(url, location.href);
  const world = await (await fetch(base)).json();
  const tex = async (rel) => {
    try {
      const t = await PIXI.Assets.load(new URL(rel, base).href);
      t.source.scaleMode = "nearest";
      return t;
    } catch {
      return null;
    }
  };
  async function view(opts = {}) {
    const ts = world.map.tileSize;
    const container = new PIXI.Container();
    const dayBg = await tex(`maps/${world.map.id}.png`);
    const nightBg = (await tex(`maps/${world.map.id}_night.png`)) ?? dayBg;
    const bg = new PIXI.Sprite(dayBg ?? PIXI.Texture.WHITE);
    if (!dayBg) { bg.width = world.map.width * ts; bg.height = world.map.height * ts; bg.tint = 0x79c48a; }
    container.addChild(bg);
    const layer = new PIXI.Container();
    layer.sortableChildren = true;
    container.addChild(layer);
    const sheets = {};
    for (const s of new Set(world.npcs.map((n) => n.sprite))) sheets[s] = await tex(`characters/${s}.png`);
    const frames = {};
    const frame = (sprite, row, col) => {
      const k = `${sprite}:${row}:${col}`;
      if (!frames[k]) frames[k] = new PIXI.Texture({ source: sheets[sprite].source, frame: new PIXI.Rectangle(col * 48, row * 48, 48, 48) });
      return frames[k];
    };
    const v = {
      container, world, engine,
      day: opts.day ?? 0, minute: opts.minute ?? engine.toMinutes(world.clock.dayStart), lang: opts.lang ?? "th",
      forcedNight: null, bonds: {}, handlers: {}, actors: {}, states: {},
    };
    for (const n of world.npcs) {
      v.bonds[n.id] = engine.newBond(n);
      const a = new PIXI.Container();
      const shadow = new PIXI.Graphics().ellipse(0, -2, 7, 2.5).fill({ color: 0x000000, alpha: 0.35 });
      const body = sheets[n.sprite] ? new PIXI.Sprite(frame(n.sprite, 0, 0)) : new PIXI.Graphics().rect(-4, -14, 8, 12).fill(n.color ?? "#f4ae3d");
      if (sheets[n.sprite]) { body.anchor.set(0.5, 46 / 48); }
      const label = new PIXI.Text({ text: "", style: { fontFamily: "Kanit, sans-serif", fontSize: 10, fill: "#f7ebd3", stroke: { color: "#1e150e", width: 3 } } });
      label.anchor.set(0.5, 1);
      label.y = -40;
      label.resolution = 2;
      label.visible = opts.labels !== false;
      a.addChild(shadow, body, label);
      layer.addChild(a);
      v.actors[n.id] = { npc: n, a, body, label };
    }
    v.night = () => v.forcedNight ?? engine.isNight(world.clock, v.minute);
    v.label = () => `${(DAYS[v.lang] ?? DAYS.en)[engine.weekday(world.clock, v.day)]} · ${v.day} · ${engine.fmtTime(v.minute)}${v.night() ? " ☾" : ""}`;
    v.on = (ev, fn) => ((v.handlers[ev] ??= []).push(fn), v);
    v.emit = (ev, ...args) => (v.handlers[ev] ?? []).forEach((f) => f(...args));
    v.setLang = (l) => { v.lang = l; v.refresh(); };
    v.setNight = (n) => { v.forcedNight = n; v.refresh(); };
    v.setTime = (day, minute) => {
      while (minute >= 1440) { minute -= 1440; day += 1; }
      while (minute < 0) { minute += 1440; day -= 1; }
      v.day = day; v.minute = minute; v.refresh();
    };
    v.update = (dt) => v.setTime(v.day, v.minute + dt / (world.clock.secondsPerMinute || 1));
    v.refresh = () => {
      const night = v.night();
      bg.texture = (night ? nightBg : dayBg) ?? bg.texture;
      const m = Math.floor(v.minute * 100) / 100;
      for (const n of world.npcs) {
        const s = engine.state(world, n.id, v.day, m, v.forcedNight ?? undefined);
        const prev = v.states[n.id];
        v.states[n.id] = s;
        if (prev && prev.moving && !s.moving) v.emit("arrive", n, s.place, s.activity);
        const { a, body, label } = v.actors[n.id];
        a.visible = !s.indoors;
        a.x = Math.round(s.x * ts + ts / 2);
        a.y = Math.round(s.y * ts + ts);
        a.zIndex = a.y;
        if (sheets[n.sprite]) {
          const col = s.moving ? WALK[Math.floor(s.progress * 2) % 4] : 0;
          body.texture = frame(n.sprite, Math.max(0, FACINGS.indexOf(s.facing)), col);
          body.tint = night ? 0x96a0d7 : 0xffffff;
        }
        const act = world.activities[s.activity];
        label.text = `${n.name[v.lang] ?? n.name.en}${opts.activity && act && !s.moving ? " · " + (act[v.lang] ?? act.en) : ""}`;
      }
    };
    v.nearest = (x, y, radius = 1.5) => engine.nearest(world, v.day, v.minute, x, y, radius, v.forcedNight ?? undefined);
    v.talk = (id) => {
      const n = world.npcs.find((x) => x.id === id);
      if (!n) return null;
      const b = v.bonds[id];
      const before = engine.level(n, b.points).index;
      const delta = engine.talk(n, b, v.day);
      const ref = engine.dialogueFor(world, n, b, v.day, v.minute, v.forcedNight ?? undefined);
      v.emit("talk", n, ref, delta);
      const after = engine.level(n, b.points);
      if (after.index > before) v.emit("level", n, after);
      return { ref, delta, quests: engine.questsFor(n, b, v.minute) };
    };
    v.gift = (id, item) => {
      const n = world.npcs.find((x) => x.id === id);
      if (!n) return null;
      const b = v.bonds[id];
      const before = engine.level(n, b.points).index;
      const r = engine.gift(n, b, item, v.day);
      v.emit("gift", n, item, r.kind, r.delta);
      const after = engine.level(n, b.points);
      if (after.index > before) v.emit("level", n, after);
      return r;
    };
    v.toJSON = () => ({ day: v.day, minute: v.minute, bonds: v.bonds });
    v.load = (d) => { Object.assign(v.bonds, d.bonds ?? {}); v.setTime(d.day ?? 0, d.minute ?? 0); };
    v.refresh();
    return v;
  }
  return { world, engine, view };
}
