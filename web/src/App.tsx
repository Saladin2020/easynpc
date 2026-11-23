import { useCallback, useEffect, useMemo, useState } from "react";
import { get, post, type DayPlan, type Diag, type Summary, type Where } from "./api";

const TABS = ["map", "schedules", "timeline", "bond", "documents", "check"] as const;
type Tab = (typeof TABS)[number];
const TAB_TH: Record<Tab, string> = { map: "หมู่บ้าน", schedules: "ตารางเวลา", timeline: "ไทม์ไลน์", bond: "ความสนิท", documents: "ไฟล์", check: "ตรวจ" };
const DAY_TH: Record<string, string> = { mon: "จันทร์", tue: "อังคาร", wed: "พุธ", thu: "พฤหัสฯ", fri: "ศุกร์", sat: "เสาร์", sun: "อาทิตย์" };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function App() {
  const [ws, setWs] = useState<Summary | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState("fatimah");
  const [day, setDay] = useState(4);
  const [minute, setMinute] = useState(7 * 60 + 30);
  const [night, setNight] = useState("auto");
  const reload = useCallback(() => get<Summary>("/api/workspace").then(setWs).catch((e: Error) => setStatus(e.message)), []);
  useEffect(() => void reload(), [reload]);
  if (!ws) return <div className="loading">Loading… {status}</div>;
  const placeName = (id: string) => ws.places.find((p) => p.id === id)?.th ?? id;
  const actName = (id: string) => ws.activities[id]?.th ?? (id === "walk" ? "กำลังเดิน" : id);
  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <h1 className="brand">Easy <span>NPC</span></h1>
            <p className="brand-th">ตารางชีวิตชาวบ้าน · {ws.npcs.length} NPCs · {ws.places.length} places · {ws.map ? `${ws.map.id} ${ws.map.width}×${ws.map.height}` : "no map"}</p>
          </div>
        </div>
        <div className="status">{status || ws.root}</div>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)} data-tab={t}>{TAB_TH[t]} · {t}</button>
        ))}
      </nav>
      <div className="main">
        <section className="panel">
          {tab === "map" && <MapView day={day} setDay={setDay} minute={minute} setMinute={setMinute} night={night} setNight={setNight} sel={sel} setSel={setSel} placeName={placeName} actName={actName} ws={ws} />}
          {tab === "schedules" && <Schedules ws={ws} sel={sel} setSel={setSel} day={day} setDay={setDay} placeName={placeName} actName={actName} onSaved={(m) => { setStatus(m); reload(); }} />}
          {tab === "timeline" && <Timeline ws={ws} day={day} setDay={setDay} actName={actName} />}
          {tab === "bond" && <Bond ws={ws} sel={sel} setSel={setSel} />}
          {tab === "documents" && <Documents ws={ws} onSaved={(m) => { setStatus(m); reload(); }} />}
          {tab === "check" && <Check />}
        </section>
        <aside className="panel">
          <Side ws={ws} sel={sel} day={day} placeName={placeName} actName={actName} />
          <h3 style={{ marginTop: "1rem" }}>Export</h3>
          <div className="row">
            {["godot", "pixi", "png", "json", "all"].map((p) => (
              <button key={p} onClick={() => post<{ dirs: string[]; files: number }>("/api/export", { preset: p }).then((r) => setStatus(`exported ${r.files} files → ${r.dirs.join(", ")}`)).catch((e: Error) => setStatus(e.message))}>{p}</button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

type MapProps = { ws: Summary; day: number; setDay: (d: number) => void; minute: number; setMinute: (m: number | ((m: number) => number)) => void; night: string; setNight: (n: string) => void; sel: string; setSel: (s: string) => void; placeName: (id: string) => string; actName: (id: string) => string };

function MapView({ ws, day, setDay, minute, setMinute, night, setNight, sel, setSel, placeName, actName }: MapProps) {
  const [play, setPlay] = useState(false);
  const [where, setWhere] = useState<Where | null>(null);
  const q = `day=${day}&at=${hhmm(minute)}&night=${night}`;
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => setMinute((m) => (m + 5) % 1440), 220);
    return () => clearInterval(t);
  }, [play, setMinute]);
  useEffect(() => void get<Where>(`/api/where?${q}`).then(setWhere).catch(() => {}), [q]);
  return (
    <>
      <div className="toolbar">
        <span className="clock">{where ? `${DAY_TH[where.weekday]} ${where.time}${where.night ? " ☾" : ""}` : hhmm(minute)}</span>
        <label>day <input type="number" min={0} value={day} onChange={(e) => setDay(Number(e.target.value))} /></label>
        <input type="range" min={0} max={1435} step={5} value={minute} onChange={(e) => setMinute(Number(e.target.value))} aria-label="time" />
        <select value={night} onChange={(e) => setNight(e.target.value)} aria-label="night">
          <option value="auto">clock</option>
          <option value="0">force day</option>
          <option value="1">force night</option>
        </select>
        <button className={play ? "primary" : ""} onClick={() => setPlay(!play)}>{play ? "❚❚" : "▶"} play</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: "0.6rem", marginTop: "0.6rem" }}>
        <img className="mapimg" src={`/api/render/map.png?${q}&scale=2`} alt="village" />
        <div>
          {where?.npcs.map((s) => {
            const n = ws.npcs.find((x) => x.id === s.id)!;
            return (
              <div key={s.id} className={`who ${sel === s.id ? "on" : ""}`} onClick={() => setSel(s.id)}>
                <i style={{ background: n.color ?? "#f4ae3d" }} />
                <b>{n.th}</b>
                <small>{s.moving ? `→ ${placeName(s.place)} (${Math.floor(s.progress)}/${s.routeLength})` : `${actName(s.activity)} · ${placeName(s.place)}${s.indoors ? " · ในบ้าน" : ""}`}</small>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Schedules({ ws, sel, setSel, day, setDay, placeName, actName, onSaved }: { ws: Summary; sel: string; setSel: (s: string) => void; day: number; setDay: (d: number) => void; placeName: (id: string) => string; actName: (id: string) => string; onSaved: (m: string) => void }) {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [nightList, setNightList] = useState(false);
  const [form, setForm] = useState({ at: "16:00", place: ws.places[0]?.id ?? "", activity: Object.keys(ws.activities)[0] ?? "", days: "", when: "any", indoors: false });
  const [errs, setErrs] = useState<Diag[]>([]);
  const load = useCallback(() => get<DayPlan>(`/api/schedule/${sel}?day=${day}&night=${nightList ? 1 : 0}`).then(setPlan).catch(() => setPlan(null)), [sel, day, nightList]);
  useEffect(() => void load(), [load]);
  const save = async (dryRun: boolean) => {
    const entry = { at: form.at, place: form.place, activity: form.activity, ...(form.days ? { days: form.days.split(",").map((s) => s.trim()) } : {}), ...(form.when !== "any" ? { when: form.when } : {}), ...(form.indoors ? { indoors: true } : {}) };
    const r = await post<{ ok: boolean; errors: Diag[] }>("/api/entry", { npc: sel, entry, dryRun }).catch((e: Error) => ({ ok: false, errors: [{ path: "", message: e.message }] }));
    setErrs(r.errors);
    if (r.ok) {
      onSaved(`saved ${sel} ${form.at}`);
      load();
    } else if (dryRun && !r.errors.length) onSaved("valid (dry run)");
  };
  const remove = async (at: string, days: string[] | null, when: string) => {
    await post("/api/entry/remove", { npc: sel, at, days: days ?? undefined, when }).then(() => { onSaved(`removed ${sel} ${at}`); load(); }).catch((e: Error) => setErrs([{ path: "", message: e.message }]));
  };
  return (
    <>
      <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))" }}>
        {ws.npcs.map((n) => (
          <div key={n.id} className={`card ${sel === n.id ? "on" : ""}`} onClick={() => setSel(n.id)}>
            <div className="npc-sprite" style={{ backgroundImage: `url(/api/sprite/${n.sprite}.png)` }} />
            <b>{n.th}</b> <small>{n.en} · {n.entries} entries</small>
          </div>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: "0.8rem" }}>
        <label>day <input type="number" min={0} value={day} onChange={(e) => setDay(Number(e.target.value))} /></label>
        <span>{plan && DAY_TH[plan.weekday]}</span>
        <label><input type="checkbox" checked={nightList} onChange={(e) => setNightList(e.target.checked)} /> night entries (forced night)</label>
      </div>
      {plan && (
        <table className="grid">
          <thead><tr><th>leave</th><th>arrive</th><th>place</th><th>activity</th><th>walk</th><th>flags</th><th /></tr></thead>
          <tbody>
            {plan.entries.map((e, i) => (
              <tr key={i}>
                <td className="mono">{e.at}</td><td className="mono">{e.arrive}</td><td>{placeName(e.place)}</td><td>{actName(e.activity)}</td>
                <td className="mono">{e.tiles ? `${e.tiles} tiles · ${e.walkMinutes} min` : "-"}</td>
                <td>{e.indoors && <span className="tag">indoors</span>}{e.when !== "any" && <span className="tag">{e.when}</span>}{e.days && <span className="tag">{e.days.join(",")}</span>}{e.dialogue && <span className="tag">💬 {e.dialogue.dialogue}{e.dialogue.node ? `#${e.dialogue.node}` : ""}</span>}</td>
                <td><button onClick={() => remove(e.at, e.days, e.when)} title="remove">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 style={{ marginTop: "1rem" }}>Add / replace entry</h3>
      <div className="row">
        <label>at <input value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} style={{ width: "4.5rem" }} /></label>
        <label>place <select value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })}>{ws.places.map((p) => <option key={p.id} value={p.id}>{p.th}</option>)}</select></label>
        <label>activity <select value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })}>{Object.entries(ws.activities).map(([id, n]) => <option key={id} value={id}>{n.th}</option>)}</select></label>
        <label>days <input value={form.days} placeholder="sat,sun" onChange={(e) => setForm({ ...form, days: e.target.value })} style={{ width: "6rem" }} /></label>
        <label>when <select value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })}>{ws.enums.when.map((w) => <option key={w}>{w}</option>)}</select></label>
        <label><input type="checkbox" checked={form.indoors} onChange={(e) => setForm({ ...form, indoors: e.target.checked })} /> indoors</label>
        <button onClick={() => save(true)}>Check</button>
        <button className="primary" onClick={() => save(false)}>Save</button>
      </div>
      {errs.map((e, i) => <p key={i} className="err">{e.path}: {e.message}</p>)}
    </>
  );
}

