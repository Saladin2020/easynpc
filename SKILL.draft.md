---
name: easynpc-village-schedules
description: >-
  Use when a game needs villagers with daily routines: NPC schedules by time, weekday and day/night that walk A*
  routes on an Easy Tilemap map, indoors hiding, affinity (talk / gifts / levels) that opens Easy Dialogue nodes and
  Easy Quest quests, exported as a Godot 4.3+ NPCs autoload or a PixiJS v8 runtime. Not for combat AI or
  free-roaming crowd simulation.
---
# Easy NPC village schedules

Read `/workspace/indie-studio/tools/EASYNPC.md` for paths and commands; format: `…/tools/easynpc/docs/FORMAT.md`.

## Steps

1. **Map.** Export the map with Easy Tilemap (`export --preset pixi`) and copy `<map>.tilemap.json` into `maps/`;
   render `<map>.png` and `<map>_night.png` with `--no-characters --scale 1`.
2. **Places + NPCs.** `init` for the sample, then edit `npcs/*.easynpc.json` (or MCP `write_npc` / `set_entry`,
   `dryRun` first). Sprite ids are Easy Sprite top-down sheets in `characters/`.
3. **Check.** `check` must print 0 errors (dialogue nodes, `@char` ids and quest givers must match).
4. **Look.** `where --day 4 --at 12:45`, `render map --day 4 --at 07:30 --out shot.png`, `render timeline`.
5. **Export.** `export --preset godot` (run `test_npc.gd` headless → `OK`) or `--preset pixi`.

## Rules

- Thai names in Thai script; Malay-Muslim NPCs' gifts halal; no sacred figures as NPCs; no adhan or recitation audio.
- Ask before any push or merge.
