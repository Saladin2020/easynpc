/* Easy NPC core — generated from src/shared/engine.ts by scripts/build-core.mjs. Do not edit. MIT. */
// src/shared/types.ts
var WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
var WEATHERS = ["clear", "cloudy", "rain", "storm", "wind", "fog"];

// src/shared/calendar.ts
var n = (th, en, ms) => ({ th, en, ms });
var DEFAULT_CALENDAR = {
  daysPerSeason: 28,
  startYear: 1,
  weatherSeed: 7,
  persistence: 0.35,
  seasons: [
    { id: "hot", name: n("\u0E24\u0E14\u0E39\u0E23\u0E49\u0E2D\u0E19", "Hot season", "Musim panas"), weather: { clear: 6, cloudy: 2, wind: 2, storm: 1 } },
    { id: "rainy", name: n("\u0E24\u0E14\u0E39\u0E1D\u0E19", "Rainy season", "Musim hujan"), weather: { rain: 5, storm: 2, cloudy: 2, clear: 1 } },
    { id: "cool", name: n("\u0E24\u0E14\u0E39\u0E2B\u0E19\u0E32\u0E27", "Cool season", "Musim sejuk"), weather: { clear: 5, fog: 3, cloudy: 2, wind: 1 } }
  ],
  events: [
    { id: "market_day", name: n("\u0E15\u0E25\u0E32\u0E14\u0E19\u0E31\u0E14", "Market day", "Hari pasar"), weekday: "sat", from: "07:00", to: "13:00", tags: ["market"] },
    { id: "kolek_race", name: n("\u0E41\u0E02\u0E48\u0E07\u0E40\u0E23\u0E37\u0E2D\u0E01\u0E2D\u0E41\u0E25\u0E30", "Kolek boat race", "Lumba perahu kolek"), season: "rainy", day: 25, from: "09:00", to: "16:00", tags: ["festival", "boat"] },
    { id: "kite_festival", name: n("\u0E40\u0E17\u0E28\u0E01\u0E32\u0E25\u0E27\u0E48\u0E32\u0E27", "Kite festival", "Pesta wau"), season: "cool", day: 10, from: "15:00", to: "18:30", tags: ["festival", "kite"] },
    { id: "harvest_fair", name: n("\u0E07\u0E32\u0E19\u0E40\u0E01\u0E35\u0E48\u0E22\u0E27\u0E02\u0E49\u0E32\u0E27", "Harvest fair", "Pesta menuai"), season: "cool", day: 20, from: "08:00", to: "20:00", tags: ["festival", "harvest"] }
  ]
};
var WEATHER_INFO = {
  clear: { name: n("\u0E41\u0E14\u0E14\u0E2D\u0E2D\u0E01", "Clear", "Cerah"), fx: null, darken: 0, wind: 0, outdoors: true, waters: false, fishing: 1 },
  cloudy: { name: n("\u0E40\u0E21\u0E06\u0E04\u0E23\u0E36\u0E49\u0E21", "Cloudy", "Mendung"), fx: null, darken: 0.12, wind: 0.1, outdoors: true, waters: false, fishing: 1.2 },
  rain: { name: n("\u0E1D\u0E19\u0E15\u0E01", "Rain", "Hujan"), fx: "rain", darken: 0.25, wind: 0.2, outdoors: true, waters: true, fishing: 1.5 },
  storm: { name: n("\u0E1E\u0E32\u0E22\u0E38\u0E1D\u0E19", "Storm", "Ribut"), fx: "storm_rain", darken: 0.45, wind: 0.8, outdoors: false, waters: true, fishing: 0 },
  wind: { name: n("\u0E25\u0E21\u0E41\u0E23\u0E07", "Windy", "Berangin"), fx: "wind_gust", darken: 0.05, wind: 0.6, outdoors: true, waters: false, fishing: 0.8 },
  fog: { name: n("\u0E2B\u0E21\u0E2D\u0E01\u0E25\u0E07", "Fog", "Berkabus"), fx: "fog_drift", darken: 0.2, wind: 0, outdoors: true, waters: false, fishing: 0.7 }
};
var FOG_LIFTS = 11 * 60;
var calendarOf = (world) => world.calendar ?? DEFAULT_CALENDAR;
var seasonDays = (cal, i) => cal.seasons[i]?.days ?? cal.daysPerSeason;
var yearLength = (cal) => cal.seasons.reduce((a, _s, i) => a + seasonDays(cal, i), 0);
function date(world, day) {
  const cal = calendarOf(world);
  const len = Math.max(1, yearLength(cal));
  const d = Math.max(0, Math.floor(day));
  const year = cal.startYear + Math.floor(d / len);
  let doy = d % len;
  const dayOfYear = doy;
  let si = 0;
  while (si < cal.seasons.length - 1 && doy >= seasonDays(cal, si)) doy -= seasonDays(cal, si++);
  const clock = world.clock;
  const wd = WEEKDAYS[((WEEKDAYS.indexOf(clock.firstWeekday) + d) % 7 + 7) % 7];
  return { day: d, year, season: cal.seasons[si]?.id ?? "", seasonIndex: si, dayOfSeason: doy + 1, week: Math.floor(doy / 7) + 1, weekday: wd, dayOfYear };
}
function dayOf(world, year, season, dayOfSeason) {
  const cal = calendarOf(world);
  let d = (year - cal.startYear) * yearLength(cal);
  for (let i = 0; i < cal.seasons.length && cal.seasons[i].id !== season; i++) d += seasonDays(cal, i);
  return d + dayOfSeason - 1;
}
var toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
function eventsOn(world, day, minute) {
  const cal = calendarOf(world);
  const dt = date(world, day);
  return cal.events.filter((e) => {
    if (e.season && e.season !== dt.season) return false;
    if (e.day !== void 0 && e.day !== dt.dayOfSeason) return false;
    if (e.weekday && e.weekday !== dt.weekday) return false;
    if (minute === void 0) return true;
    const m = (minute % 1440 + 1440) % 1440;
    const a = e.from ? toMin(e.from) : 0;
    const z = e.to ? toMin(e.to) : 1440;
    return m >= a && m < z;
  });
}
function hash01(seed, day, salt) {
  let h = Math.imul(seed | 0, 374761393) + Math.imul(day | 0, 668265263) + Math.imul(salt | 0, 2246822519) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h = h ^ h >>> 16;
  return (h >>> 0) / 4294967296;
}
function baseWeather(cal, seasonIndex, day) {
  const w = cal.seasons[seasonIndex]?.weather ?? { clear: 1 };
  let total = 0;
  for (const k of WEATHERS) total += Math.max(0, w[k] ?? 0);
  if (total <= 0) return "clear";
  let r = hash01(cal.weatherSeed, day, 1) * total;
  for (const k of WEATHERS) {
    r -= Math.max(0, w[k] ?? 0);
    if (r < 0) return k;
  }
  return "clear";
}
function weatherOn(world, day) {
  const cal = calendarOf(world);
  const d = Math.max(0, Math.floor(day));
  const si = date(world, d).seasonIndex;
  if (d > 0 && hash01(cal.weatherSeed, d, 2) < cal.persistence && date(world, d - 1).seasonIndex === si) return baseWeather(cal, si, d - 1);
  return baseWeather(cal, si, d);
}
function weatherAt(world, day, minute) {
  const w = weatherOn(world, day);
  const m = (minute % 1440 + 1440) % 1440;
  return w === "fog" && m >= FOG_LIFTS ? "cloudy" : w;
}
function forecast(world, from, days) {
  return Array.from({ length: days }, (_, i) => {
    const d = from + i;
    return { ...date(world, d), weather: weatherOn(world, d), events: eventsOn(world, d).map((e) => e.id) };
  });
}

