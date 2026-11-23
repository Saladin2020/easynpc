class_name EasyNpcEngine
extends RefCounted
## Easy NPC engine — a line-by-line port of src/shared/engine.ts (parity-tested by test_npc.gd). MIT.
## `world` is the parsed easynpc.world.json: { map, clock, places, npcs, activities, routes }.
## `night` arguments: null = follow the clock, true/false = forced.

const WEEKDAYS := ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const DIRS := [[0, 1], [1, 0], [0, -1], [-1, 0]]
const GIFT_POINTS := {"loved": 8, "liked": 4, "neutral": 1, "disliked": -4}


static func to_minutes(hhmm: String) -> int:
	var p := hhmm.split(":")
	if p.size() != 2 or not p[0].is_valid_int() or not p[1].is_valid_int() or p[1].length() != 2:
		return -1
	var h := int(p[0])
	var m := int(p[1])
	if h > 23 or m > 59 or h < 0 or m < 0:
		return -1
	return h * 60 + m


static func fmt_time(minute: float) -> String:
	var m := posmod(int(floor(minute)), 1440)
	return "%02d:%02d" % [m / 60, m % 60]


static func weekday(clock: Dictionary, day: int) -> String:
	return WEEKDAYS[posmod(WEEKDAYS.find(clock.get("firstWeekday", "mon")) + day, 7)]


static func is_night(clock: Dictionary, minute: float) -> bool:
	var m := fposmod(minute, 1440.0)
	var a := to_minutes(clock.get("dayStart", "06:00"))
	var b := to_minutes(clock.get("nightStart", "19:00"))
	if a < b:
		return m < a or m >= b
	return m >= b and m < a


