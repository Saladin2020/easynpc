import type { Flood, Lighting, Shop, Transit } from "./townlife.js";
export const FORMAT = "easynpc/1";
export const EXPORT_PRESETS = ["godot", "pixi", "png", "json", "all"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WHEN = ["any", "day", "night"] as const;
export type When = (typeof WHEN)[number];
export const CULTURES = ["thai", "malay", "chinese", "rural", "other"] as const;
export const FACINGS = ["front", "right", "back", "left"] as const;
export type Facing = (typeof FACINGS)[number];

export const WEATHERS = ["clear", "cloudy", "rain", "storm", "wind", "fog"] as const;
export type Weather = (typeof WEATHERS)[number];

export interface Name {
  th: string;
  en: string;
  ms?: string;
}

export interface Place {
  x: number;
  y: number;
  name?: Name;
  /** Face this way while there (default: keep walking direction). */
  facing?: Facing;
}

export interface DialogueRef {
  /** Easy Dialogue script id (.ezd @id). */
  dialogue: string;
  /** Node (=== name); default: the script's @start. */
  node?: string;
}

export interface ScheduleEntry {
  /** "HH:MM" — leave for `place` at this time. */
  at: string;
  place: string;
  activity: string;
  /** Only on these weekdays (default: every day). */
  days?: Weekday[];
  /** Only by day, only at night, or always (default). Night follows the clock unless the game forces it. */
  when?: When;
  facing?: Facing;
  /** Inside a building: hidden while there (sleep at home, cooking inside…). */
  indoors?: boolean;
  /** Dialogue while doing this (overrides the NPC default, not affinity levels). */
  dialogue?: DialogueRef;
  /** Only in this weather (e.g. fishing only when clear) — Easy NPC calendar weather. */
  weather?: Weather[];
  /** Never in this weather (e.g. no boat trip in a storm). */
  notWeather?: Weather[];
}

export interface AffinityLevel {
  at: number;
  name: Name;
  dialogue?: DialogueRef;
}

export interface Affinity {
  start?: number;
  max?: number;
  /** Points for the first talk each day. */
  talk?: number;
  gifts?: { loved?: string[]; liked?: string[]; disliked?: string[]; refuse?: string[] };
  levels?: AffinityLevel[];
  /** Points per heart (default 10): hearts = floor(points / heartSize). */
  heartSize?: number;
  /** Refuse gifts tagged pork / alcohol / non_halal (Muslim neighbours; default true for culture "malay"). */
  halal?: boolean;
  /** Relationship scenes unlocked at a number of hearts, played once each. */
  heartEvents?: HeartEvent[];
}

export interface HeartEvent {
  id: string;
  hearts: number;
  name?: Name;
  dialogue?: DialogueRef;
  /** Easy Quest event the game emits when it plays: heart <npc> <id>; optional quest it starts. */
  quest?: string;
}

export interface Season {
  id: string;
  name: Name;
  /** Days in this season (default calendar.daysPerSeason). */
  days?: number;
  /** Weather weights for the daily roll (default: clear only). */
  weather?: Partial<Record<Weather, number>>;
}

export interface CalendarEvent {
  id: string;
  name: Name;
  /** Season id (default: every season). */
  season?: string;
  /** Day of the season, 1-based (default: every day that matches weekday). */
  day?: number;
  weekday?: Weekday;
  from?: string;
  to?: string;
  /** Easy NPC place where it happens. */
  place?: string;
  tags?: string[];
}

export interface Calendar {
  daysPerSeason: number;
  startYear: number;
  seasons: Season[];
  events: CalendarEvent[];
  /** Seed of the deterministic daily weather. */
  weatherSeed: number;
  /** Chance (0..1) that a day keeps yesterday's base weather. */
  persistence: number;
}

export interface QuestHook {
  /** Easy Quest quest id (=== id in an .ezq). */
  quest: string;
  minAffinity?: number;
  /** Offered only between these times. */
  from?: string;
  to?: string;
}

export interface Npc {
  id: string;
  name: Name;
  /** Easy Sprite top-down sheet id: characters/<sprite>.png. */
  sprite: string;
  culture?: (typeof CULTURES)[number];
  role?: Name;
  /** Tiles per game minute (default clock.speed). */
  speed?: number;
  home: string;
  schedule: ScheduleEntry[];
  affinity?: Affinity;
  dialogue?: DialogueRef;
  quests?: QuestHook[];
  color?: string;
}

export interface Clock {
  /** Night from nightStart to dayStart. */
  dayStart: string;
  nightStart: string;
  /** Real seconds per game minute (runtime). */
  secondsPerMinute: number;
  /** Default walking speed, tiles per game minute. */
  speed: number;
  /** Weekday of game day 0. */
  firstWeekday: Weekday;
}

export interface NpcDoc {
  format: string;
  id?: string;
  /** Easy Tilemap export (.tilemap.json) relative to the workspace. */
  map?: string;
  clock?: Partial<Clock>;
  places?: Record<string, Place>;
  /** Activity id → display name. */
  activities?: Record<string, Name>;
  npcs?: Npc[];
  /** Days, seasons, years, date events and daily weather (defaults: 3 Thai seasons × 28 days). */
  calendar?: Partial<Calendar>;
  lighting?: Lighting;
  shops?: Record<string, Shop>;
  transit?: Transit;
  flood?: Partial<Flood>;
}

export interface TileMap {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  /** Rows of "." walkable / "#" blocked. */
  collision: string[];
}

export interface World {
  map: TileMap;
  clock: Clock;
  places: Record<string, Place>;
  npcs: Npc[];
  activities: Record<string, Name>;
  calendar?: Calendar;
  /** "from>to" → tile path (precomputed by the CLI, A* fallback at runtime). */
  routes?: Record<string, Array<[number, number]>>;
  /** Town life: lighting keyframes, shop hours, train / flight timetables, flooding. */
  lighting?: Lighting;
  shops?: Record<string, Shop>;
  transit?: Transit;
  flood?: Flood;
}

export interface Diagnostic {
  path: string;
  message: string;
}
