class_name EasyNpcEngine
extends RefCounted
## Easy NPC engine — a line-by-line port of src/shared/engine.ts (parity-tested by test_npc.gd). MIT.
## `world` is the parsed easynpc.world.json: { map, clock, places, npcs, activities, routes }.
## `night` arguments: null = follow the clock, true/false = forced.

const WEEKDAYS := ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const DIRS := [[0, 1], [1, 0], [0, -1], [-1, 0]]
const GIFT_POINTS := {"loved": 8, "liked": 4, "neutral": 1, "disliked": -4}
const NON_HALAL_TAGS := ["pork", "alcohol", "non_halal"]
const WEATHERS := ["clear", "cloudy", "rain", "storm", "wind", "fog"]
const FOG_LIFTS := 660


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
static func entry_matches(e: Dictionary, wd: String, night: bool, w := "clear") -> bool:
	if e.has("days") and e.days != null and not (e.days as Array).has(wd):
		return false
	if e.get("weather") != null and not (e.weather as Array).has(w):
		return false
	if e.get("notWeather") != null and (e.notWeather as Array).has(w):
		return false
	var when: String = e.get("when", "any") if e.get("when") != null else "any"
	return when == "any" or (when == "night") == night


static func day_list(world: Dictionary, npc: Dictionary, day: int, night: bool) -> Array:
	var wd := weekday(world.clock, day)
	var w := weather_on(world, day) if world.get("calendar") != null else "clear"
	var out: Array = []
	var sched: Array = npc.schedule
	for i in sched.size():
		var e: Dictionary = sched[i]
		if entry_matches(e, wd, night, w):
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
	return {"points": int(aff.get("start", 0)), "lastTalk": -1, "lastGift": -1, "seen": []}


static func _aff(npc: Dictionary) -> Dictionary:
	return npc.get("affinity", {}) if npc.get("affinity") != null else {}


static func _clamp(npc: Dictionary, p: int) -> int:
	return clampi(p, 0, int(_aff(npc).get("max", 100)))


static func keeps_halal(npc: Dictionary) -> bool:
	var h = _aff(npc).get("halal")
	return bool(h) if h != null else npc.get("culture") == "malay"


static func gift_kind(npc: Dictionary, item: String, tags := []) -> String:
	var g: Dictionary = _aff(npc).get("gifts", {})
	if g.has("refuse") and (g.refuse as Array).has(item):
		return "refused"
	if keeps_halal(npc):
		for t in tags:
			if NON_HALAL_TAGS.has(t):
				return "refused"
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


static func gift(npc: Dictionary, b: Dictionary, item: String, day: int, tags := []) -> Dictionary:
	var kind := gift_kind(npc, item, tags)
	if kind == "refused" or int(b.lastGift) == day:
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


# ------------------------------------------------------------------ hearts (relationships)
static func hearts(npc: Dictionary, points: int) -> int:
	return int(floor(points / float(max(1, int(_aff(npc).get("heartSize", 10))))))


static func heart_event_due(npc: Dictionary, b: Dictionary) -> Variant:
	var h := hearts(npc, int(b.points))
	var seen: Array = b.get("seen", [])
	var evs: Array = (_aff(npc).get("heartEvents", []) as Array).duplicate()
	evs.sort_custom(func(a, c): return int(a.hearts) < int(c.hearts))
	for e in evs:
		if int(e.hearts) <= h and not seen.has(e.id):
			return e
	return null


static func mark_heart_event(b: Dictionary, id: String) -> void:
	var seen: Array = b.get("seen", [])
	if not seen.has(id):
		seen.append(id)
	b.seen = seen


# ------------------------------------------------------------------ calendar + weather (parity with calendar.ts)
static func _cal(world: Dictionary) -> Dictionary:
	return world.calendar


static func _season_days(cal: Dictionary, i: int) -> int:
	var s: Dictionary = cal.seasons[i]
	return int(s.get("days", cal.daysPerSeason)) if s.get("days") != null else int(cal.daysPerSeason)


static func year_length(cal: Dictionary) -> int:
	var n := 0
	for i in (cal.seasons as Array).size():
		n += _season_days(cal, i)
	return n


