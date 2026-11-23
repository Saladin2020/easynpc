extends SceneTree
## Frame capture for previews (needs a renderer, e.g. xvfb-run … --rendering-driver opengl3):
##   godot --path <export> --script res://capture.gd -- day=4 t=07:00 minutes=60 frames=60 out=/tmp/npc-frames [night=1] [lang=th]
## Advances the clock `minutes` game minutes over `frames` frames and saves every frame.

var _args := {}
var _frame := 0
var _saved := 0


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	DirAccess.make_dir_recursive_absolute(_args.get("out", "/tmp/easynpc-frames"))
	await process_frame
	var npcs = get_root().get_node("NPCs")
	npcs.running = false
	npcs.lang = _args.get("lang", "th")
	if _args.has("night"):
		npcs.forced_night = true
	var main = load("res://main.tscn").instantiate()
	get_root().add_child(main)
	await process_frame
	npcs.running = false
	npcs.set_time(int(_args.get("day", "4")), float(EasyNpcEngine.to_minutes(_args.get("t", "07:00"))))


func _process(_delta: float) -> bool:
	_frame += 1
	var frames := int(_args.get("frames", "60"))
	var npcs = get_root().get_node("NPCs")
	if _frame > 3:
		npcs.advance(float(_args.get("minutes", "60")) / frames)
		var img := get_root().get_texture().get_image()
		img.save_png("%s/frame_%04d.png" % [_args.get("out", "/tmp/easynpc-frames"), _saved])
		_saved += 1
	if _saved >= frames:
		print("saved %d frames" % _saved)
		return true
	return false
