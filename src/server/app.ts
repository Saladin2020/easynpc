import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { CULTURES, FACINGS, WEEKDAYS, WHEN, type Npc, type ScheduleEntry } from "../shared/types.js";
import { exportNpcs, type ExportPreset } from "../lib/export.js";
import { npcDay, parseTime, pathBetween, removeEntry, setEntry, simulateBond, upsertNpc, whereAt } from "../lib/ops.js";
import { encodePng } from "../lib/png.js";
import { renderMapPng, timelineRaster } from "../lib/render.js";
import { assertSafeId, checkWorkspace, dirs, listDocs, loadWorld, loadWorldStrict, readDoc, saveDoc, workspaceSummary } from "../lib/workspace.js";
import { errMsg, useGuard, useWeb, type BaseOptions } from "./base.js";

export type CreateAppOptions = BaseOptions;
const bytes = (buf: Buffer) => new Uint8Array(buf);
const night = (v?: string) => (v === undefined || v === "" || v === "auto" ? undefined : v === "1" || v === "true");

export function createApp(o: CreateAppOptions): Hono {
  const app = new Hono();
  const root = o.workspaceRoot;
  useGuard(app, o);
  app.get("/api/workspace", async (c) => c.json({ ...(await workspaceSummary(root)), enums: { weekdays: WEEKDAYS, when: WHEN, facings: FACINGS, cultures: CULTURES } }));
  app.get("/api/world", async (c) => {
    const r = await loadWorld(root);
    return c.json({ world: r.world, errors: r.errors, warnings: r.warnings, sources: r.sources });
  });
  app.get("/api/check", async (c) => c.json(await checkWorkspace(root)));
  app.get("/api/docs", async (c) => c.json({ docs: (await listDocs(root)).map((d) => ({ id: d.id, parseError: d.parseError ?? null })) }));
  app.get("/api/docs/:id", async (c) => {
    try {
      const id = assertSafeId(c.req.param("id"), "document id");
      const doc = await readDoc(root, id);
      if (!doc) return c.json({ error: `No document ${id}` }, 404);
      return c.json({ id, doc });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 404);
    }
  });
  app.post("/api/docs/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { doc: unknown; dryRun?: boolean };
      const res = await saveDoc(root, c.req.param("id"), body.doc, { dryRun: body.dryRun });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.post("/api/npc", async (c) => {
    try {
      const body = (await c.req.json()) as { npc: Npc; dryRun?: boolean };
      assertSafeId(body.npc?.id, "npc id");
      const res = await upsertNpc(root, body.npc, { dryRun: body.dryRun });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.post("/api/entry", async (c) => {
    try {
      const body = (await c.req.json()) as { npc: string; entry: ScheduleEntry; dryRun?: boolean };
      const res = await setEntry(root, body.npc, body.entry, { dryRun: body.dryRun });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.post("/api/entry/remove", async (c) => {
    try {
      const body = (await c.req.json()) as { npc: string; at: string; days?: string[]; when?: string };
      const res = await removeEntry(root, body.npc, body.at, { days: body.days, when: body.when });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.get("/api/where", async (c) => {
    try {
      return c.json(whereAt(await loadWorldStrict(root), Number(c.req.query("day") ?? 0), parseTime(c.req.query("at"), 480), night(c.req.query("night"))));
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.get("/api/schedule/:id", async (c) => {
    try {
      return c.json(npcDay(await loadWorldStrict(root), c.req.param("id"), Number(c.req.query("day") ?? 0), c.req.query("night") === "1"));
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.get("/api/path", async (c) => {
    try {
      return c.json(pathBetween(await loadWorldStrict(root), c.req.query("from") ?? "", c.req.query("to") ?? ""));
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.post("/api/bond", async (c) => {
    try {
      const body = (await c.req.json()) as { npc: string; days?: number; gift?: string; at?: string };
      return c.json(simulateBond(await loadWorldStrict(root), body.npc, Array.from({ length: Math.max(1, Math.min(60, body.days ?? 7)) }, (_, d) => ({ day: d, time: body.at, gift: body.gift }))));
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.get("/api/render/map.png", async (c) => {
    try {
      const png = await renderMapPng(root, await loadWorldStrict(root), Number(c.req.query("day") ?? 0), parseTime(c.req.query("at"), 480), { night: night(c.req.query("night")), routes: c.req.query("routes") !== "0", scale: Number(c.req.query("scale") ?? 1) });
      return c.body(bytes(png), 200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  app.get("/api/render/timeline.png", async (c) => {
    try {
      const t = timelineRaster(await loadWorldStrict(root), Number(c.req.query("day") ?? 0), night(c.req.query("night"))).scaled(Math.max(1, Math.min(4, Number(c.req.query("scale") ?? 1))));
      return c.body(bytes(encodePng(t.width, t.height, t.data)), 200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  /** Easy Sprite sheet for the NPC list. */
  app.get("/api/sprite/:id", async (c) => {
    const id = c.req.param("id").replace(/\.png$/, "");
    try {
      assertSafeId(id);
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
    const p = path.join(dirs(root).characters, `${id}.png`);
    if (!existsSync(p)) return c.json({ error: "no sheet" }, 404);
    return c.body(bytes(await readFile(p)), 200, { "Content-Type": "image/png" });
  });
  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { preset?: ExportPreset; out?: string };
      const res = await exportNpcs(root, { preset: body.preset, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 400);
    }
  });
  useWeb(app, o);
  return app;
}
