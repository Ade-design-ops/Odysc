// Student calendar. Shows club events you added, your own events, and application
// deadlines; info sessions from clubs on your list appear as dashed "suggested" chips you
// can add in one click. Each calendar gets a color you choose and can be hidden.
import { useMemo, useState } from "react";
import type { ClubEvent, PersonalEvent } from "../../../shared/types";
import CampusMap from "../components/CampusMap";
import HomeBand from "../components/HomeBand";
import { Loading } from "../components/ui";
import { BUILDINGS } from "../data/buildings";
import { CAL_COLORS } from "../data/mock";
import { useApp } from "../store";
import { TODAY, fmtDate, fmtTime, toDate } from "../util";

type Item = {
  key: string; // calendar this belongs to: clubId | "personal" | "deadlines"
  id: string;
  kind: "club" | "suggested" | "personal" | "deadline";
  title: string;
  short: string; // without the club name, for the month grid where color already says which club
  start: Date;
  durationMin?: number;
  where?: string;
  event?: ClubEvent;
  personal?: PersonalEvent;
};

const DAY = 86_400_000;
const CLUB_DEFAULTS = CAL_COLORS.filter((c) => c !== "#c99700" && c !== "#23211f");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Calendar() {
  const s = useApp();
  const { ready, events, myClubs, clubById, calAdded, personal, calColors, calHidden, toggleCalHidden, setCalColor, apps, interviews } = s;
  const [month, setMonth] = useState(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
  const [view, setView] = useState<"month" | "agenda">("month");
  const [selected, setSelected] = useState<Item | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // yyyy-mm-dd
  const [picking, setPicking] = useState<string | null>(null); // color picker for calendar key

  const calendars = useMemo(() => {
    const clubIds = [...new Set([...myClubs, ...events.filter((e) => calAdded.includes(e.id)).map((e) => e.clubId)])];
    return [
      ...clubIds.map((id) => ({ key: id, label: clubById(id)?.shortName ?? id })),
      { key: "personal", label: "Personal" },
      ...(Object.values(interviews).some((iv) => iv.booked && iv.applicationId.startsWith("me_")) ? [{ key: "interviews", label: "Interviews" }] : []),
      { key: "deadlines", label: "Application deadlines" },
    ];
  }, [myClubs, events, calAdded, clubById, interviews]);
  const colorOf = (key: string) => calColors[key] ?? (key === "deadlines" ? "#c99700" : key === "interviews" ? "#5b4bb7" : key === "personal" ? "#23211f" : CLUB_DEFAULTS[Math.max(0, calendars.findIndex((c) => c.key === key)) % CLUB_DEFAULTS.length]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const e of events) {
      const added = calAdded.includes(e.id);
      if (!added && !myClubs.includes(e.clubId)) continue;
      out.push({ key: e.clubId, id: e.id, kind: added ? "club" : "suggested", title: `${clubById(e.clubId)?.shortName}: ${e.title}`, short: e.title, start: new Date(e.start), durationMin: e.durationMin, where: e.room, event: e });
    }
    for (const p of personal) out.push({ key: "personal", id: p.id, kind: "personal", title: p.title, short: p.title, start: new Date(p.start), durationMin: p.durationMin, where: p.location, personal: p });
    for (const id of myClubs) {
      const c = clubById(id);
      if (!c || (apps[id] && apps[id].status !== "draft")) continue;
      out.push({ key: "deadlines", id: `dl_${id}`, kind: "deadline", title: `${c.shortName} application due`, short: `${c.shortName} due`, start: toDate(c.deadline) });
    }
    for (const iv of Object.values(interviews)) {
      if (!iv.booked || !iv.applicationId.startsWith("me_")) continue;
      const c = clubById(iv.clubId);
      out.push({ key: "interviews", id: `iv_${iv.clubId}`, kind: "personal", title: `${c?.shortName} interview`, short: `${c?.shortName} interview`, start: new Date(iv.booked), durationMin: iv.durationMin, where: iv.room ?? (iv.format === "zoom" ? "Zoom" : iv.format === "teams" ? "Teams" : "Google Meet") });
    }
    return out.filter((i) => !calHidden.includes(i.key)).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, calAdded, myClubs, personal, apps, clubById, calHidden, interviews]);

  if (!ready) return <Loading />;

  // month grid: weeks starting Sunday
  const first = new Date(month);
  const gridStart = new Date(first.getTime() - first.getDay() * DAY);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const weeks = days[35].getMonth() !== month.getMonth() ? 5 : 6;
  const agenda = items.filter((i) => i.start >= new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()));

  const addedCount = items.filter((i) => i.kind === "club" || i.kind === "personal").length;

  return (
    <>
      <HomeBand
        kicker="Calendar"
        title={month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        sub={`${addedCount} event${addedCount === 1 ? "" : "s"} on your calendar · dashed ones are suggestions from your clubs`}
        actions={
          <>
            <button className="btn pill-white" onClick={() => setCreating(ymd(TODAY))}>+ New event</button>
            <div className="seg-light" role="group" aria-label="View">
              <button aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
              <button aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>Agenda</button>
            </div>
          </>
        }
      />

      <div className="cal-layout">
        <aside className="cal-side">
          <h2 className="h3">My calendars</h2>
          <ul className="cal-list">
            {calendars.map((c) => (
              <li key={c.key}>
                <label className="cal-check">
                  <input type="checkbox" checked={!calHidden.includes(c.key)} onChange={() => toggleCalHidden(c.key)} style={{ accentColor: colorOf(c.key) }} />
                  <span>{c.label}</span>
                </label>
                <button className="swatch" style={{ background: colorOf(c.key) }} onClick={() => setPicking(picking === c.key ? null : c.key)} aria-label={`Change color for ${c.label}`} aria-expanded={picking === c.key} />
                {picking === c.key && (
                  <div className="swatches reveal" role="group" aria-label={`Colors for ${c.label}`}>
                    {CAL_COLORS.map((col) => (
                      <button key={col} style={{ background: col }} aria-label={col} aria-pressed={colorOf(c.key) === col} onClick={() => { setCalColor(c.key, col); setPicking(null); }} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="subtle" style={{ marginTop: 16 }}>Add clubs on Club Search to see their info sessions here.</p>
        </aside>

        <section className="cal-main card">
          {view === "month" ? (
            <>
              <div className="cal-nav">
                <button className="btn sm ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
                <strong>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
                <button className="btn sm ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
                <button className="btn sm" onClick={() => setMonth(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1))}>Today</button>
              </div>
              <div className="cal-grid" role="grid" aria-label="Month">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
                {days.slice(0, weeks * 7).map((d) => {
                  const its = items.filter((i) => sameDay(i.start, d));
                  const out = d.getMonth() !== month.getMonth();
                  return (
                    <div key={d.toISOString()} className={`cal-day ${out ? "out" : ""} ${sameDay(d, TODAY) ? "today" : ""}`} role="gridcell" onDoubleClick={() => setCreating(ymd(d))}>
                      <span className="cal-num">{d.getDate()}</span>
                      {its.slice(0, 3).map((i) => (
                        <button key={i.id} className={`chip-ev ${i.kind}`} style={{ ["--c" as string]: colorOf(i.key) }} onClick={() => setSelected(i)} title={i.title}>
                          {i.kind !== "deadline" && <span className="t">{fmtTime(i.start.toISOString()).replace(":00", "").replace(" ", "").toLowerCase()}</span>} {i.short}
                        </button>
                      ))}
                      {its.length > 3 && <span className="more">+{its.length - 3} more</span>}
                    </div>
                  );
                })}
              </div>
              <p className="subtle" style={{ margin: "10px 0 0" }}>Tip: double-click a day to add your own event.</p>
            </>
          ) : (
            <div className="agenda">
              {agenda.length === 0 && <p className="subtle">Nothing coming up. Add events from your clubs or make your own.</p>}
              {[...new Set(agenda.map((i) => ymd(i.start)))].map((day) => (
                <div key={day} className="agenda-day">
                  <div className="agenda-date">{fmtDate(day + "T12:00:00")}</div>
                  {agenda.filter((i) => ymd(i.start) === day).map((i) => (
                    <button key={i.id} className={`agenda-item ${i.kind}`} style={{ ["--c" as string]: colorOf(i.key) }} onClick={() => setSelected(i)}>
                      <span className="bar" />
                      <span className="when">{i.kind === "deadline" ? "Due" : fmtTime(i.start.toISOString())}</span>
                      <span className="what">{i.title}{i.where ? <span className="subtle"> · {i.where}</span> : null}</span>
                      {i.kind === "suggested" && <span className="pill gold">Suggested</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {selected && <EventDrawer item={selected} color={colorOf(selected.key)} onClose={() => setSelected(null)} />}
      {creating && <NewEvent date={creating} onClose={() => setCreating(null)} />}
    </>
  );
}

function EventDrawer({ item, color, onClose }: { item: Item; color: string; onClose: () => void }) {
  const { toggleCalEvent, removePersonal, calAdded } = useApp();
  const e = item.event;
  const added = e ? calAdded.includes(e.id) : true;
  const end = item.durationMin ? new Date(item.start.getTime() + item.durationMin * 60000) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal drawer" role="dialog" aria-modal="true" aria-labelledby="ev-title" style={{ borderTopColor: color }}>
        <div className="modal-head">
          <h2 id="ev-title" className="h3">{item.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 12 }}>
          <div className="subtle">
            {fmtDate(item.start.toISOString())}
            {item.kind !== "deadline" && `, ${fmtTime(item.start.toISOString())}${end ? ` – ${fmtTime(end.toISOString())}` : ""}`}
            {item.where ? ` · ${item.where}` : ""}
          </div>
          {e && BUILDINGS[e.buildingCode] && <CampusMap code={e.buildingCode} room={e.room} title={e.title} when={`${fmtDate(e.start)}, ${fmtTime(e.start)}`} />}
          <div className="row wrap" style={{ gap: 8 }}>
            {e && (
              <button className={`btn ${added ? "" : "primary"}`} onClick={() => { toggleCalEvent(e.id); if (added) onClose(); }}>
                {added ? "Remove from my calendar" : "Add to my calendar"}
              </button>
            )}
            {item.personal && <button className="btn" onClick={() => { removePersonal(item.personal!.id); onClose(); }}>Delete event</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewEvent({ date, onClose }: { date: string; onClose: () => void }) {
  const { addPersonal } = useApp();
  const [f, setF] = useState({ title: "", date, time: "18:00", duration: "60", location: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Give it a name.";
    if (!f.date) e.date = "Pick a date.";
    if (!f.time) e.time = "Pick a time.";
    setErr(e);
    if (Object.keys(e).length) return;
    addPersonal({ title: f.title.trim(), start: `${f.date}T${f.time}:00`, durationMin: Number(f.duration), location: f.location.trim() || undefined });
    onClose();
  };
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((x) => ({ ...x, [k]: "" })); };
  return (
    <div className="modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-ev" onSubmit={save} noValidate>
        <div className="modal-head">
          <h2 id="new-ev" className="h3">New event</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <div>
            <label className="field" htmlFor="ne-title">Title <span className="req">*</span></label>
            <input id="ne-title" className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Study group for EE 250" autoFocus aria-invalid={!!err.title} />
            {err.title && <p className="field-error" role="alert">{err.title}</p>}
          </div>
          <div className="form-grid">
            <div>
              <label className="field" htmlFor="ne-date">Date <span className="req">*</span></label>
              <input id="ne-date" type="date" className="input" value={f.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!err.date} />
              {err.date && <p className="field-error" role="alert">{err.date}</p>}
            </div>
            <div>
              <label className="field" htmlFor="ne-time">Start <span className="req">*</span></label>
              <input id="ne-time" type="time" className="input" value={f.time} onChange={(e) => set("time", e.target.value)} aria-invalid={!!err.time} />
              {err.time && <p className="field-error" role="alert">{err.time}</p>}
            </div>
            <div>
              <label className="field" htmlFor="ne-dur">Length</label>
              <select id="ne-dur" className="input" value={f.duration} onChange={(e) => set("duration", e.target.value)}>
                {[["30", "30 min"], ["60", "1 hour"], ["90", "1.5 hours"], ["120", "2 hours"], ["180", "3 hours"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="field" htmlFor="ne-loc">Where <span className="optional">Optional</span></label>
              <input id="ne-loc" className="input" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Leavey 2nd floor" />
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary">Add to calendar</button>
          </div>
        </div>
      </form>
    </div>
  );
}
