import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeEntry, findPath, fmtTime, gift, isNight, level, nearest, newBond, questsFor, state, states, talk, toMinutes, weekday, dialogueFor } from "../src/shared/engine.js";
import type { TileMap, World } from "../src/shared/types.js";
import { loadWorldStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let world: World;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  world = await loadWorldStrict(root);
});
afterAll(() => cleanup());

const grid = (rows: string[]): TileMap => ({ id: "t", width: rows[0]!.length, height: rows.length, tileSize: 16, collision: rows });

describe("clock", () => {
  it("parses times, weekdays and night", () => {
    expect(toMinutes("06:30")).toBe(390);
    expect(Number.isNaN(toMinutes("25:00"))).toBe(true);
    expect(fmtTime(-30)).toBe("23:30");
    expect(weekday(world.clock, 4)).toBe("fri");
    expect(weekday(world.clock, -1)).toBe("sun");
    expect(isNight(world.clock, 5 * 60)).toBe(true);
    expect(isNight(world.clock, 12 * 60)).toBe(false);
    expect(isNight(world.clock, 19 * 60)).toBe(true);
  });
});

describe("A*", () => {
  it("finds the shortest 4-way path and respects walls", () => {
    const m = grid(["....", ".##.", "...."]);
    const p = findPath(m, [0, 1], [3, 1]);
    expect(p.length - 1).toBe(5);
    expect(p.every(([x, y]) => m.collision[y]![x] !== "#")).toBe(true);
    expect(findPath(grid([".#."]), [0, 0], [2, 0])).toEqual([]);
    expect(findPath(m, [1, 1], [0, 0])).toEqual([]);
  });
  it("is deterministic (same tie-breaking every call)", () => {
    const m = grid([".....", ".....", "....."]);
    expect(findPath(m, [0, 0], [4, 2])).toEqual(findPath(m, [0, 0], [4, 2]));
  });
});

describe("schedules", () => {
  it("walks from the previous place and arrives", () => {
    const kakna = world.npcs.find((n) => n.id === "kakna")!;
    const a = activeEntry(world, kakna, 0, 6 * 60 + 31)!;
    expect(a.entry.place).toBe("stall_roti");
    expect(a.from).toBe("house_makyah");
    const s1 = state(world, "kakna", 0, 6 * 60 + 31)!;
    expect(s1.moving).toBe(true);
    expect(s1.activity).toBe("walk");
    const s2 = state(world, "kakna", 0, 8 * 60)!;
    expect(s2.moving).toBe(false);
    expect(s2.place).toBe("stall_roti");
  });
  it("Friday: Muslim men go to the mosque at midday; the monk does not", () => {
    const at = states(world, 4, 12 * 60 + 45);
    const mosque = at.filter((s) => s.place === "mosque").map((s) => s.id);
    expect(mosque).toEqual(expect.arrayContaining(["pakcik", "hamid"]));
    expect(mosque).not.toContain("monk");
    expect(states(world, 3, 12 * 60 + 45).filter((s) => s.place === "mosque").length).toBeLessThan(mosque.length);
  });
  it("night entries apply at night, and can be forced", () => {
    const day = state(world, "kakna", 2, 20 * 60)!;
    const forced = state(world, "kakna", 2, 20 * 60, false)!;
    expect(day.night).toBe(true);
    expect(forced.night).toBe(false);
  });
  it("everyone sleeps indoors after 23:00", () => {
    expect(states(world, 1, 23 * 60 + 30).every((s) => s.indoors)).toBe(true);
  });
  it("positions stay on walkable tiles", () => {
    for (let m = 0; m < 1440; m += 7)
      for (const s of states(world, 4, m)) {
        const x = Math.round(s.x);
        const y = Math.round(s.y);
        expect(world.map.collision[y]![x]).not.toBe("#");
      }
  });
  it("nearest ignores NPCs who are indoors", () => {
    const s = state(world, "vendor", 4, 10 * 60)!;
    expect(nearest(world, 4, 10 * 60, s.x, s.y, 0.5)?.id).toBe("vendor");
    const sleeping = state(world, "fatimah", 4, 2 * 60)!;
    expect(nearest(world, 4, 2 * 60, sleeping.x, sleeping.y, 0.1)).toBeNull();
  });
});

describe("affinity", () => {
  it("talk once a day, gifts by taste, levels unlock dialogue and quests", () => {
    const f = world.npcs.find((n) => n.id === "fatimah")!;
    const b = newBond(f);
    const start = b.points;
    expect(talk(f, b, 0)).toBeGreaterThan(0);
    expect(talk(f, b, 0)).toBe(0);
    expect(gift(f, b, "kurma", 0)).toEqual({ kind: "loved", delta: 8 });
    expect(gift(f, b, "kurma", 0).delta).toBe(0);
    expect(b.points).toBeGreaterThan(start);
    for (let d = 1; d < 12; d++) {
      talk(f, b, d);
      gift(f, b, "kurma", d);
    }
    expect(level(f, b.points).index).toBeGreaterThanOrEqual(2);
    expect(dialogueFor(world, f, b, 1, 3 * 60)).not.toBeNull();
    expect(questsFor(f, { points: 0, lastGift: -1, lastTalk: -1 }, 600).length).toBeLessThanOrEqual(questsFor(f, b, 600).length);
  });
});