static func date(world: Dictionary, day: int) -> Dictionary:
	var cal := _cal(world)
	var length: int = max(1, year_length(cal))
	var d: int = max(0, day)
	var doy := d % length
	var day_of_year := doy
	var si := 0
	while si < (cal.seasons as Array).size() - 1 and doy >= _season_days(cal, si):
		doy -= _season_days(cal, si)
		si += 1
	return {"day": d, "year": int(cal.startYear) + d / length, "season": cal.seasons[si].id, "seasonIndex": si, "dayOfSeason": doy + 1, "week": doy / 7 + 1, "weekday": weekday(world.clock, d), "dayOfYear": day_of_year}


static func events_on(world: Dictionary, day: int, minute = null) -> Array:
	var dt := date(world, day)
	var out: Array = []
	for e in _cal(world).events:
		if e.get("season") != null and e.season != dt.season:
			continue
		if e.get("day") != null and int(e.day) != int(dt.dayOfSeason):
			continue
		if e.get("weekday") != null and e.weekday != dt.weekday:
			continue
		if minute != null:
			var m := (int(floor(minute)) % 1440 + 1440) % 1440
			var a := to_minutes(e.from) if e.get("from") != null else 0
			var z := to_minutes(e.to) if e.get("to") != null else 1440
			if m < a or m >= z:
				continue
		out.append(e)
	return out


static func _i32(v: int) -> int:
	v = v & 0xFFFFFFFF
	return v - 0x100000000 if v >= 0x80000000 else v


static func _imul(a: int, b: int) -> int:
	a = a & 0xFFFFFFFF
	b = b & 0xFFFFFFFF
	var lo := (a & 0xFFFF) * b
	var hi := ((a >> 16) * b) & 0xFFFF
	return _i32(lo + (hi << 16))


static func hash01(seed: int, day: int, salt: int) -> float:
	var h := _i32(_imul(seed, 374761393) + _imul(day, 668265263) + _imul(salt, 2246822519))
	h = _imul(h ^ ((h & 0xFFFFFFFF) >> 13), 1274126177)
	h = h ^ ((h & 0xFFFFFFFF) >> 16)
	return float(h & 0xFFFFFFFF) / 4294967296.0


static func _base_weather(cal: Dictionary, si: int, day: int) -> String:
	var w: Dictionary = cal.seasons[si].get("weather", {"clear": 1}) if cal.seasons[si].get("weather") != null else {"clear": 1}
	var total := 0.0
	for k in WEATHERS:
		total += max(0.0, float(w.get(k, 0)))
	if total <= 0.0:
		return "clear"
	var r := hash01(int(cal.weatherSeed), day, 1) * total
	for k in WEATHERS:
		r -= max(0.0, float(w.get(k, 0)))
		if r < 0.0:
			return k
	return "clear"


static func weather_on(world: Dictionary, day: int) -> String:
	var cal := _cal(world)
	var d: int = max(0, day)
	var si: int = date(world, d).seasonIndex
	if d > 0 and hash01(int(cal.weatherSeed), d, 2) < float(cal.persistence) and int(date(world, d - 1).seasonIndex) == si:
		return _base_weather(cal, si, d - 1)
	return _base_weather(cal, si, d)


static func weather_at(world: Dictionary, day: int, minute: float) -> String:
	var w := weather_on(world, day)
	var m := (int(floor(minute)) % 1440 + 1440) % 1440
	return "cloudy" if w == "fog" and m >= FOG_LIFTS else w