// src/shared/engine.ts
var DEFAULT_CLOCK = { dayStart: "06:00", nightStart: "19:00", secondsPerMinute: 1, speed: 3, firstWeekday: "mon" };
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return NaN;
  return h * 60 + mm;
}
var fmtTime = (minute) => {
  const m = (Math.floor(minute) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
var weekday = (clock, day) => WEEKDAYS[((WEEKDAYS.indexOf(clock.firstWeekday) + day) % 7 + 7) % 7];
function isNight(clock, minute) {
  const m = (minute % 1440 + 1440) % 1440;
  const a = toMinutes(clock.dayStart);
  const b = toMinutes(clock.nightStart);
  return a < b ? m < a || m >= b : m >= b && m < a;
}
var walkable = (map, x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.collision[y]?.[x] !== "#";
var DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function nearestWalkable(map, x, y) {
  if (walkable(map, x, y)) return [x, y];
  const seen = /* @__PURE__ */ new Set([y * map.width + x]);
  const q = [[x, y]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
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
function findPath(map, from, to) {
  const W = map.width;
  const [sx, sy] = from;
  const [gx, gy] = to;
  if (!walkable(map, sx, sy) || !walkable(map, gx, gy)) return [];
  if (sx === gx && sy === gy) return [[sx, sy]];
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  const g = /* @__PURE__ */ new Map([[sy * W + sx, 0]]);
  const came = /* @__PURE__ */ new Map();
  const closed = /* @__PURE__ */ new Set();
  const open = [[h(sx, sy), h(sx, sy), 0, sy * W + sx]];
  let seq = 1;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i];
      const b = open[bi];
      if (a[0] < b[0] || a[0] === b[0] && (a[1] < b[1] || a[1] === b[1] && a[2] < b[2])) bi = i;
    }
    const [, , , key] = open.splice(bi, 1)[0];
    if (closed.has(key)) continue;
    closed.add(key);
    const cx = key % W;
    const cy = Math.floor(key / W);
    if (cx === gx && cy === gy) {
      const path = [];
      let k = key;
      while (k !== void 0) {
        path.push([k % W, Math.floor(k / W)]);
        k = came.get(k);
      }
      return path.reverse();
    }
    const cg = g.get(key);
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
var entryMatches = (e, wd, night, weather = "clear") => (!e.days || e.days.includes(wd)) && (!e.when || e.when === "any" || e.when === "night" === night) && (!e.weather || e.weather.includes(weather)) && (!e.notWeather || !e.notWeather.includes(weather));
function dayList(world, npc, day, night) {
  const wd = weekday(world.clock, day);
  const w = world.calendar ? weatherOn(world, day) : "clear";
  return npc.schedule.map((e, i) => ({ e, i, t: toMinutes(e.at) })).filter((x) => entryMatches(x.e, wd, night, w)).sort((a, b) => a.t - b.t || a.i - b.i);
}
function activeEntry(world, npc, day, minute, night) {
  const n2 = night ?? isNight(world.clock, minute);
  const m = (minute % 1440 + 1440) % 1440;
  const today = dayList(world, npc, day, n2);
  const started = today.filter((x) => x.t <= m);
  if (started.length) {
    const cur2 = started[started.length - 1];
    const prev2 = started.length > 1 ? started[started.length - 2].e.place : dayList(world, npc, day - 1, n2).pop()?.e.place ?? npc.home;
    return { entry: cur2.e, index: cur2.i, start: cur2.t, from: prev2, elapsed: m - cur2.t };
  }
  const y = dayList(world, npc, day - 1, n2);
  const cur = y[y.length - 1];
  if (!cur) return null;
  const prev = (y[y.length - 2] ?? cur).e.place;
  return { entry: cur.e, index: cur.i, start: cur.t, from: prev, elapsed: m + 1440 - cur.t };
}
function routePairs(world) {
  const out = /* @__PURE__ */ new Map();
  for (const npc of world.npcs)
    for (let d = 0; d < 7; d++)
      for (const n2 of [false, true]) {
        const today = dayList(world, npc, d, n2);
        const y = dayList(world, npc, d - 1, n2);
        let prev = y.length ? y[y.length - 1].e.place : npc.home;
        for (const x of today) {
          out.set(routeKey(prev, x.e.place), [prev, x.e.place]);
          prev = x.e.place;
        }
        if (y.length > 1) out.set(routeKey(y[y.length - 2].e.place, y[y.length - 1].e.place), [y[y.length - 2].e.place, y[y.length - 1].e.place]);
      }
  return [...out.values()].sort((a, b) => routeKey(...a).localeCompare(routeKey(...b)));
}
var routeKey = (a, b) => `${a}>${b}`;
function placeTile(world, id) {
  const p = world.places[id];
  if (!p) return null;
  return nearestWalkable(world.map, p.x, p.y);
}
function route(world, from, to) {
  const pre = world.routes?.[routeKey(from, to)];
  if (pre) return pre;
  const a = placeTile(world, from);
  const b = placeTile(world, to);
  if (!a || !b) return [];
  return findPath(world.map, a, b);
}
var facingOf = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? "right" : dx < 0 ? "left" : "front" : dy > 0 ? "front" : "back";
function state(world, id, day, minute, night) {
  const npc = world.npcs.find((n3) => n3.id === id);
  if (!npc) return null;
  const n2 = night ?? isNight(world.clock, minute);
  const act = activeEntry(world, npc, day, minute, n2);
  const home = placeTile(world, npc.home) ?? [0, 0];
  if (!act) return { id, x: home[0], y: home[1], facing: "front", moving: false, activity: "idle", place: npc.home, indoors: false, night: n2, entry: -1, progress: 0, routeLength: 0 };
  const path = route(world, act.from, act.entry.place);
  const speed = npc.speed ?? world.clock.speed;
  const len = Math.max(0, path.length - 1);
  const walked = act.elapsed * speed;
  if (!path.length) {
    const t = placeTile(world, act.entry.place) ?? home;
    return { id, x: t[0], y: t[1], facing: act.entry.facing ?? world.places[act.entry.place]?.facing ?? "front", moving: false, activity: act.entry.activity, place: act.entry.place, indoors: !!act.entry.indoors, night: n2, entry: act.index, progress: 0, routeLength: 0 };
  }
  if (walked >= len) {
    const [x, y] = path[path.length - 1];
    const last = path.length > 1 ? path[path.length - 2] : path[0];
    const face = act.entry.facing ?? world.places[act.entry.place]?.facing ?? (path.length > 1 ? facingOf(x - last[0], y - last[1]) : "front");
    return { id, x, y, facing: face, moving: false, activity: act.entry.activity, place: act.entry.place, indoors: !!act.entry.indoors, night: n2, entry: act.index, progress: len, routeLength: len };
  }
  const i = Math.floor(walked);
  const f = walked - i;
  const [ax, ay] = path[i];
  const [bx, by] = path[i + 1];
  return { id, x: ax + (bx - ax) * f, y: ay + (by - ay) * f, facing: facingOf(bx - ax, by - ay), moving: true, activity: "walk", place: act.entry.place, indoors: false, night: n2, entry: act.index, progress: walked, routeLength: len };
}
var states = (world, day, minute, night) => world.npcs.map((n2) => state(world, n2.id, day, minute, night));
var newBond = (npc) => ({ points: npc.affinity?.start ?? 0, lastTalk: -1, lastGift: -1, seen: [] });
var clampPts = (npc, p) => Math.max(0, Math.min(npc.affinity?.max ?? 100, p));
var GIFT_POINTS = { loved: 8, liked: 4, neutral: 1, disliked: -4 };
var NON_HALAL_TAGS = ["pork", "alcohol", "non_halal"];
var keepsHalal = (npc) => npc.affinity?.halal ?? npc.culture === "malay";
function giftKind(npc, item, tags = []) {
  const g = npc.affinity?.gifts ?? {};
  if (g.refuse?.includes(item) || keepsHalal(npc) && tags.some((t) => NON_HALAL_TAGS.includes(t))) return "refused";
  if (g.loved?.includes(item)) return "loved";
  if (g.liked?.includes(item)) return "liked";
  if (g.disliked?.includes(item)) return "disliked";
  return "neutral";
}
function talk(npc, b, day) {
  if (b.lastTalk === day) return 0;
  b.lastTalk = day;
  const before = b.points;
  b.points = clampPts(npc, b.points + (npc.affinity?.talk ?? 1));
  return b.points - before;
}
function gift(npc, b, item, day, tags = []) {
  const kind = giftKind(npc, item, tags);
  if (kind === "refused" || b.lastGift === day) return { kind, delta: 0 };
  b.lastGift = day;
  const before = b.points;
  b.points = clampPts(npc, b.points + GIFT_POINTS[kind]);
  return { kind, delta: b.points - before };
}
function level(npc, points) {
  const lv = [...npc.affinity?.levels ?? []].sort((a, b) => a.at - b.at);
  let idx = -1;
  lv.forEach((l2, i) => {
    if (points >= l2.at) idx = i;
  });
  const l = lv[idx];
  return { index: idx, at: l?.at ?? 0, name: l?.name ?? null, dialogue: l?.dialogue };
}
var hearts = (npc, points) => Math.floor(points / Math.max(1, npc.affinity?.heartSize ?? 10));
function heartEventDue(npc, b) {
  const h = hearts(npc, b.points);
  const seen = b.seen ?? [];
  return [...npc.affinity?.heartEvents ?? []].sort((a, c) => a.hearts - c.hearts).find((e) => e.hearts <= h && !seen.includes(e.id)) ?? null;
}
function markHeartEvent(b, id) {
  b.seen = [.../* @__PURE__ */ new Set([...b.seen ?? [], id])];
}
function dialogueFor(world, npc, b, day, minute, night) {
  const act = activeEntry(world, npc, day, minute, night);
  const st = state(world, npc.id, day, minute, night);
  if (act?.entry.dialogue && st && !st.moving) return act.entry.dialogue;
  const lv = level(npc, b.points);
  return lv.dialogue ?? npc.dialogue ?? null;
}
function questsFor(npc, b, minute) {
  const m = (minute % 1440 + 1440) % 1440;
  return (npc.quests ?? []).filter((q) => b.points >= (q.minAffinity ?? 0)).filter((q) => {
    const a = q.from ? toMinutes(q.from) : 0;
    const z = q.to ? toMinutes(q.to) : 1440;
    return a <= z ? m >= a && m < z : m >= a || m < z;
  }).map((q) => q.quest);
}
function nearest(world, day, minute, x, y, radius = 1.5, night) {
  let best = null;
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
export {
  DEFAULT_CALENDAR,
  DEFAULT_CLOCK,
  FOG_LIFTS,
  GIFT_POINTS,
  NON_HALAL_TAGS,
  WEATHER_INFO,
  activeEntry,
  calendarOf,
  date,
  dayList,
  dayOf,
  dialogueFor,
  entryMatches,
  eventsOn,
  findPath,
  fmtTime,
  forecast,
  gift,
  giftKind,
  hash01,
  heartEventDue,
  hearts,
  isNight,
  keepsHalal,
  level,
  markHeartEvent,
  nearest,
  nearestWalkable,
  newBond,
  placeTile,
  questsFor,
  route,
  routeKey,
  routePairs,
  state,
  states,
  talk,
  toMinutes,
  walkable,
  weatherAt,
  weatherOn,
  weekday,
  yearLength
};
