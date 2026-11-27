/**
 * Easy NPC calendar — days → weeks → seasons → years, date events (festivals, market days) and a deterministic
 * daily weather roll per season. Pure, so the CLI, Godot (npc_engine.gd, parity-tested) and Pixi agree.
 *
 *   date(world, day) → { year, season, dayOfSeason, week, weekday, dayOfYear }
 *   weatherOn(world, day) / weatherAt(world, day, minute) → "clear" | "cloudy" | "rain" | "storm" | "wind" | "fog"
 *   eventsOn(world, day, minute?) → calendar events today (or right now)
 */
import type { Calendar, CalendarEvent, Clock, Name, Weather, Weekday, World } from "./types.js";
import { WEATHERS, WEEKDAYS } from "./types.js";

const n = (th: string, en: string, ms: string): Name => ({ th, en, ms });

/** Default: the three Thai seasons, 28 days each, multicultural non-ritual festivals. */
export const DEFAULT_CALENDAR: Calendar = {
  daysPerSeason: 28,
  startYear: 1,
  weatherSeed: 7,
  persistence: 0.35,
  seasons: [
    { id: "hot", name: n("ฤดูร้อน", "Hot season", "Musim panas"), weather: { clear: 6, cloudy: 2, wind: 2, storm: 1 } },
    { id: "rainy", name: n("ฤดูฝน", "Rainy season", "Musim hujan"), weather: { rain: 5, storm: 2, cloudy: 2, clear: 1 } },
    { id: "cool", name: n("ฤดูหนาว", "Cool season", "Musim sejuk"), weather: { clear: 5, fog: 3, cloudy: 2, wind: 1 } },
  ],
  events: [
    { id: "market_day", name: n("ตลาดนัด", "Market day", "Hari pasar"), weekday: "sat", from: "07:00", to: "13:00", tags: ["market"] },
    { id: "kolek_race", name: n("แข่งเรือกอและ", "Kolek boat race", "Lumba perahu kolek"), season: "rainy", day: 25, from: "09:00", to: "16:00", tags: ["festival", "boat"] },
    { id: "kite_festival", name: n("เทศกาลว่าว", "Kite festival", "Pesta wau"), season: "cool", day: 10, from: "15:00", to: "18:30", tags: ["festival", "kite"] },
    { id: "harvest_fair", name: n("งานเกี่ยวข้าว", "Harvest fair", "Pesta menuai"), season: "cool", day: 20, from: "08:00", to: "20:00", tags: ["festival", "harvest"] },
  ],
};

/** What each weather means for scenes and gameplay (runtimes read this from the world file). */
export const WEATHER_INFO: Record<Weather, { name: Name; fx: string | null; darken: number; wind: number; outdoors: boolean; waters: boolean; fishing: number }> = {
  clear: { name: n("แดดออก", "Clear", "Cerah"), fx: null, darken: 0, wind: 0, outdoors: true, waters: false, fishing: 1 },
  cloudy: { name: n("เมฆครึ้ม", "Cloudy", "Mendung"), fx: null, darken: 0.12, wind: 0.1, outdoors: true, waters: false, fishing: 1.2 },
  rain: { name: n("ฝนตก", "Rain", "Hujan"), fx: "rain", darken: 0.25, wind: 0.2, outdoors: true, waters: true, fishing: 1.5 },
  storm: { name: n("พายุฝน", "Storm", "Ribut"), fx: "storm_rain", darken: 0.45, wind: 0.8, outdoors: false, waters: true, fishing: 0 },
  wind: { name: n("ลมแรง", "Windy", "Berangin"), fx: "falling_leaves", darken: 0.05, wind: 0.6, outdoors: true, waters: false, fishing: 0.8 },
  fog: { name: n("หมอกลง", "Fog", "Berkabus"), fx: "fog_drift", darken: 0.2, wind: 0, outdoors: true, waters: false, fishing: 0.7 },
};

/** Fog lifts at 11:00 (cloudy after). */
export const FOG_LIFTS = 11 * 60;

