import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkWorkspace, loadWorld, readDoc, saveDoc } from "../src/lib/workspace.js";
import { npcDay, pathBetween, setEntry, simulateBond, whereAt, removeEntry } from "../src/lib/ops.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

describe("workspace", () => {
  it("the sample is clean, with Thai names in Thai script", async () => {
    const r = await checkWorkspace(root);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.cross.npcs).toBe(10);
    expect(r.cross.places).toBe(18);
    expect(r.cross.routes).toBeGreaterThan(40);
    expect(r.cross.dialogues).toBeGreaterThan(5);
    expect(r.cross.quests).toBe(3);
    const w = (await loadWorld(root)).world!;
    for (const n of w.npcs) expect(n.name.th).toMatch(/[\u0E00-\u0E7F]/);
  });

  it("refuses non-halal gifts for Malay-Muslim NPCs and sacred names", async () => {
    const doc = (await readDoc(root, "village"))!;
    const bad = structuredClone(doc);
    bad.npcs!.find((n) => n.id === "pakcik")!.affinity!.gifts!.loved = ["moo_ping"];
    const r = await saveDoc(root, "village", bad, { dryRun: true });
    expect(r.errors.some((e) => /halal/i.test(e.message))).toBe(true);
    const bad2 = structuredClone(doc);
    bad2.npcs![0]!.name = { th: "ศาสดา", en: "Prophet" };
    expect((await saveDoc(root, "village", bad2, { dryRun: true })).errors.length).toBeGreaterThan(0);
    expect((await readDoc(root, "village"))!.npcs![0]!.name.en).toBe(doc.npcs![0]!.name.en);
  });

  it("reports bad times, unknown places and broken dialogue / quest references", async () => {
    const doc = (await readDoc(root, "village"))!;
    const bad = structuredClone(doc);
    bad.npcs![0]!.schedule.push({ at: "25:00", place: "moon", activity: "home" });
    const r = await saveDoc(root, "village", bad, { dryRun: true });
    expect(r.errors.map((e) => e.message).join("\n")).toMatch(/25:00[\s\S]*moon|moon[\s\S]*25:00/);
    const f = path.join(root, "dialogues", "salam_neighbours.ezd");
    const src = await readFile(f, "utf8");
    await writeFile(f, src.replace("=== market", "=== pasar"));
    const c = await checkWorkspace(root);
    expect(c.errors.some((e) => /node "market"/.test(e.message))).toBe(true);
    await writeFile(f, src);
  });

  it("ops: day plan, where, path, bond, set / remove entry", async () => {
    const w = (await loadWorld(root)).world!;
    const plan = npcDay(w, "adam", 5);
    expect(plan.weekday).toBe("sat");
    expect(plan.entries.length).toBeGreaterThan(2);
    expect(whereAt(w, 4, 12 * 60).npcs.length).toBe(10);
    expect(pathBetween(w, "mosque", "beach").reachable).toBe(true);
    expect(simulateBond(w, "fatimah", [{ day: 0, gift: "kurma" }]).steps[0]!.points).toBeGreaterThan(5);
    const r = await setEntry(root, "adam", { at: "16:30", place: "beach", activity: "play", days: ["sat", "sun"] });
    expect(r.errors).toEqual([]);
    expect(r.saved).toBe(true);
    const bad = await setEntry(root, "adam", { at: "16:30", place: "nowhere", activity: "play" });
    expect(bad.saved).toBe(false);
    expect((await removeEntry(root, "adam", "16:30", { days: ["sat", "sun"] })).saved).toBe(true);
  });
});
