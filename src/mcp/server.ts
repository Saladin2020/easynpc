#!/usr/bin/env node
/**
 * Easy NPC MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8959
 *
 * Env: EASYNPC_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FACINGS, FORMAT, WEEKDAYS, WHEN } from "../shared/types.js";
import { EXPORT_PRESETS, exportNpcs } from "../lib/export.js";
import { npcDay, parseTime, pathBetween, setEntry, simulateBond, upsertNpc, whereAt } from "../lib/ops.js";
import { encodePng } from "../lib/png.js";
import { renderMapPng, timelineRaster } from "../lib/render.js";
import { checkWorkspace, loadWorldStrict, resolveWorkspace, workspaceSummary } from "../lib/workspace.js";
import { isEntry, mcpErr as err, mcpMsg as msg, mcpText as text, parseMcpArgs, startHttp } from "./http.js";

export const MCP_TOOL_NAMES = ["workspace_info", "get_schedule", "where_at", "find_path", "set_entry", "write_npc", "simulate_bond", "check_npcs", "render_map", "export_npcs"] as const;

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "Use a-z, 0-9, _ or -");
const TimeSchema = z.string().regex(/^\d{1,2}:\d{2}$/, "HH:MM");
const NameSchema = z.object({ th: z.string().min(1), en: z.string().min(1), ms: z.string().optional() });
const RefSchema = z.object({ dialogue: IdSchema, node: z.string().optional() });
const EntrySchema = z.object({ at: TimeSchema, place: IdSchema, activity: IdSchema, days: z.array(z.enum(WEEKDAYS)).optional(), when: z.enum(WHEN).optional(), facing: z.enum(FACINGS).optional(), indoors: z.boolean().optional(), dialogue: RefSchema.optional() });

export const FORMAT_CHEATSHEET = `Source npcs/<doc>.easynpc.json (${FORMAT}); every document in npcs/ merges into one world:
  map: "maps/<id>.tilemap.json" (Easy Tilemap export: collision rows, spawns) · clock {dayStart, nightStart, secondsPerMinute, speed (tiles/game minute), firstWeekday}
  places: { id: {x, y (tiles), name {th, en, ms}, facing?} } — snapped to the nearest walkable tile
  activities: { id: {th, en, ms} }
  npcs: [{ id, name {th,en,ms}, sprite (characters/<sprite>.png, Easy Sprite top-down sheet), culture, role, home, speed?, color?,
           schedule: [{ at "HH:MM", place, activity, days? [mon..sun], when? any|day|night, facing?, indoors?, dialogue? {dialogue, node} }],
           affinity? { start, max, talk, gifts {loved, liked, disliked: [Easy Items ids]}, levels [{at, name, dialogue?}] },
           dialogue? {dialogue (.ezd @id), node?}, quests? [{quest (.ezq quest id), minAffinity?, from?, to?}] }]
Schedules are stateless: at an entry's time the NPC leaves the previous entry's place and walks the A* route at its speed.
Rules: Thai names in Thai script; Malay-Muslim NPCs' gifts must be halal (no pork / alcohol); no sacred figures as NPCs.
Godot: NPCs autoload (talk/gift → QuestManager.emit_event("talk_<id>")); Pixi: loadNpcs(PIXI, "easynpc.world.json").`;

const png = (buf: Buffer, extra: unknown) => ({ content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" }, { type: "text" as const, text: JSON.stringify(extra) }] });

export function createEasyNpcMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easynpc", version: "0.1.0" });

  server.registerTool("workspace_info", { title: "Workspace info", description: "Map, clock, places, activities and NPCs (id, names, home, entries, quests) plus the source format. Call this first.", inputSchema: {} }, async () => text({ name: "easynpc", ...(await workspaceSummary(root)), format: FORMAT_CHEATSHEET }));

  server.registerTool(
    "get_schedule",
    { title: "Get schedule", description: "One NPC's day: every entry with route length, walking minutes and arrival time. night=true uses the night-only entries (forced night).", inputSchema: { npc: IdSchema, day: z.number().int().optional(), night: z.boolean().optional() } },
    async ({ npc, day, night }) => {
      try {
        return text(npcDay(await loadWorldStrict(root), npc, day ?? 0, night ?? false));
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "where_at",
    { title: "Where is everyone", description: "Every NPC at (day, time): tile position, facing, walking or doing an activity, place, indoors. night: omit to follow the clock.", inputSchema: { day: z.number().int().optional(), at: TimeSchema.optional(), night: z.boolean().optional() } },
    async ({ day, at, night }) => {
      try {
        return text(whereAt(await loadWorldStrict(root), day ?? 0, parseTime(at, 480), night));
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "find_path",
    { title: "Find path", description: "A* route between two place ids or tiles written x,y.", inputSchema: { from: z.string().min(1), to: z.string().min(1) } },
    async ({ from, to }) => {
      try {
        return text(pathBetween(await loadWorldStrict(root), from, to));
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "set_entry",
    { title: "Set schedule entry", description: "Add or replace one schedule entry (same time, days and when). The whole workspace is validated before writing; dryRun only validates.", inputSchema: { npc: IdSchema, entry: EntrySchema, dryRun: z.boolean().optional() } },
    async ({ npc, entry, dryRun }) => {
      try {
        const r = await setEntry(root, npc, entry, { dryRun });
        return r.errors.length ? err(JSON.stringify(r.errors)) : text({ ok: r.saved, file: r.file, warnings: r.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_npc",
    {
      title: "Write NPC",
      description: "Add or replace a whole NPC (see workspace_info format). Validated with the workspace (places, times, halal gifts for Malay-Muslim NPCs, routes); dryRun only validates.",
      inputSchema: {
        npc: z.object({
          id: IdSchema,
          name: NameSchema,
          sprite: IdSchema,
          culture: z.enum(["thai", "malay", "chinese", "rural", "other"]).optional(),
          role: NameSchema.optional(),
          speed: z.number().positive().optional(),
          home: IdSchema,
          color: z.string().optional(),
          schedule: z.array(EntrySchema).min(1),
          affinity: z.object({ start: z.number().optional(), max: z.number().optional(), talk: z.number().optional(), gifts: z.object({ loved: z.array(z.string()).optional(), liked: z.array(z.string()).optional(), disliked: z.array(z.string()).optional() }).optional(), levels: z.array(z.object({ at: z.number(), name: NameSchema, dialogue: RefSchema.optional() })).optional() }).optional(),
          dialogue: RefSchema.optional(),
          quests: z.array(z.object({ quest: IdSchema, minAffinity: z.number().optional(), from: TimeSchema.optional(), to: TimeSchema.optional() })).optional(),
        }),
        doc: IdSchema.optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ npc, doc, dryRun }) => {
      try {
        const r = await upsertNpc(root, npc, { doc, dryRun });
        return r.errors.length ? err(JSON.stringify(r.errors)) : text({ ok: r.saved, file: r.file, warnings: r.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "simulate_bond",
    { title: "Simulate affinity", description: "Talk to an NPC once a day for N days (optionally giving the same gift): points, level, which dialogue opens, which quests become available.", inputSchema: { npc: IdSchema, days: z.number().int().min(1).max(60).optional(), gift: z.string().optional(), at: TimeSchema.optional() } },
    async ({ npc, days, gift, at }) => {
      try {
        return text(simulateBond(await loadWorldStrict(root), npc, Array.from({ length: days ?? 7 }, (_, d) => ({ day: d, time: at, gift }))));
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool("check_npcs", { title: "Check", description: "Validate schedules, places, routes, halal gifts and the Easy Dialogue (.ezd) / Easy Quest (.ezq) references.", inputSchema: {} }, async () => text(await checkWorkspace(root)));

  server.registerTool(
    "render_map",
    { title: "Render", description: "PNG of the map with every NPC where the schedule puts it at (day, time) — walking routes dotted — or the timeline of everyone's day (what=timeline).", inputSchema: { what: z.enum(["map", "timeline"]).optional(), day: z.number().int().optional(), at: TimeSchema.optional(), night: z.boolean().optional(), scale: z.number().int().min(1).max(3).optional() } },
    async ({ what, day, at, night, scale }) => {
      try {
        const world = await loadWorldStrict(root);
        if (what === "timeline") {
          const t = timelineRaster(world, day ?? 0, night).scaled(scale ?? 1);
          return png(encodePng(t.width, t.height, t.data), { npcs: world.npcs.map((n) => ({ id: n.id, color: n.color })) });
        }
        const m = parseTime(at, 480);
        return png(await renderMapPng(root, world, day ?? 0, m, { night, scale: scale ?? 1 }), whereAt(world, day ?? 0, m, night).npcs.map((s) => ({ id: s.id, place: s.place, activity: s.activity, moving: s.moving, indoors: s.indoors })));
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_npcs",
    { title: "Export", description: "Write exports/easynpc-<preset>/: godot (NPCs autoload, EasyNpcWorld node, demo, parity test), pixi (runtime + demo), png (map at 4 times + timelines), json (world file), all.", inputSchema: { preset: z.enum(EXPORT_PRESETS).optional() } },
    async ({ preset }) => {
      try {
        const r = await exportNpcs(root, { preset: preset ?? "all" });
        return text({ dirs: r.dirs, files: r.files.length, npcs: r.npcs, routes: r.routes, warnings: r.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

if (isEntry() >= 0) {
  const a = parseMcpArgs(process.argv.slice(isEntry() + 1), 8959);
  if (a.http) await startHttp(() => createEasyNpcMcp(a.workspace), a.workspace, a.host, a.port);
  else await createEasyNpcMcp(a.workspace).connect(new StdioServerTransport());
}
