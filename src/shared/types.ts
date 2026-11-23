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
  gifts?: { loved?: string[]; liked?: string[]; disliked?: string[] };
  levels?: AffinityLevel[];
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
  /** "from>to" → tile path (precomputed by the CLI, A* fallback at runtime). */
  routes?: Record<string, Array<[number, number]>>;
}

export interface Diagnostic {
  path: string;
  message: string;
}
