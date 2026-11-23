extends Node2D
## Easy NPC demo: the village with the clock running.
## N = force night on/off · [ / ] = slower / faster · T = talk to the NPC nearest the mouse · Space = pause

var _hud: Label
var _log: Label


func _ready() -> void:
	var world := EasyNpcWorld.new()
	add_child(world)
	var font: Font = load("res://easynpc/fonts/Kanit-Regular.ttf")
	var hud := CanvasLayer.new()
	add_child(hud)
	var bar := ColorRect.new()
	bar.color = Color(0.08, 0.05, 0.04, 0.75)
	bar.size = Vector2(get_viewport_rect().size.x, 18)
	hud.add_child(bar)
	_hud = Label.new()
	_hud.add_theme_font_override("font", font)
	_hud.add_theme_font_size_override("font_size", 12)
	_hud.position = Vector2(6, 0)
	hud.add_child(_hud)
	_log = Label.new()
	_log.add_theme_font_override("font", font)
	_log.add_theme_font_size_override("font_size", 12)
	_log.position = Vector2(260, 0)
	hud.add_child(_log)
	NPCs.time_scale = 10.0
	NPCs.set_time(4, 7 * 60.0)
	NPCs.talked.connect(func(id, ref, delta):
		_log.text = "%s → %s%s" % [NPCs.npc_name(id), "-" if ref == null else str(ref.dialogue) + ("#" + str(ref.node) if ref.get("node") != null else ""), "  +%d" % delta if delta else ""])


func _process(_d: float) -> void:
	var days := {"mon": "จันทร์", "tue": "อังคาร", "wed": "พุธ", "thu": "พฤหัสฯ", "fri": "ศุกร์", "sat": "เสาร์", "sun": "อาทิตย์"}
	_hud.text = "%s · วันที่ %d · %s%s · ×%d" % [days[NPCs.weekday()], NPCs.day, NPCs.time_text(), " ☾" if NPCs.is_night() else "", int(NPCs.time_scale)]


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed:
		match e.keycode:
			KEY_N:
				NPCs.set_night(null if NPCs.forced_night == true else true)
			KEY_BRACKETLEFT:
				NPCs.time_scale = max(1.0, NPCs.time_scale / 2)
			KEY_BRACKETRIGHT:
				NPCs.time_scale = min(240.0, NPCs.time_scale * 2)
			KEY_SPACE:
				NPCs.running = not NPCs.running
			KEY_T:
				var ts := float(NPCs.world.map.tileSize)
				var m := get_global_mouse_position() / ts - Vector2(0.5, 0.5)
				var s = NPCs.nearest(m.x, m.y, 2.0)
				if s != null:
					NPCs.talk(s.id)
