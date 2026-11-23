class_name EasyNpcWorld
extends Node2D
## Draws the Easy Tilemap render (day / night) and every NPC from the NPCs autoload. MIT.
## Add it to your map scene; set show_map = false when your own TileMap already draws the ground.

@export var show_map := true
@export var show_labels := true
## Append the current activity to the name label.
@export var show_activity := false
@export var night_tint := Color(0.59, 0.63, 0.84)

const FACINGS := ["front", "right", "back", "left"]
const WALK := [1, 2, 3, 2]

var _bg: Sprite2D
var _day_tex: Texture2D
var _night_tex: Texture2D
var _actors := {}
var _font: Font


func _ready() -> void:
	var npcs = get_node("/root/NPCs")
	var w: Dictionary = npcs.world
	_font = load("res://easynpc/fonts/Kanit-Regular.ttf") if ResourceLoader.exists("res://easynpc/fonts/Kanit-Regular.ttf") else ThemeDB.fallback_font
	_day_tex = _tex("res://easynpc/maps/%s.png" % w.map.id)
	_night_tex = _tex("res://easynpc/maps/%s_night.png" % w.map.id)
	if _night_tex == null:
		_night_tex = _day_tex
	_bg = Sprite2D.new()
	_bg.centered = false
	_bg.texture = _day_tex
	_bg.visible = show_map and _day_tex != null
	_bg.z_index = -1
	add_child(_bg)
	y_sort_enabled = true
	for n in w.npcs:
		var a := Node2D.new()
		a.y_sort_enabled = false
		var shadow := Polygon2D.new()
		var pts := PackedVector2Array()
		for i in 12:
			pts.append(Vector2(cos(TAU * i / 12.0) * 7, sin(TAU * i / 12.0) * 2.5 - 2))
		shadow.polygon = pts
		shadow.color = Color(0, 0, 0, 0.35)
		a.add_child(shadow)
		var sp := Sprite2D.new()
		var sheet := _tex("res://easynpc/characters/%s.png" % n.sprite)
		if sheet:
			sp.texture = sheet
			sp.region_enabled = true
			sp.region_rect = Rect2(0, 0, 48, 48)
			sp.offset = Vector2(0, -22)
		a.add_child(sp)
		var lb := Label.new()
		lb.add_theme_font_override("font", _font)
		lb.add_theme_font_size_override("font_size", 10)
		lb.add_theme_color_override("font_color", Color("f7ebd3"))
		lb.add_theme_color_override("font_outline_color", Color("1e150e"))
		lb.add_theme_constant_override("outline_size", 4)
		lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lb.size = Vector2(140, 14)
		lb.position = Vector2(-70, -60)
		lb.visible = show_labels
		a.add_child(lb)
		add_child(a)
		_actors[n.id] = {"node": a, "sprite": sp, "label": lb, "sheet": sheet != null}
	npcs.time_changed.connect(func(_d, _m): _refresh())
	_refresh()


func _tex(path: String) -> Texture2D:
	if ResourceLoader.exists(path):
		return load(path)
	if FileAccess.file_exists(path):
		return ImageTexture.create_from_image(Image.load_from_file(path))
	return null


func _refresh() -> void:
	var npcs = get_node("/root/NPCs")
	var w: Dictionary = npcs.world
	var ts := float(w.map.tileSize)
	var night: bool = npcs.is_night()
	if _bg.texture != null:
		_bg.texture = _night_tex if night else _day_tex
	for s in npcs.states():
		var a: Dictionary = _actors[s.id]
		var node: Node2D = a.node
		node.visible = not s.indoors
		node.position = Vector2(round(s.x * ts + ts / 2), round(s.y * ts + ts))
		var sp: Sprite2D = a.sprite
		if a.sheet:
			var col: int = WALK[int(floor(s.progress * 2)) % 4] if s.moving else 0
			sp.region_rect = Rect2(col * 48, max(0, FACINGS.find(s.facing)) * 48, 48, 48)
		sp.modulate = night_tint if night else Color.WHITE
		var label: Label = a.label
		label.visible = show_labels
		label.text = npcs.npc_name(s.id) + ("" if s.moving or not show_activity else " · " + npcs.activity_name(s.activity))