# ------------------------------------------------------------------ town life (parity with townlife.ts)
const LIGHT_PHASES := ["late_night", "dawn", "morning", "noon", "afternoon", "sunset", "evening", "night"]
const PHASE_FROM := {"late_night": "23:00", "dawn": "05:00", "morning": "06:30", "noon": "11:00", "afternoon": "14:00", "sunset": "17:00", "evening": "18:30", "night": "20:00"}
const DEFAULT_LIGHT_KEYS := [
	{"at": "00:00", "tint": "#46508c", "dark": 0.6, "lamps": 1.0}, {"at": "04:30", "tint": "#46508c", "dark": 0.6, "lamps": 1.0},
	{"at": "05:30", "tint": "#9078aa", "dark": 0.42, "lamps": 0.8}, {"at": "06:30", "tint": "#ffb08c", "dark": 0.18, "lamps": 0.3},
	{"at": "07:30", "tint": "#ffe2c4", "dark": 0.04, "lamps": 0.0}, {"at": "10:00", "tint": "#fff6e8", "dark": 0.0, "lamps": 0.0},
	{"at": "12:00", "tint": "#ffffff", "dark": 0.0, "lamps": 0.0}, {"at": "15:00", "tint": "#fff4dc", "dark": 0.0, "lamps": 0.0},
	{"at": "17:15", "tint": "#ffbe82", "dark": 0.08, "lamps": 0.1}, {"at": "18:15", "tint": "#fa8c64", "dark": 0.2, "lamps": 0.5},
	{"at": "19:00", "tint": "#aa6ea0", "dark": 0.36, "lamps": 0.9}, {"at": "20:30", "tint": "#6064b4", "dark": 0.52, "lamps": 1.0},
	{"at": "23:00", "tint": "#464e96", "dark": 0.6, "lamps": 1.0},
]
const DEFAULT_FLOOD := {"rise": {"rain": 0.22, "storm": 0.45}, "drain": 0.18, "window": 8}
const FLOOD_STAGES := ["dry", "puddles", "ankle", "knee", "waist"]
const FLOOD_AT := {"dry": 0.0, "puddles": 0.15, "ankle": 0.35, "knee": 0.6, "waist": 0.85}
const FLOOD_WALK := {"dry": 1.0, "puddles": 0.95, "ankle": 0.8, "knee": 0.6, "waist": 0.45}


static func _wrap(minute: float) -> int:
	return (int(floor(minute)) % 1440 + 1440) % 1440


static func _r3(v: float) -> float:
	return floor(v * 1000.0 + 0.5) / 1000.0


static func fmt_hhmm(minute: float) -> String:
	var m := _wrap(minute)
	return "%02d:%02d" % [m / 60, m % 60]


static func phase_at(minute: float) -> String:
	var m := _wrap(minute)
	var best := "late_night"
	var best_at := -1
	for p in LIGHT_PHASES:
		var a := to_minutes(PHASE_FROM[p])
		if a <= m and a > best_at:
			best = p
			best_at = a
	return best


static func lighting(world: Dictionary, minute: float) -> Dictionary:
	var src: Array = world.lighting.keys if world.get("lighting") != null else DEFAULT_LIGHT_KEYS
	var keys: Array = []
	for k in src:
		var km := to_minutes(k.at)
		if km >= 0:
			keys.append({"m": km, "tint": Color.html(k.tint), "dark": float(k.dark), "lamps": float(k.lamps)})
	keys.sort_custom(func(x, y): return x.m < y.m)
	var m: float = minute - floor(minute / 1440.0) * 1440.0
	var a: Dictionary = keys[keys.size() - 1]
	var b: Dictionary = keys[0]
	var am: float = a.m - 1440
	var bm: float = b.m
	for i in keys.size():
		if keys[i].m <= m:
			a = keys[i]
			am = a.m
			b = keys[(i + 1) % keys.size()]
			bm = b.m if i + 1 < keys.size() else b.m + 1440
	var span := bm - am
	var raw := (m - am) / span if span > 0 else 0.0
	var t := raw * raw * (3.0 - 2.0 * raw)
	var ca := [a.tint.r8, a.tint.g8, a.tint.b8]
	var cb := [b.tint.r8, b.tint.g8, b.tint.b8]
	var tint := []
	for i in 3:
		tint.append(int(floor(ca[i] + (cb[i] - ca[i]) * t + 0.5)))
	return {"phase": phase_at(minute), "tint": tint, "tintHex": (tint[0] << 16) | (tint[1] << 8) | tint[2], "dark": _r3(a.dark + (b.dark - a.dark) * t), "lamps": _r3(a.lamps + (b.lamps - a.lamps) * t)}


static func parse_hours(h: String) -> Array:
	var parts := h.replace(" ", "").split("-")
	if parts.size() != 2:
		return []
	var a := to_minutes(parts[0])
	var b := to_minutes(parts[1])
	return [] if a < 0 or b < 0 else [a, b]


