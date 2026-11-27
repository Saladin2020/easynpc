import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR, DEFAULT_CLOCK, departures, floodEffects, floodLevel, lighting, phaseAt, serviceAt, shopStatus, weatherOn } from "../src/shared/engine.js";
import type { World } from "../src/shared/types.js";
import { loadWorldStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

const base = (): World => ({
  map: { id: "m", width: 4, height: 4, tileSize: 16, collision: ["....", "....", "....", "...."] },
  clock: { ...DEFAULT_CLOCK },
  places: {},
  npcs: [],
  activities: {},
  calendar: structuredClone(DEFAULT_CALENDAR),
});

describe("lighting phases", () => {
  it("walks dawn → morning → noon → afternoon → sunset → evening → night → late night", () => {
    const seq = [300, 400, 700, 900, 1030, 1120, 1210, 1400].map(phaseAt);
    expect(seq).toEqual(["dawn", "morning", "noon", "afternoon", "sunset", "evening", "night", "late_night"]);
    expect(phaseAt(60)).toBe("late_night");
  });
  it("blends smoothly (no jumps bigger than a few levels per game minute) and wraps at midnight", () => {
    const w = base();
    let prev = lighting(w, 0);
    for (let m = 1; m <= 1440; m++) {
      const l = lighting(w, m);
      expect(Math.abs(l.dark - prev.dark)).toBeLessThan(0.02);
      for (let i = 0; i < 3; i++) expect(Math.abs(l.tint[i]! - prev.tint[i]!)).toBeLessThanOrEqual(8);
      prev = l;
    }
    expect(lighting(w, 1440)).toEqual(lighting(w, 0));
    expect(lighting(w, 720).dark).toBe(0);
    expect(lighting(w, 720).tintHex).toBe(0xffffff);
    expect(lighting(w, 60).lamps).toBe(1);
    expect(lighting(w, 1080).dark).toBeGreaterThan(0.08);
  });
});

describe("shop hours", () => {
  const w = base();
  w.shops = {
    s: { name: { th: "ร้าน", en: "Shop" }, hours: "07:00-19:00", closedOn: ["wed"] },
    late: { name: { th: "ร้านดึก", en: "Late" }, hours: "18:00-02:00" },
    stall: { name: { th: "แผง", en: "Stall" }, hours: "07:00-13:00", kind: "stall", event: "market_day" },
  };
  it("opens and closes by time, weekday, event and flood", () => {
    expect(shopStatus(w, "s", 0, 6 * 60)).toMatchObject({ open: false, reason: "hours", opensAt: "07:00" });
    expect(shopStatus(w, "s", 0, 8 * 60).open).toBe(true);
    expect(shopStatus(w, "s", 2, 8 * 60)).toMatchObject({ open: false, reason: "closed_day" });
    expect(shopStatus(w, "late", 0, 60).open).toBe(true);
    expect(shopStatus(w, "late", 0, 600).open).toBe(false);
    expect(shopStatus(w, "stall", 5, 8 * 60).open).toBe(true); // day 5 = Saturday market
    expect(shopStatus(w, "stall", 4, 8 * 60).reason).toBe("event");
    expect(shopStatus(w, "stall", 5, 8 * 60, 0.4).reason).toBe("flood");
    expect(shopStatus(w, "s", 0, 8 * 60, 0.4).open).toBe(true);
    expect(shopStatus(w, "nope", 0, 0).reason).toBe("unknown");
  });
});

describe("timetables", () => {
  const w = base();
  w.transit = { lines: [
    { id: "a_b", kind: "train", name: { th: "ก", en: "A" }, from: "a", to: "b", departs: ["08:00", "12:00"], minutes: 30, fare: 20 },
    { id: "f", kind: "flight", name: { th: "บิน", en: "Fly" }, from: "a", to: "c", departs: ["09:00"], minutes: 40, board: 25 },
  ] };
  it("lists upcoming departures across midnight and finds the boarding service", () => {
    const list = departures(w, "a", 0, 7 * 60);
    expect(list.map((d) => `${d.line}@${d.depart}`).slice(0, 3)).toEqual(["a_b@08:00", "f@09:00", "a_b@12:00"]);
    expect(departures(w, "a", 0, 23 * 60)[0]).toMatchObject({ day: 1, depart: "08:00" });
    expect(serviceAt(w, "a", 0, 7 * 60 + 50)?.line).toBe("a_b");
    expect(serviceAt(w, "a", 0, 7 * 60 + 30)).toBeNull();
    expect(departures(w, "a", 0, 0, { kind: "flight" }).every((d) => d.kind === "flight")).toBe(true);
  });
});

describe("flooding", () => {
  it("rises after rainy / stormy days, drains on dry ones, and slows walking", () => {
    const w = base();
    const levels = Array.from({ length: 84 }, (_, d) => floodLevel(w, d));
    const rainyMax = Math.max(...levels.slice(28, 56));
    const hotMax = Math.max(...levels.slice(0, 28));
    expect(rainyMax).toBeGreaterThan(hotMax);
    expect(rainyMax).toBeGreaterThan(0.35);
    for (let d = 1; d < 84; d++) {
      const wd = weatherOn(w, d);
      if (wd === "clear" || wd === "cloudy" || wd === "fog" || wd === "wind") expect(levels[d]!).toBeLessThanOrEqual(levels[d - 1]! + 1e-9);
    }
    expect(floodEffects(0).walk).toBe(1);
    expect(floodEffects(0.7)).toMatchObject({ stage: "knee", npcsIndoors: true, stallsClosed: true });
    expect(floodLevel(w, 30, 0)).toBe(floodLevel(w, 29));
  });
});

describe("workspace", () => {
  it("loads the town-life sample (shops, transit, flood) and rejects bad entries", async () => {
    const { root, cleanup } = await tempWorkspace();
    try {
      const world = await loadWorldStrict(root);
      expect(Object.keys(world.shops ?? {})).toContain("halal_stall");
      expect(world.transit!.lines.length).toBe(6);
      expect(world.flood!.drain).toBe(0.18);
    } finally {
      await cleanup();
    }
  });
});