# ------------------------------------------------------------------ grid + A*
static func walkable(map: Dictionary, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= int(map.width) or y >= int(map.height):
		return false
	return String(map.collision[y])[x] != "#"


static func nearest_walkable(map: Dictionary, x: int, y: int) -> Variant:
	if walkable(map, x, y):
		return [x, y]
	var w := int(map.width)
	var h := int(map.height)
	var seen := {y * w + x: true}
	var q: Array = [[x, y]]
	var i := 0
	while i < q.size():
		var c: Array = q[i]
		i += 1
		for d in DIRS:
			var nx: int = c[0] + d[0]
			var ny: int = c[1] + d[1]
			if nx < 0 or ny < 0 or nx >= w or ny >= h:
				continue
			var k := ny * w + nx
			if seen.has(k):
				continue
			seen[k] = true
			if walkable(map, nx, ny):
				return [nx, ny]
			q.append([nx, ny])
	return null


## 4-way A*, Manhattan; ties: lowest f, then lowest h, then first pushed (same as the TypeScript engine).
static func find_path(map: Dictionary, from: Array, to: Array) -> Array:
	var W := int(map.width)
	var sx := int(from[0])
	var sy := int(from[1])
	var gx := int(to[0])
	var gy := int(to[1])
	if not walkable(map, sx, sy) or not walkable(map, gx, gy):
		return []
	if sx == gx and sy == gy:
		return [[sx, sy]]
	var g := {sy * W + sx: 0}
	var came := {}
	var closed := {}
	var h0: int = abs(sx - gx) + abs(sy - gy)
	var open: Array = [[h0, h0, 0, sy * W + sx]]
	var seq := 1
	while open.size() > 0:
		var bi := 0
		for i in range(1, open.size()):
			var a: Array = open[i]
			var b: Array = open[bi]
			if a[0] < b[0] or (a[0] == b[0] and (a[1] < b[1] or (a[1] == b[1] and a[2] < b[2]))):
				bi = i
		var key: int = open[bi][3]
		open.remove_at(bi)
		if closed.has(key):
			continue
		closed[key] = true
		var cx := key % W
		var cy := key / W
		if cx == gx and cy == gy:
			var path: Array = []
			var k = key
			while k != null:
				path.append([k % W, k / W])
				k = came.get(k)
			path.reverse()
			return path
		var cg: int = g[key]
		for d in DIRS:
			var nx: int = cx + d[0]
			var ny: int = cy + d[1]
			if not walkable(map, nx, ny):
				continue
			var nk := ny * W + nx
			if closed.has(nk):
				continue
			var ng := cg + 1
			if not g.has(nk) or ng < g[nk]:
				g[nk] = ng
				came[nk] = key
				var nh: int = abs(nx - gx) + abs(ny - gy)
				open.append([ng + nh, nh, seq, nk])
				seq += 1
	return []


# ------------------------------------------------------------------ schedules
static func entry_matches(e: Dictionary, wd: String, night: bool) -> bool:
	if e.has("days") and e.days != null and not (e.days as Array).has(wd):
		return false
	var when: String = e.get("when", "any") if e.get("when") != null else "any"
	return when == "any" or (when == "night") == night


static func day_list(world: Dictionary, npc: Dictionary, day: int, night: bool) -> Array:
	var wd := weekday(world.clock, day)
	var out: Array = []
	var sched: Array = npc.schedule
	for i in sched.size():
		var e: Dictionary = sched[i]
		if entry_matches(e, wd, night):
			out.append({"e": e, "i": i, "t": to_minutes(e.at)})
	out.sort_custom(func(a, b): return a.t < b.t or (a.t == b.t and a.i < b.i))
	return out


static func _night(world: Dictionary, minute: float, night) -> bool:
	return is_night(world.clock, minute) if night == null else bool(night)


static func active_entry(world: Dictionary, npc: Dictionary, day: int, minute: float, night = null) -> Variant:
	var n := _night(world, minute, night)
	var m := fposmod(minute, 1440.0)
	var today := day_list(world, npc, day, n)
	var started: Array = []
	for x in today:
		if x.t <= m:
			started.append(x)
	if started.size() > 0:
		var cur: Dictionary = started[started.size() - 1]
		var prev: String
		if started.size() > 1:
			prev = started[started.size() - 2].e.place
		else:
			var yl := day_list(world, npc, day - 1, n)
			prev = yl[yl.size() - 1].e.place if yl.size() > 0 else npc.home
		return {"entry": cur.e, "index": cur.i, "start": cur.t, "from": prev, "elapsed": m - cur.t}
	var y := day_list(world, npc, day - 1, n)
	if y.size() == 0:
		return null
	var c: Dictionary = y[y.size() - 1]
	var p: String = (y[y.size() - 2] if y.size() > 1 else c).e.place
	return {"entry": c.e, "index": c.i, "start": c.t, "from": p, "elapsed": m + 1440 - c.t}


static func place_tile(world: Dictionary, id: String) -> Variant:
	if not world.places.has(id):
		return null
	var p: Dictionary = world.places[id]
	return nearest_walkable(world.map, int(p.x), int(p.y))


static func route(world: Dictionary, from: String, to: String) -> Array:
	var routes: Dictionary = world.get("routes", {}) if world.get("routes") != null else {}
	var key := "%s>%s" % [from, to]
	if routes.has(key):
		return routes[key]
	var a = place_tile(world, from)
	var b = place_tile(world, to)
	if a == null or b == null:
		return []
	var p := find_path(world.map, a, b)
	routes[key] = p
	world["routes"] = routes
	return p


static func find_npc(world: Dictionary, id: String) -> Variant:
	for n in world.npcs:
		if n.id == id:
			return n
	return null


static func _facing_of(dx: float, dy: float) -> String:
	if abs(dx) >= abs(dy):
		return "right" if dx > 0 else ("left" if dx < 0 else "front")
	return "front" if dy > 0 else "back"


static func _place_facing(world: Dictionary, entry: Dictionary) -> Variant:
	if entry.get("facing") != null:
		return entry.facing
	var p = world.places.get(entry.place)
	if p != null and p.get("facing") != null:
		return p.facing
	return null


static func state(world: Dictionary, id: String, day: int, minute: float, night = null) -> Variant:
	var npc = find_npc(world, id)
	if npc == null:
		return null
	var n := _night(world, minute, night)
	var act = active_entry(world, npc, day, minute, n)
	var home = place_tile(world, npc.home)
	if home == null:
		home = [0, 0]
	if act == null:
		return {"id": id, "x": float(home[0]), "y": float(home[1]), "facing": "front", "moving": false, "activity": "idle", "place": npc.home, "indoors": false, "night": n, "entry": -1, "progress": 0.0, "route_length": 0}
	var e: Dictionary = act.entry
	var path := route(world, act.from, e.place)
	var speed := float(npc.get("speed", world.clock.speed) if npc.get("speed") != null else world.clock.speed)
	var length: int = max(0, path.size() - 1)
	var walked: float = act.elapsed * speed
	var indoors := bool(e.get("indoors", false))
	if path.size() == 0:
		var t = place_tile(world, e.place)
		if t == null:
			t = home
		var f0 = _place_facing(world, e)
		return {"id": id, "x": float(t[0]), "y": float(t[1]), "facing": f0 if f0 != null else "front", "moving": false, "activity": e.activity, "place": e.place, "indoors": indoors, "night": n, "entry": act.index, "progress": 0.0, "route_length": 0}
	if walked >= length:
		var end: Array = path[path.size() - 1]
		var last: Array = path[path.size() - 2] if path.size() > 1 else path[0]
		var face = _place_facing(world, e)
		if face == null:
			face = _facing_of(end[0] - last[0], end[1] - last[1]) if path.size() > 1 else "front"
		return {"id": id, "x": float(end[0]), "y": float(end[1]), "facing": face, "moving": false, "activity": e.activity, "place": e.place, "indoors": indoors, "night": n, "entry": act.index, "progress": float(length), "route_length": length}
	var i := int(floor(walked))
	var fr := walked - i
	var a: Array = path[i]
	var b: Array = path[i + 1]
	return {"id": id, "x": a[0] + (b[0] - a[0]) * fr, "y": a[1] + (b[1] - a[1]) * fr, "facing": _facing_of(b[0] - a[0], b[1] - a[1]), "moving": true, "activity": "walk", "place": e.place, "indoors": false, "night": n, "entry": act.index, "progress": walked, "route_length": length}


static func states(world: Dictionary, day: int, minute: float, night = null) -> Array:
	var out: Array = []
	for npc in world.npcs:
		out.append(state(world, npc.id, day, minute, night))
	return out


# ------------------------------------------------------------------ affinity
static func new_bond(npc: Dictionary) -> Dictionary:
	var aff: Dictionary = npc.get("affinity", {}) if npc.get("affinity") != null else {}
	return {"points": int(aff.get("start", 0)), "lastTalk": -1, "lastGift": -1}


static func _aff(npc: Dictionary) -> Dictionary:
	return npc.get("affinity", {}) if npc.get("affinity") != null else {}


static func _clamp(npc: Dictionary, p: int) -> int:
	return clampi(p, 0, int(_aff(npc).get("max", 100)))


static func gift_kind(npc: Dictionary, item: String) -> String:
	var g: Dictionary = _aff(npc).get("gifts", {})
	for k in ["loved", "liked", "disliked"]:
		if g.has(k) and (g[k] as Array).has(item):
			return k
	return "neutral"


static func talk(npc: Dictionary, b: Dictionary, day: int) -> int:
	if int(b.lastTalk) == day:
		return 0
	b.lastTalk = day
	var before := int(b.points)
	b.points = _clamp(npc, before + int(_aff(npc).get("talk", 1)))
	return int(b.points) - before


static func gift(npc: Dictionary, b: Dictionary, item: String, day: int) -> Dictionary:
	var kind := gift_kind(npc, item)
	if int(b.lastGift) == day:
		return {"kind": kind, "delta": 0}
	b.lastGift = day
	var before := int(b.points)
	b.points = _clamp(npc, before + GIFT_POINTS[kind])
	return {"kind": kind, "delta": int(b.points) - before}


static func level(npc: Dictionary, points: int) -> Dictionary:
	var lv: Array = (_aff(npc).get("levels", []) as Array).duplicate()
	lv.sort_custom(func(a, b): return a.at < b.at)
	var idx := -1
	for i in lv.size():
		if points >= int(lv[i].at):
			idx = i
	if idx < 0:
		return {"index": -1, "at": 0, "name": null, "dialogue": null}
	return {"index": idx, "at": int(lv[idx].at), "name": lv[idx].name, "dialogue": lv[idx].get("dialogue")}


static func dialogue_for(world: Dictionary, npc: Dictionary, b: Dictionary, day: int, minute: float, night = null) -> Variant:
	var act = active_entry(world, npc, day, minute, night)
	var st = state(world, npc.id, day, minute, night)
	if act != null and act.entry.get("dialogue") != null and st != null and not st.moving:
		return act.entry.dialogue
	var lv := level(npc, int(b.points))
	if lv.dialogue != null:
		return lv.dialogue
	return npc.get("dialogue")


static func quests_for(npc: Dictionary, b: Dictionary, minute: float) -> Array:
	var m := fposmod(minute, 1440.0)
	var out: Array = []
	var qs: Array = npc.get("quests", []) if npc.get("quests") != null else []
	for q in qs:
		if int(b.points) < int(q.get("minAffinity", 0)):
			continue
		var a := to_minutes(q.from) if q.get("from") != null else 0
		var z := to_minutes(q.to) if q.get("to") != null else 1440
		var ok := (m >= a and m < z) if a <= z else (m >= a or m < z)
		if ok:
			out.append(q.quest)
	return out


static func nearest(world: Dictionary, day: int, minute: float, x: float, y: float, radius := 1.5, night = null) -> Variant:
	var best = null
	var bd := INF
	for s in states(world, day, minute, night):
		if s.indoors:
			continue
		var d := Vector2(s.x - x, s.y - y).length()
		if d <= radius and d < bd:
			bd = d
			best = s
	return best
