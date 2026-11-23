import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasyNpcMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasyNpcMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});
const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

describe("MCP server", () => {
  it("lists the tools", async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("info → schedule → where → path → set entry → write npc → bond → check → render → export", async () => {
    const info = body(await call("workspace_info"));
    expect(info.npcs.length).toBe(10);
    expect(info.format).toMatch(/halal/);
    const plan = body(await call("get_schedule", { npc: "kakna", day: 4 }));
    expect(plan.entries[0].activity).toBeTruthy();
    const where = body(await call("where_at", { day: 4, at: "12:45" }));
    expect(where.npcs.filter((s: { place: string }) => s.place === "mosque").length).toBeGreaterThan(1);
    expect(body(await call("find_path", { from: "temple", to: "boats" })).reachable).toBe(true);
    const bad = await call("set_entry", { npc: "adam", entry: { at: "17:00", place: "moon", activity: "play" } });
    expect(bad.isError).toBe(true);
    expect(body(await call("set_entry", { npc: "adam", entry: { at: "17:00", place: "beach", activity: "play", days: ["sun"] } })).ok).toBe(true);
    const npc = { id: "somchai", name: { th: "ลุงสมชาย", en: "Uncle Somchai", ms: "Pak Cik Somchai" }, sprite: "town_farmer", culture: "thai", home: "house_ton", schedule: [{ at: "06:00", place: "market", activity: "shop" }, { at: "09:00", place: "house_ton", activity: "home", indoors: true }] };
    const w = body(await call("write_npc", { npc }));
    expect(w.ok).toBe(true);
    const b = body(await call("simulate_bond", { npc: "fatimah", days: 3, gift: "kurma" }));
    expect(b.steps.length).toBe(3);
    expect(body(await call("check_npcs")).errors).toEqual([]);
    for (const what of ["map", "timeline"]) {
      const r = await call("render_map", { what, day: 4, at: "08:00" });
      expect((r.content as Array<{ type: string }>)[0]!.type).toBe("image");
    }
    const exp = body(await call("export_npcs", { preset: "json" }));
    expect(exp.npcs).toBe(11);
  }, 60_000);
});

describe("web API", () => {
  it("serves where / schedule / renders and guards writes", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent", dev: true, host: "127.0.0.1" });
    const h = { host: "127.0.0.1:8958" };
    const ws = (await (await app.request("http://127.0.0.1/api/workspace", { headers: h })).json()) as { npcs: unknown[] };
    expect(ws.npcs.length).toBeGreaterThanOrEqual(10);
    const where = (await (await app.request("http://127.0.0.1/api/where?day=4&at=12:45", { headers: h })).json()) as { weekday: string };
    expect(where.weekday).toBe("fri");
    const png = await app.request("http://127.0.0.1/api/render/map.png?day=0&at=08:00", { headers: h });
    expect(png.headers.get("content-type")).toBe("image/png");
    const sheet = await app.request("http://127.0.0.1/api/sprite/town_monk.png", { headers: h });
    expect(sheet.status).toBe(200);
    const evil = await app.request("http://127.0.0.1/api/entry", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(evil.status).toBe(403);
    const trav = await app.request("http://127.0.0.1/api/sprite/..%2F..%2Fetc%2Fpasswd", { headers: h });
    expect(trav.status).toBeGreaterThanOrEqual(400);
  });
});
