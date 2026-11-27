extends Node
## Easy NPC autoload ("NPCs"). MIT.
## Runs the game clock, keeps affinity bonds, and answers "where is everyone / what do they say".
##   NPCs.state("fatimah")            → {x, y (tiles), facing, moving, activity, place, indoors, night, …}
##   NPCs.talk("fatimah")             → {dialogue: {dialogue, node}, delta, quests}
##   NPCs.gift("fatimah", "kurma")    → {kind, delta}
##   NPCs.to_dict() / from_dict(d)    → Easy Save (clock + bonds; schedules are stateless)

signal time_changed(day: int, minute: float)
signal night_changed(night: bool)
signal arrived(id: String, place: String, activity: String)
signal talked(id: String, dialogue, delta: int)
signal gifted(id: String, item: String, kind: String, delta: int)
signal level_up(id: String, level: Dictionary)
signal day_changed(day: int, date: Dictionary, weather: String, events: Array)
signal weather_changed(weather: String)
signal heart_event(id: String, event: Dictionary)

const Engine2 := preload("res://easynpc/npc_engine.gd")

var world: Dictionary = {}
var day := 0
var minute := 420.0
var running := true
## Extra multiplier on top of clock.secondsPerMinute (1 = normal).
var time_scale := 1.0
## null = follow the clock; true/false = forced (weather, cutscenes, the N key in the demo).
var forced_night = null
var bonds := {}
var lang := "th"
var _last_night := false
var _moving := {}
var _last_day := -999999
var _last_weather := ""


func _ready() -> void:
	if world.is_empty() and FileAccess.file_exists("res://easynpc/easynpc.world.json"):
		load_world("res://easynpc/easynpc.world.json")


func load_world(path: String) -> void:
	world = JSON.parse_string(FileAccess.get_file_as_string(path))
	bonds = {}
	for n in world.npcs:
		bonds[n.id] = Engine2.new_bond(n)
	minute = float(Engine2.to_minutes(world.clock.get("dayStart", "06:00")))
	_last_night = is_night()


func _process(delta: float) -> void:
	if not running or world.is_empty():
		return
	advance(delta * time_scale / max(0.001, float(world.clock.get("secondsPerMinute", 1))))


## Move the clock forward by game minutes (also used by sleep / skip).
func advance(minutes: float) -> void:
	set_time(day, minute + minutes)


func set_time(d: int, m: float) -> void:
	while m >= 1440.0:
		m -= 1440.0
		d += 1
	while m < 0.0:
		m += 1440.0
		d -= 1
	day = d
	minute = m
	time_changed.emit(day, minute)
	if world.has("calendar"):
		if day != _last_day:
			_last_day = day
			day_changed.emit(day, date_info(), weather(), events_today())
		var w := weather()
		if w != _last_weather:
			_last_weather = w
			weather_changed.emit(w)
	var n := is_night()
	if n != _last_night:
		_last_night = n
		night_changed.emit(n)
	for npc in world.npcs:
		var s = state(npc.id)
		if _moving.get(npc.id, false) and not s.moving:
			arrived.emit(npc.id, s.place, s.activity)
		_moving[npc.id] = s.moving


func set_night(v) -> void:
	forced_night = v
	set_time(day, minute)


func is_night() -> bool:
	return Engine2.is_night(world.clock, minute) if forced_night == null else bool(forced_night)


func weekday() -> String:
	return Engine2.weekday(world.clock, day)


func time_text() -> String:
	return Engine2.fmt_time(minute)


func npc(id: String) -> Variant:
	return Engine2.find_npc(world, id)


func npc_name(id: String) -> String:
	var n = npc(id)
	return "" if n == null else str(n.name.get(lang, n.name.en))


func activity_name(activity: String) -> String:
	var a = world.get("activities", {}).get(activity)
	return activity if a == null else str(a.get(lang, a.en))


func state(id: String) -> Variant:
	return Engine2.state(world, id, day, minute, forced_night)


func states() -> Array:
	return Engine2.states(world, day, minute, forced_night)


func nearest(tile_x: float, tile_y: float, radius := 1.5) -> Variant:
	return Engine2.nearest(world, day, minute, tile_x, tile_y, radius, forced_night)


func dialogue_for(id: String) -> Variant:
	var n = npc(id)
	return null if n == null else Engine2.dialogue_for(world, n, bonds[id], day, minute, forced_night)


func quests_for(id: String) -> Array:
	var n = npc(id)
	return [] if n == null else Engine2.quests_for(n, bonds[id], minute)


func level(id: String) -> Dictionary:
	return Engine2.level(npc(id), int(bonds[id].points))


func talk(id: String) -> Dictionary:
	var n = npc(id)
	if n == null:
		return {}
	var before: int = level(id).index
	var delta := Engine2.talk(n, bonds[id], day)
	var ref = dialogue_for(id)
	talked.emit(id, ref, delta)
	_quest_event("talk_%s" % id)
	_check_level(id, before)
	_check_heart(id)
	return {"dialogue": ref, "delta": delta, "quests": quests_for(id)}


## Calendar + weather (needs world.calendar; Easy NPC fills defaults).
func date_info() -> Dictionary:
	return Engine2.date(world, day)


func weather() -> String:
	return Engine2.weather_at(world, day, minute) if world.has("calendar") else "clear"


func events_today(now := false) -> Array:
	return Engine2.events_on(world, day, minute if now else null) if world.has("calendar") else []


func forecast(days := 7) -> Array:
	var out := []
	for i in days:
		out.append({"day": day + i, "weather": Engine2.weather_on(world, day + i)})
	return out


func hearts(id: String) -> int:
	var n = npc(id)
	return 0 if n == null else Engine2.hearts(n, int(bonds[id].points))


## Marks the due heart event seen and returns it (or null). Play its dialogue / start its quest.
func take_heart_event(id: String) -> Variant:
	var n = npc(id)
	if n == null:
		return null
	var e = Engine2.heart_event_due(n, bonds[id])
	if e != null:
		Engine2.mark_heart_event(bonds[id], e.id)
	return e


func _check_heart(id: String) -> void:
	var n = npc(id)
	var e = null if n == null else Engine2.heart_event_due(n, bonds[id])
	if e != null:
		heart_event.emit(id, e)


func gift(id: String, item: String, tags := []) -> Dictionary:
	var n = npc(id)
	if n == null:
		return {}
	var before: int = level(id).index
	var r := Engine2.gift(n, bonds[id], item, day, tags)
	gifted.emit(id, item, r.kind, r.delta)
	if r.delta != 0 or r.kind != "neutral":
		_quest_event("gift_%s" % id)
		_quest_event("gift_%s_%s" % [id, item])
	_check_level(id, before)
	_check_heart(id)
	return r


func _check_level(id: String, before: int) -> void:
	var lv := level(id)
	if lv.index > before:
		level_up.emit(id, lv)
		var qm = get_node_or_null("/root/QuestManager")
		if qm and qm.has_method("set_flag"):
			qm.set_flag("npc_%s_level_%d" % [id, lv.index], true)


func _quest_event(ev: String) -> void:
	var qm = get_node_or_null("/root/QuestManager")
	if qm and qm.has_method("emit_event"):
		qm.emit_event(ev)


func to_dict() -> Dictionary:
	return {"day": day, "minute": minute, "bonds": bonds.duplicate(true), "forced_night": forced_night}


func from_dict(d: Dictionary) -> void:
	for k in d.get("bonds", {}):
		bonds[k] = d.bonds[k]
	forced_night = d.get("forced_night")
	set_time(int(d.get("day", 0)), float(d.get("minute", 420)))
