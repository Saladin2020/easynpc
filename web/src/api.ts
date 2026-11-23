export { get, post } from "./api.base";
export type Name = { th: string; en: string; ms?: string };
export interface Diag { path: string; message: string }
export interface Summary {
  root: string;
  docs: string[];
  map: { id: string; file: string; width: number; height: number; tileSize: number } | null;
  clock: { dayStart: string; nightStart: string; secondsPerMinute: number; speed: number; firstWeekday: string } | null;
  places: Array<{ id: string; x: number; y: number; th: string; en: string }>;
  npcs: Array<{ id: string; th: string; en: string; role: string | null; sprite: string; culture: string | null; home: string; entries: number; quests: string[]; color: string | null }>;
  activities: Record<string, Name>;
  errors: Diag[];
  warnings: Diag[];
  enums: { weekdays: string[]; when: string[]; facings: string[]; cultures: string[] };
}
export interface Where { day: number; weekday: string; time: string; night: boolean; npcs: Array<{ id: string; name: Name; x: number; y: number; facing: string; moving: boolean; activity: string; place: string; indoors: boolean; progress: number; routeLength: number }> }
export interface DayPlan { id: string; name: Name; day: number; weekday: string; entries: Array<{ at: string; from: string; place: string; activity: string; tiles: number; walkMinutes: number; arrive: string; indoors: boolean; when: string; days: string[] | null; dialogue: { dialogue: string; node?: string } | null }> }
