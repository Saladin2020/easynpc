import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { date, dayOf, eventsOn, forecast, gift, hearts, heartEventDue, markHeartEvent, newBond, state, weatherAt, weatherOn, yearLength, DEFAULT_CALENDAR, WEATHER_INFO } from "../src/shared/engine.js";
import { loadWorldStrict, checkWorkspace } from "../src/lib/workspace.js";
import type { World } from "../src/shared/types.js";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tempWorkspace } from "./helpers.js";

let root = "";
let cleanup = async () => {};
let world: World;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  world = await loadWorldStrict(root);
});
afterAll(() => cleanup());

describe("calendar", () => {
  it("walks days → weeks → seasons → years", () => {
    expect(yearLength(DEFAULT_CALENDAR)).toBe(84);
    expect(date(world, 0)).toMatchObject({ year: 1, season: "hot", dayOfSeason: 1, week: 1, weekday: "mon", dayOfYear: 0 });
    expect(date(world, 27)).toMatchObject({ season: "hot", dayOfSeason: 28, week: 4 });
    expect(date(world, 28)).toMatchObject({ season: "rainy", dayOfSeason: 1, seasonIndex: 1 });
    expect(date(world, 84)).toMatchObject({ year: 2, season: "hot", dayOfSeason: 1 });
    for (const d of [0, 5, 40, 83, 200]) {
      const dt = date(world, d);
      expect(dayOf(world, dt.year, dt.season, dt.dayOfSeason)).toBe(d);
    }
  });
  it("finds date events (weekly market, seasonal festivals) and their hours", () => {
    const sat = Array.from({ length: 7 }, (_, d) => d).find((d) => date(world, d).weekday === "sat")!;
    expect(eventsOn(world, sat).map((e) => e.id)).toContain("market_day");
    expect(eventsOn(world, sat, 8 * 60).map((e) => e.id)).toContain("market_day");
    expect(eventsOn(world, sat, 14 * 60).map((e) => e.id)).not.toContain("market_day");
    const kite = dayOf(world, 1, "cool", 10);
    expect(eventsOn(world, kite).map((e) => e.id)).toContain("kite_festival");
    expect(eventsOn(world, kite + 84).map((e) => e.id)).toContain("kite_festival");
  });
});

describe("weather", () => {
  it("is deterministic, follows the season weights and lifts fog at 11:00", () => {
    const a = forecast(world, 0, 84).map((x) => x.weather);
    expect(forecast(world, 0, 84).map((x) => x.weather)).toEqual(a);
    const hot = a.slice(0, 28);
    const rainy = a.slice(28, 56);
    const wet = (xs: string[]) => xs.filter((w) => w === "rain" || w === "storm").length;
    expect(wet(rainy)).toBeGreaterThan(wet(hot));
    expect(a.slice(0, 28)).not.toContain("fog");
    const fogDay = a.findIndex((w) => w === "fog");
    expect(fogDay).toBeGreaterThanOrEqual(56);
    expect(weatherAt(world, fogDay, 8 * 60)).toBe("fog");
    expect(weatherAt(world, fogDay, 12 * 60)).toBe("cloudy");
    expect(WEATHER_INFO.storm.outdoors).toBe(false);
    const seeded = { ...world, calendar: { ...world.calendar!, weatherSeed: 99 } };
    expect(forecast(seeded, 0, 84).map((x) => x.weather)).not.toEqual(a);
  });
  it("changes schedules: the fisher stays home in a storm", () => {
    const storm = Array.from({ length: 84 }, (_, d) => d).find((d) => weatherOn(world, d) === "storm")!;
    const calm = Array.from({ length: 84 }, (_, d) => d).find((d) => weatherOn(world, d) === "clear")!;
    expect(storm).toBeDefined();
    expect(state(world, "hamid", storm, 8 * 60)!.activity).toBe("home");
    expect(state(world, "hamid", calm, 8 * 60)!.activity).toBe("fish");
  });
});

describe("relationships", () => {
  it("counts hearts, plays heart events once and refuses non-halal gifts", () => {
    const f = world.npcs.find((n) => n.id === "fatimah")!;
    const b = newBond(f);
    expect(gift(f, b, "pork_satay", 0, ["pork"])).toEqual({ kind: "refused", delta: 0 });
    expect(gift(f, b, "kurma", 0)).toEqual({ kind: "loved", delta: 8 });
    expect(hearts(f, b.points)).toBe(1);
    expect(heartEventDue(f, b)).toBeNull();
    b.points = 21;
    expect(heartEventDue(f, b)?.id).toBe("fatimah_kuih");
    markHeartEvent(b, "fatimah_kuih");
    expect(heartEventDue(f, b)).toBeNull();
    const vendor = world.npcs.find((n) => n.id === "vendor")!;
    expect(gift(vendor, newBond(vendor), "beer", 0, ["alcohol"]).kind).toBe("neutral");
  });
  it("rejects ritual festivals and bad weather names", async () => {
    const p = path.join(root, "npcs", "village.easynpc.json");
    const orig = await readFile(p, "utf8");
    const d = JSON.parse(orig);
    d.calendar = { events: [{ id: "x", name: { th: "ทำบุญตักบาตร", en: "Merit making" } }], seasons: [{ id: "a", name: { th: "ก", en: "A" }, weather: { snow: 1 } }] };
    await writeFile(p, JSON.stringify(d));
    const r = await checkWorkspace(root);
    await writeFile(p, orig);
    const msgs = r.errors.map((e: { message: string }) => e.message).join("\n");
    expect(msgs).toMatch(/non-ritual/);
    expect(msgs).toMatch(/use clear\|cloudy/);
  });
});