function Timeline({ ws, day, setDay, actName }: { ws: Summary; day: number; setDay: (d: number) => void; actName: (id: string) => string }) {
  const colors = ["#f4ae3d", "#79c48a", "#6fb3e0", "#e5806c", "#c58be0", "#d8d2c0", "#5fae6e", "#f0a030", "#b8432f", "#4f8fb0", "#e6c35c", "#8fd0c0", "#c8506a", "#a08a6a", "#7ab0e0", "#e09060", "#90a0e8", "#b0d070"];
  return (
    <>
      <div className="toolbar"><label>day <input type="number" min={0} value={day} onChange={(e) => setDay(Number(e.target.value))} /></label><span className="hint">00:00 → 24:00 · one row per NPC · darker = indoors · cream = walking</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.4rem", marginTop: "0.6rem", alignItems: "start" }}>
        <div style={{ paddingTop: 12 }}>{ws.npcs.map((n) => <div key={n.id} style={{ height: 16, lineHeight: "16px", fontSize: "0.74rem", color: n.color ?? undefined, whiteSpace: "nowrap" }}>{n.th}</div>)}</div>
        <div style={{ overflowX: "auto" }}><img className="mapimg" style={{ maxWidth: "none" }} src={`/api/render/timeline.png?day=${day}&scale=1`} alt="timeline" /></div>
      </div>
      <div className="legend">
        <span><i style={{ background: "#f7ebd3" }} />{actName("walk")}</span>
        {Object.keys(ws.activities).map((a, i) => <span key={a}><i style={{ background: colors[i % colors.length] }} />{actName(a)}</span>)}
      </div>
    </>
  );
}

