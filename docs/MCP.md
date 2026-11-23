# Easy NPC MCP server

```bash
npx tsx src/mcp/server.ts --workspace ~/my-village              # stdio
npx tsx src/mcp/server.ts --http --port 8959 --workspace …       # Streamable HTTP on 127.0.0.1:8959/mcp
```

| Tool | |
|---|---|
| `workspace_info` | map, clock, places, activities, NPCs + the format cheat sheet. Call first. |
| `get_schedule` | `{ npc, day?, night? }` → entries with route tiles, walk minutes and arrival |
| `where_at` | `{ day?, at?, night? }` → every NPC's tile, facing, walking / activity, place, indoors |
| `find_path` | `{ from, to }` place ids or `x,y` → A* route |
| `set_entry` | `{ npc, entry, dryRun? }` add / replace one entry (validated with the whole workspace) |
| `write_npc` | `{ npc, doc?, dryRun? }` add / replace a whole NPC |
| `simulate_bond` | `{ npc, days?, gift?, at? }` → points, level, dialogue, quests per day |
| `check_npcs` | errors / warnings, including `.ezd` and `.ezq` cross-references |
| `render_map` | `{ what: map \| timeline, day?, at?, night?, scale? }` → PNG |
| `export_npcs` | `{ preset? }` godot · pixi · png · json · all |

Writes stay inside the workspace (`EASYNPC_ALLOWED_DIRS` adds folders). Over HTTP the same local-only guard as the
web API applies (loopback Host, token off loopback).
