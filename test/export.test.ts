import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportNpcs, parityData } from "../src/lib/export.js";
import { loadWorldStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

describe("export", () => {
  it("writes every preset", async () => {
    const r = await exportNpcs(root);
    expect(r.warnings).toEqual([]);
    expect(r.dirs.length).toBe(4);
    const ex = path.join(root, "exports");
    for (const f of ["easynpc-godot/project.godot", "easynpc-godot/easynpc/easynpc.gd", "easynpc-godot/easynpc/npc_engine.gd", "easynpc-godot/easynpc/parity.json", "easynpc-godot/easynpc/maps/multicultural_village_night.png", "easynpc-godot/test_npc.gd", "easynpc-pixi/index.html", "easynpc-pixi/easynpc-core.js", "easynpc-pixi/characters/town_monk.png", "easynpc-png/map-noon.png", "easynpc-png/timeline-day4.png", "easynpc-json/easynpc.world.json"]) expect(existsSync(path.join(ex, f)), f).toBe(true);
    const w = JSON.parse(await readFile(path.join(ex, "easynpc-json/easynpc.world.json"), "utf8"));
    expect(w.format).toBe("easynpc-world/1");
    expect(Object.keys(w.routes).length).toBe(r.routes);
    expect(await readFile(path.join(ex, "easynpc-godot/project.godot"), "utf8")).toMatch(/NPCs="\*res:\/\/easynpc\/easynpc.gd"/);
  });

  it("refuses --out outside the workspace and 'all' with --out", async () => {
    await expect(exportNpcs(root, { preset: "json", out: "/tmp/../etc/x" })).rejects.toThrow(/outside/);
    await expect(exportNpcs(root, { preset: "all", out: "x" })).rejects.toThrow(/single preset/);
  });

  it("parity data covers states, paths and bonds", async () => {
    const p = parityData(await loadWorldStrict(root));
    expect(p.states.length).toBeGreaterThan(2000);
    expect(p.paths.length).toBe(24);
    expect(p.bonds.length).toBe(4);
  });

  it("the Pixi core is the bundled engine", async () => {
    const core = await readFile(path.join(root, "exports/easynpc-pixi/easynpc-core.js"), "utf8").catch(() => "");
    expect(core).toMatch(/generated from src\/shared\/engine.ts/);
    expect(core).toMatch(/export \{/);
  });
});