static func shop_status(world: Dictionary, id: String, day: int, minute: float, flood := 0.0) -> Dictionary:
	var shops: Dictionary = world.get("shops", {}) if world.get("shops") != null else {}
	var s = shops.get(id)
	var hrs: Array = parse_hours(String(s.hours)) if s != null else []
	if s == null or hrs.is_empty():
		return {"open": false, "reason": "unknown", "opensAt": null, "closesAt": null}
	var a: int = hrs[0]
	var b: int = hrs[1]
	var m := _wrap(minute)
	var in_hours: bool = (m >= a and m < b) if a < b else (m >= a or m < b)
	var opens := fmt_hhmm(a)
	var closes := fmt_hhmm(b)
	if s.get("closedOn") != null and (s.closedOn as Array).has(date(world, day).weekday):
		return {"open": false, "reason": "closed_day", "opensAt": opens, "closesAt": closes}
	if s.get("event") != null:
		var found := false
		for e in events_on(world, day):
			if e.id == s.event:
				found = true
		if not found:
			return {"open": false, "reason": "event", "opensAt": opens, "closesAt": closes}
	var close_at: float = float(s.floodClose) if s.get("floodClose") != null else (0.35 if s.get("kind") == "stall" else 0.6)
	if flood >= close_at:
		return {"open": false, "reason": "flood", "opensAt": opens, "closesAt": closes}
	return {"open": in_hours, "reason": "open" if in_hours else "hours", "opensAt": opens, "closesAt": closes}


static func disruption(kind: String, w: String, flood: float) -> Dictionary:
	if kind == "train":
		if flood >= 0.85:
			return {"delay": 0, "cancelled": true}
		return {"delay": 30 if flood >= 0.6 else (10 if flood >= 0.35 else 0), "cancelled": false}
	return {"delay": 45 if w == "storm" else (20 if w == "fog" else 0), "cancelled": false}


static func departures(world: Dictionary, station: String, day: int, minute: float, kind := "", n := 8) -> Array:
	var out: Array = []
	var now: float = day * 1440 + minute
	var lines: Array = world.transit.lines if world.get("transit") != null else []
	for d in [day, day + 1]:
		var wd: String = date(world, d).weekday
		var fl := flood_level(world, d)
		var we := weather_on(world, d) if world.get("calendar") != null else "clear"
		for l in lines:
			if l.from != station or (kind != "" and l.kind != kind) or (l.get("days") != null and not (l.days as Array).has(wd)):
				continue
			var dis := disruption(l.kind, we, fl)
			for t in l.departs:
				var base := to_minutes(t)
				if base < 0:
					continue
				var at: int = d * 1440 + base + int(dis.delay)
				if at < now:
					continue
				var board: int = int(l.board) if l.get("board") != null else 15
				var status := "cancelled" if dis.cancelled else ("boarding" if now >= at - board else ("delayed" if int(dis.delay) > 0 else "scheduled"))
				out.append({"line": l.id, "kind": l.kind, "from": l.from, "to": l.to, "day": d, "depart": fmt_hhmm(base), "at": at, "arrive": at + int(l.minutes), "delay": int(dis.delay), "status": status, "fare": int(l.fare) if l.get("fare") != null else 0})
	out.sort_custom(func(x, y): return x.at < y.at or (x.at == y.at and String(x.line) < String(y.line)))
	return out.slice(0, n)


static func service_at(world: Dictionary, station: String, day: int, minute: float, kind := "") -> Variant:
	for d in departures(world, station, day, minute, kind, 4):
		if d.status == "boarding":
			return d
	return null


static func _flood_after(world: Dictionary, day: int) -> float:
	if world.get("calendar") == null or day < 0:
		return 0.0
	var f: Dictionary = world.flood if world.get("flood") != null else DEFAULT_FLOOD
	var level := 0.0
	for d in range(max(0, day - int(f.window) + 1), day + 1):
		level = min(1.0, max(0.0, level - float(f.drain)) + float(f.rise.get(weather_on(world, d), 0.0)))
	return level


static func flood_level(world: Dictionary, day: int, minute := 1440.0) -> float:
	var prev := _flood_after(world, day - 1)
	var cur := _flood_after(world, day)
	var t: float = min(1.0, max(0.0, minute / 720.0))
	return _r3(prev + (cur - prev) * t)


static func flood_stage(level: float) -> String:
	var s := "dry"
	for k in FLOOD_STAGES:
		if level >= FLOOD_AT[k]:
			s = k
	return s


static func flood_effects(level: float) -> Dictionary:
	var stage := flood_stage(level)
	return {"stage": stage, "walk": FLOOD_WALK[stage], "npcsIndoors": level >= 0.6, "stallsClosed": level >= 0.35, "trainsCancelled": level >= 0.85}
