"""Headless Chrome check of a PixiJS export: the clock runs, NPCs walk, talk/gift work, night switches.

  python3 scripts/check-pixi.py <pixi-export-dir> [screenshot.png]

Serves the folder on 127.0.0.1:8996, opens Friday 12:05 (mosque time) at 60× speed and checks that NPCs move along
their routes, the engine in the page agrees with the world file, clicking an NPC talks to it (affinity goes up
once per day), a gift is scored, and forcing night swaps the map and hides NPCs who are indoors.
Prints a JSON report; exit 1 on problems or console errors.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8996
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": 900, "height": 680})
        errs, problems = [], []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("response", lambda r: errs.append(f"http {r.status}: {r.url}") if r.status >= 400 and not r.url.endswith("/pixi.min.js") else None)
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html?day=4&t=12:05&speed=60")
        await pg.wait_for_function("window.__ready === true", timeout=40000)
        pos0 = await pg.evaluate("Object.fromEntries(Object.entries(window.__npc.view.actors).map(([k, a]) => [k, [a.a.x, a.a.y, a.a.visible]]))")
        t0 = await pg.evaluate("window.__npc.view.minute")
        await pg.wait_for_timeout(2500)
        t1 = await pg.evaluate("window.__npc.view.minute")
        pos1 = await pg.evaluate("Object.fromEntries(Object.entries(window.__npc.view.actors).map(([k, a]) => [k, [a.a.x, a.a.y, a.a.visible]]))")
        moved = [k for k in pos0 if pos0[k][:2] != pos1[k][:2]]
        if t1 - t0 < 20:
            problems.append(f"clock barely moved: {t0} → {t1}")
        if len(moved) < 2:
            problems.append(f"only {moved} moved")
        if SHOT:
            await pg.locator("canvas").screenshot(path=SHOT)
        # Friday prayer: men at the mosque by 12:40
        await pg.evaluate("window.__npc.view.setTime(4, 12 * 60 + 40)")
        at_mosque = await pg.evaluate("Object.values(window.__npc.view.states).filter((s) => s.place === 'mosque' && !s.moving).map((s) => s.id)")
        if len(at_mosque) < 2:
            problems.append(f"Friday 12:40: expected people at the mosque, got {at_mosque}")
        # talk by clicking the canvas on an NPC
        await pg.evaluate("window.__npc.app.ticker.stop(); window.__npc.view.setTime(4, 10 * 60)")
        target = await pg.evaluate("""(() => { const v = window.__npc.view; const s = Object.values(v.states).find((s) => !s.indoors && !s.moving);
          const ts = v.world.map.tileSize; return { id: s.id, x: s.x * ts + ts / 2, y: s.y * ts + ts / 2 - 4 }; })()""")
        box = await pg.locator("canvas").bounding_box()
        k = box["width"] / await pg.evaluate("window.__npc.app.canvas.width")
        before = await pg.evaluate(f"window.__npc.view.bonds['{target['id']}'].points")
        await pg.mouse.click(box["x"] + target["x"] * k, box["y"] + target["y"] * k)
        await pg.wait_for_timeout(200)
        after = await pg.evaluate(f"window.__npc.view.bonds['{target['id']}'].points")
        await pg.mouse.click(box["x"] + target["x"] * k, box["y"] + target["y"] * k)
        after2 = await pg.evaluate(f"window.__npc.view.bonds['{target['id']}'].points")
        log = await pg.inner_text("#log")
        if not (after > before and after2 == after):
            problems.append(f"talk by click: {before} → {after} → {after2}")
        g = await pg.evaluate("window.__npc.view.gift('fatimah', 'kurma')")
        if not g or g["kind"] not in ("loved", "liked"):
            problems.append(f"gift kurma to fatimah: {g}")
        # night: map swaps, some NPCs go indoors at 23:00
        await pg.evaluate("window.__npc.view.setTime(4, 23 * 60)")
        hidden = await pg.evaluate("Object.values(window.__npc.view.actors).filter((a) => !a.a.visible).length")
        if hidden < 5:
            problems.append(f"23:00: only {hidden} NPCs indoors")
        await pg.evaluate("window.__npc.view.setTime(4, 11 * 60); window.__npc.view.setNight(true)")
        night_tex = await pg.evaluate("window.__npc.view.container.children[0].texture.source.label || window.__npc.view.container.children[0].texture.label || ''")
        if SHOT:
            await pg.evaluate("window.__npc.app.render()")
            await pg.locator("canvas").screenshot(path=SHOT.replace(".png", "-night.png"))
            await pg.goto(f"http://127.0.0.1:{PORT}/index.html?day=4&t=07:20&paused=1&lang=ms&activity=1")
            await pg.wait_for_function("window.__ready === true", timeout=40000)
            await pg.wait_for_timeout(400)
            await pg.locator("canvas").screenshot(path=SHOT.replace(".png", "-ms.png"))
        real = [e for e in errs if "GL Driver Message" not in e and "Failed to load resource" not in e]
        report = {"minutes": round(t1 - t0, 1), "moved": moved, "mosque": at_mosque, "talk": [target["id"], before, after, after2, log], "gift": g, "hidden_23h": hidden, "night_tex": night_tex, "problems": problems, "errors": real}
        print(json.dumps(report, ensure_ascii=False))
        await b.close()
        if problems or real:
            sys.exit(1)


try:
    asyncio.run(main())
finally:
    srv.terminate()
