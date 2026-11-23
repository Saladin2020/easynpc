extends SceneTree
## Headless checks:  godot --headless --path <export> --script res://test_npc.gd
## 1. parity: schedule states, A* paths and affinity against the TypeScript engine (parity.json)
## 2. autoload: the NPCs clock, arrive / talk / gift signals and save round-trip

var fails := 0


func _fail(msg: String) -> void:
	fails += 1
	if fails <= 15:
		printerr("FAIL ", msg)


func _init() -> void:
	await process_frame
	var world: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://easynpc/easynpc.world.json"))
	var par: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://easynpc/parity.json"))
	# 1a. states
	var n_states := 0
	for c in par.states:
		var s: Dictionary = EasyNpcEngine.state(world, c.id, int(c.day), float(c.minute), c.get("night"))
		n_states += 1
		var ok: bool = abs(s.x - c.x) < 0.001 and abs(s.y - c.y) < 0.001 and s.facing == c.facing and s.moving == c.moving and s.activity == c.activity and s.place == c.place and s.indoors == c.indoors and int(s.entry) == int(c.entry)
		if not ok:
			_fail("state %s day %d %s: got %s want %s" % [c.id, c.day, EasyNpcEngine.fmt_time(c.minute), JSON.stringify(s), JSON.stringify(c)])
	print("S|states %d" % n_states)
	# 1b. A* without the precomputed routes
	for p in par.paths:
		var got := EasyNpcEngine.find_path(world.map, p.from, p.to)
		var parts: Array = []
		for t in got:
			parts.append("%d,%d" % [int(t[0]), int(t[1])])
		if " ".join(parts) != p.path:
			_fail("path %s→%s" % [str(p.from), str(p.to)])
	print("P|paths %d" % par.paths.size())
	# 1c. precomputed routes match runtime A*
	var checked := 0
	for key in world.routes:
		var ab: PackedStringArray = key.split(">")
		var a = EasyNpcEngine.place_tile(world, ab[0])
		var b = EasyNpcEngine.place_tile(world, ab[1])
		var got2 := EasyNpcEngine.find_path(world.map, a, b)
		if got2.size() != world.routes[key].size():
			_fail("route %s length %d vs %d" % [key, got2.size(), world.routes[key].size()])
		checked += 1
	print("R|routes %d" % checked)
	# 1d. affinity
	for bd in par.bonds:
		var npc = EasyNpcEngine.find_npc(world, bd.id)
		var b := EasyNpcEngine.new_bond(npc)
		var log: Array = []
		for d in 6:
			log.append(["talk", d, EasyNpcEngine.talk(npc, b, d)])
			log.append(["talk", d, EasyNpcEngine.talk(npc, b, d)])
			var items: Array = []
			var g: Dictionary = npc.affinity.get("gifts", {})
			items.append_array(g.get("loved", []))
			items.append_array(g.get("disliked", []))
			items.append("rice")
			var it: String = items[d % items.size()]
			var r := EasyNpcEngine.gift(npc, b, it, d)
			log.append(["gift", d, it, r.kind, r.delta])
			log.append(["level", EasyNpcEngine.level(npc, int(b.points)).index, "+".join(EasyNpcEngine.quests_for(npc, b, 600 + d * 120))])
		if JSON.stringify(log) != JSON.stringify(_ints(bd.log)) or int(b.points) != int(bd.points):
			_fail("bond %s: %s vs %s" % [bd.id, JSON.stringify(log), JSON.stringify(bd.log)])
	print("B|bonds %d" % par.bonds.size())
	# 2. autoload
	var npcs = get_root().get_node("NPCs")
	npcs.running = false
	var arrivals := []
	npcs.arrived.connect(func(id, place, _a): arrivals.append("%s@%s" % [id, place]))
	npcs.set_time(4, 6 * 60.0)
	for i in 120:
		npcs.advance(1.0)
	if arrivals.size() < 3:
		_fail("expected arrivals between 06:00 and 08:00, got %s" % str(arrivals))
	var first: String = npcs.world.npcs[0].id
	var t1: Dictionary = npcs.talk(first)
	var t2: Dictionary = npcs.talk(first)
	if t1.delta <= 0 or t2.delta != 0:
		_fail("talk once per day: %s %s" % [t1.delta, t2.delta])
	var saved: Dictionary = npcs.to_dict()
	npcs.from_dict(JSON.parse_string(JSON.stringify(saved)))
	if int(npcs.bonds[first].points) != int(saved.bonds[first].points) or npcs.day != 4:
		_fail("save round-trip")
	print("A|arrivals %d" % arrivals.size())
	print("OK" if fails == 0 else "FAILED %d" % fails)
	quit(0 if fails == 0 else 1)


func _ints(v):
	if v is float and v == floor(v):
		return int(v)
	if v is Array:
		var o: Array = []
		for x in v:
			o.append(_ints(x))
		return o
	return v
