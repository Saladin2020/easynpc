# `easynpc/1` format

Every `npcs/*.easynpc.json` in a workspace merges into one world (later documents add places, activities and NPCs;
`map` and `clock` may appear once).

```jsonc
{
  "format": "easynpc/1",
  "id": "village",
  "map": "maps/multicultural_village.tilemap.json",   // Easy Tilemap export (needs collision rows)
  "clock": {
    "dayStart": "06:00", "nightStart": "19:00",       // night = nightStart → dayStart
    "secondsPerMinute": 0.5,                          // real seconds per game minute (runtimes)
    "speed": 3,                                       // default walking speed, tiles per game minute
    "firstWeekday": "mon"                             // weekday of game day 0
  },
  "places": {
    "mosque": { "x": 29, "y": 9, "name": { "th": "มัสยิด", "en": "Mosque", "ms": "Masjid" }, "facing": "back" }
  },
  "activities": { "pray": { "th": "ไปมัสยิด", "en": "At the mosque", "ms": "Ke masjid" } },
  "npcs": [ { /* see below */ } ]
}
```

Places are tiles; a blocked tile is snapped to the nearest walkable one (with a warning). Map renders
`maps/<map id>.png` and `maps/<map id>_night.png` are drawn behind the NPCs (render them with
`easytilemap render <map> --no-characters --scale 1 [--night]`).

## NPC

| Field | |
|---|---|
| `id` | a-z 0-9 _ - · matches the `.ezd` `@char` id and the `.ezq` `giver` |
| `name` | `{ th, en, ms? }` — Thai in Thai script |
| `sprite` | `characters/<sprite>.png`, an Easy Sprite top-down sheet (48 px frames; rows front, right, back, left; walk columns 1 2 3 2) |
| `culture` | `thai · malay · chinese · rural · other` (malay → gifts must be halal) |
| `role` | `{ th, en, ms? }` |
| `home` | place id (used before the first entry ever) |
| `speed` | tiles per game minute (default `clock.speed`) |
| `color` | timeline / marker colour |
| `schedule` | entries, below |
| `affinity` | `{ start, max, talk, gifts: { loved, liked, disliked }, levels: [{ at, name, dialogue? }] }` |
| `dialogue` | `{ dialogue, node? }` default Easy Dialogue script |
| `quests` | `[{ quest, minAffinity?, from?, to? }]` Easy Quest quest ids |

## Schedule entry

| Field | |
|---|---|
| `at` | `"HH:MM"` — leave for `place` at this time |
| `place` | place id |
| `activity` | activity id (`walk` is used while moving) |
| `days` | `["mon", …]` only on these weekdays |
| `when` | `any` (default) · `day` · `night` |
| `facing` | `front · right · back · left` once arrived (default: the place's, else the walking direction) |
| `indoors` | hidden while there |
| `dialogue` | `{ dialogue, node? }` while doing this |

The entry in force at (day, minute) is the latest matching entry that has started, else yesterday's last. The NPC
walks from the place of the entry before it. Equal times keep file order.

## World file (`easynpc.world.json`, exports)

`{ format: "easynpc-world/1", version, map: { id, width, height, tileSize, collision }, clock, places, npcs,
activities, routes: { "from>to": [[x, y], …] } }`
