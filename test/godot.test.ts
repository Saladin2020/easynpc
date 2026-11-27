/**
 * Optional Godot check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the Godot project, imports it headless, then test_npc.gd checks schedule states, A* paths and affinity
 * against the TypeScript engine and runs the NPCs autoload (arrivals, talk once a day, save round-trip).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportNpcs } from "../src/lib/export.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export", () => {
  it("parity with the TS engine and the NPCs autoload", async () => {
    const out = path.join(root, "exports", "godot");
    await exportNpcs(root, { preset: "godot", out });
    for (let i = 0; i < 2; i++) spawnSync(GODOT!, ["--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 240_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_npc.gd"], { encoding: "utf8", timeout: 180_000 });
    expect(run.stderr).not.toMatch(/FAIL|SCRIPT ERROR/);
    expect(run.stdout).toMatch(/^S\|states \d{4}$/m);
    expect(run.stdout).toMatch(/^P\|paths 24$/m);
    expect(run.stdout).toMatch(/^B\|bonds 4$/m);
    expect(run.stdout).toMatch(/^C\|calendar days 67$/m);
    expect(run.stdout).toMatch(/^OK$/m);
  }, 900_000);
});
