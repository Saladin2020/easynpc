# Easy NPC (studio tool)

Install: `/workspace/indie-studio/tools/easynpc` (detached at `<SHA>`). Wrapper: `node /workspace/indie-studio/tools/easynpc-cli.mjs`.
Always pass `--workspace /workspace/indie-studio/projects/<Name>/npcs-src` and absolute `--out` paths.

| Command | |
|---|---|
| `init` | sample village: 10 NPCs, 18 places, map + renders, sprites, .ezd, .ezq |
| `where --day 4 --at 12:45` | everyone at a time |
| `schedule <npc> --day N [--night]` | one NPC's day with walk times |
| `set-entry <npc> HH:MM <place> <activity> [--days …] [--when night] [--indoors] [--dry-run]` | edit |
| `bond <npc> --days 7 --gift kurma` | affinity simulation |
| `check` | validation + Easy Dialogue / Easy Quest cross-check |
| `render map\|timeline --out /abs/x.png` | PNG |
| `export --preset godot\|pixi\|png\|json --out /abs/dir` | engine export |

MCP: `node tools/easynpc/dist/mcp/server.js --workspace …` (stdio) or `--http --port 8959`.
Godot: autoload `res://easynpc/easynpc.gd` as `NPCs`; `godot --headless --path <export> --script res://test_npc.gd` → `OK`.