function Bond({ ws, sel, setSel }: { ws: Summary; sel: string; setSel: (s: string) => void }) {
  const [gift, setGift] = useState("");
  const [days, setDays] = useState(10);
  const [res, setRes] = useState<{ start: number; steps: Array<Record<string, unknown>> } | null>(null);
  const run = () => post<typeof res>("/api/bond", { npc: sel, days, gift: gift || undefined }).then(setRes);
  useEffect(() => void run(), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="row">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>{ws.npcs.map((n) => <option key={n.id} value={n.id}>{n.th} ({n.id})</option>)}</select>
        <label>days <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <label>gift every day <input value={gift} placeholder="Easy Items id (kurma, teh_tarik…)" onChange={(e) => setGift(e.target.value)} /></label>
        <button className="primary" onClick={run}>Simulate</button>
      </div>
      {res && (
        <table className="grid">
          <thead><tr><th>day</th><th>talk</th><th>gift</th><th>points</th><th>level</th><th>dialogue</th><th>quests</th></tr></thead>
          <tbody>
            {res.steps.map((s, i) => {
              const g = s.gift as { kind: string; delta: number } | undefined;
              const d = s.dialogue as { dialogue: string; node?: string } | null;
              return (
                <tr key={i}>
                  <td>{String(s.day)}</td><td>+{String(s.talk)}</td><td>{g ? `${g.kind} ${g.delta >= 0 ? "+" : ""}${g.delta}` : ""}</td>
                  <td><div className="bar" style={{ width: 120 }}><i style={{ width: `${Math.min(100, Number(s.points))}%`, background: "#79c48a" }} /></div>{String(s.points)}</td>
                  <td>{String(s.levelTh ?? s.level ?? "-")}</td><td className="mono">{d ? `${d.dialogue}${d.node ? `#${d.node}` : ""}` : "-"}</td><td>{(s.quests as string[]).join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function Side({ ws, sel, day, placeName, actName }: { ws: Summary; sel: string; day: number; placeName: (id: string) => string; actName: (id: string) => string }) {
  const n = ws.npcs.find((x) => x.id === sel);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  useEffect(() => void get<DayPlan>(`/api/schedule/${sel}?day=${day}`).then(setPlan).catch(() => setPlan(null)), [sel, day, ws]);
  if (!n) return <p className="hint">Pick an NPC.</p>;
  return (
    <>
      <h3>{n.th} <small style={{ textTransform: "none", color: "var(--faint)" }}>{n.en}</small></h3>
      <div className="npc-sprite" style={{ backgroundImage: `url(/api/sprite/${n.sprite}.png)` }} />
      <p className="hint">{n.role} · {n.culture ?? ""} · home {placeName(n.home)} · sprite {n.sprite}</p>
      {n.quests.length > 0 && <p className="hint">quests: {n.quests.join(", ")}</p>}
      {plan?.entries.map((e, i) => <div key={i} className="mono" style={{ fontSize: "0.76rem" }}>{e.at} {actName(e.activity)} · {placeName(e.place)}</div>)}
    </>
  );
}

function Documents({ ws, onSaved }: { ws: Summary; onSaved: (m: string) => void }) {
  const [id, setId] = useState(ws.docs[0] ?? "village");
  const [text, setText] = useState("");
  const [errs, setErrs] = useState<Diag[]>([]);
  useEffect(() => void get<{ doc: unknown }>(`/api/docs/${id}`).then((r) => setText(JSON.stringify(r.doc, null, 2))).catch(() => setText("")), [id]);
  const save = async (dryRun: boolean) => {
    try {
      const r = await post<{ ok: boolean; errors: Diag[] }>(`/api/docs/${id}`, { doc: JSON.parse(text), dryRun });
      setErrs(r.errors);
      if (r.ok) onSaved(`saved ${id}`);
      else if (!r.errors.length) onSaved("valid (dry run)");
    } catch (e) {
      setErrs([{ path: id, message: (e as Error).message }]);
    }
  };
  const lines = useMemo(() => text.split("\n").length, [text]);
  return (
    <>
      <div className="row">
        <select value={id} onChange={(e) => setId(e.target.value)}>{ws.docs.map((d) => <option key={d}>{d}</option>)}</select>
        <span className="hint">npcs/{id}.easynpc.json · {lines} lines</span>
        <button onClick={() => save(true)}>Check</button>
        <button className="primary" onClick={() => save(false)}>Save</button>
      </div>
      <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {errs.map((e, i) => <p key={i} className="err">{e.path}: {e.message}</p>)}
    </>
  );
}

function Check() {
  const [r, setR] = useState<{ errors: Diag[]; warnings: Diag[]; cross: Record<string, number> } | null>(null);
  useEffect(() => void get<typeof r>("/api/check").then(setR), []);
  if (!r) return <p>…</p>;
  return (
    <div className="diag">
      <p className={r.errors.length ? "err" : "ok"}>{r.errors.length} errors · {r.warnings.length} warnings · {Object.entries(r.cross).map(([k, v]) => `${v} ${k}`).join(" · ")}</p>
      {r.errors.map((e, i) => <p key={i} className="err">ERROR {e.path}: {e.message}</p>)}
      {r.warnings.map((e, i) => <p key={i} className="warn">warn {e.path}: {e.message}</p>)}
    </div>
  );
}