export const calendarOf = (world: Pick<World, "calendar">): Calendar => world.calendar ?? DEFAULT_CALENDAR;
const seasonDays = (cal: Calendar, i: number) => cal.seasons[i]?.days ?? cal.daysPerSeason;
export const yearLength = (cal: Calendar) => cal.seasons.reduce((a, _s, i) => a + seasonDays(cal, i), 0);

export interface GameDate {
  day: number;
  year: number;
  season: string;
  seasonIndex: number;
  /** 1-based. */
  dayOfSeason: number;
  /** 1-based week of the season. */
  week: number;
  weekday: Weekday;
  /** 0-based. */
  dayOfYear: number;
}

export function date(world: Pick<World, "calendar" | "clock">, day: number): GameDate {
  const cal = calendarOf(world);
  const len = Math.max(1, yearLength(cal));
  const d = Math.max(0, Math.floor(day));
  const year = cal.startYear + Math.floor(d / len);
  let doy = d % len;
  const dayOfYear = doy;
  let si = 0;
  while (si < cal.seasons.length - 1 && doy >= seasonDays(cal, si)) doy -= seasonDays(cal, si++);
  const clock: Clock = world.clock;
  const wd = WEEKDAYS[(((WEEKDAYS.indexOf(clock.firstWeekday) + d) % 7) + 7) % 7]!;
  return { day: d, year, season: cal.seasons[si]?.id ?? "", seasonIndex: si, dayOfSeason: doy + 1, week: Math.floor(doy / 7) + 1, weekday: wd, dayOfYear };
}

/** Day number of (year, season, dayOfSeason) — inverse of date(). */
export function dayOf(world: Pick<World, "calendar">, year: number, season: string, dayOfSeason: number): number {
  const cal = calendarOf(world);
  let d = (year - cal.startYear) * yearLength(cal);
  for (let i = 0; i < cal.seasons.length && cal.seasons[i]!.id !== season; i++) d += seasonDays(cal, i);
  return d + dayOfSeason - 1;
}

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export function eventsOn(world: Pick<World, "calendar" | "clock">, day: number, minute?: number): CalendarEvent[] {
  const cal = calendarOf(world);
  const dt = date(world, day);
  return cal.events.filter((e) => {
    if (e.season && e.season !== dt.season) return false;
    if (e.day !== undefined && e.day !== dt.dayOfSeason) return false;
    if (e.weekday && e.weekday !== dt.weekday) return false;
    if (minute === undefined) return true;
    const m = ((minute % 1440) + 1440) % 1440;
    const a = e.from ? toMin(e.from) : 0;
    const z = e.to ? toMin(e.to) : 1440;
    return m >= a && m < z;
  });
}

/** 32-bit hash → [0, 1). Same integer math in GDScript (npc_engine.gd). */
export function hash01(seed: number, day: number, salt: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(day | 0, 668265263) + Math.imul(salt | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function baseWeather(cal: Calendar, seasonIndex: number, day: number): Weather {
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

/** The day's weather: the season roll, or (persistence chance, same season) yesterday's roll. */
export function weatherOn(world: Pick<World, "calendar" | "clock">, day: number): Weather {
  const cal = calendarOf(world);
  const d = Math.max(0, Math.floor(day));
  const si = date(world, d).seasonIndex;
  if (d > 0 && hash01(cal.weatherSeed, d, 2) < cal.persistence && date(world, d - 1).seasonIndex === si) return baseWeather(cal, si, d - 1);
  return baseWeather(cal, si, d);
}

/** Weather at a time of day (fog lifts at 11:00). */
export function weatherAt(world: Pick<World, "calendar" | "clock">, day: number, minute: number): Weather {
  const w = weatherOn(world, day);
  const m = ((minute % 1440) + 1440) % 1440;
  return w === "fog" && m >= FOG_LIFTS ? "cloudy" : w;
}

export function forecast(world: Pick<World, "calendar" | "clock">, from: number, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = from + i;
    return { ...date(world, d), weather: weatherOn(world, d), events: eventsOn(world, d).map((e) => e.id) };
  });
}
