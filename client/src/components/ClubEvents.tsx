import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ClubEvent } from "../../../shared/types";
import { BUILDINGS } from "../data/buildings";
import { useApp } from "../store";
import { EventList } from "./ClubBits";

const KINDS: ClubEvent["kind"][] = ["Info session", "Mixer", "Workshop", "Coffee chat"];
const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480, 720, 1440];
const localDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type EventDraft = {
  title: string;
  kind: ClubEvent["kind"];
  date: string;
  time: string;
  duration: string;
  building: string;
  room: string;
};

export default function ClubEvents({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const { events, clubById } = useApp();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const publishButton = useRef<HTMLButtonElement>(null);
  const club = clubById(clubId);
  if (!club) return <p className="subtle">This club's events are not available.</p>;
  const clubEvents = events.filter((event) => event.clubId === clubId).sort((a, b) => a.start.localeCompare(b.start));
  const close = () => {
    setCreating(false);
    requestAnimationFrame(() => publishButton.current?.focus());
  };

  return (
    <section className="card panel" aria-labelledby="club-events-heading">
      <div className="section-head">
        <div>
          <h2 id="club-events-heading" className="h3">Club events</h2>
          <p className="subtle">Published events appear on {club.shortName}'s club page for students to find.</p>
        </div>
        {isAdmin && <button ref={publishButton} className="btn primary" onClick={() => { setNotice(""); setCreating(true); }}>Publish event</button>}
      </div>
      {notice && <p className="alert ok" role="status">{notice}</p>}
      {!isAdmin && <p className="hint">Club administrators can publish events. You can view the current events below.</p>}
      <EventList club={club} events={clubEvents} />
      {creating && isAdmin && <PublishEventModal clubName={club.name} onClose={close} onPublished={() => {
        setNotice("Event published. Students can find it on your club page.");
        close();
      }} />}
    </section>
  );
}

function PublishEventModal({ clubName, onClose, onPublished }: { clubName: string; onClose: () => void; onPublished: () => void }) {
  const { createClubEvent } = useApp();
  const [draft, setDraft] = useState<EventDraft>({ title: "", kind: "Info session", date: "", time: "", duration: "60", building: "", room: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "device local time";

  useEffect(() => { form.current?.querySelector<HTMLInputElement>("#club-event-title")?.focus(); }, []);

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    setError("");
  };
  const fieldError = (key: string) => errors[key] && <p id={`club-event-${key}-error`} className="field-error" role="alert">{errors[key]}</p>;
  const aria = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `club-event-${key}-error` : undefined });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const next: Record<string, string> = {};
    const title = draft.title.trim();
    const room = draft.room.trim();
    const stamp = `${draft.date}T${draft.time}`;
    const start = new Date(`${stamp}:00`);
    const durationMin = Number(draft.duration);
    if (!title || title.length > 200) next.title = "Enter an event title of 1–200 characters.";
    if (!KINDS.includes(draft.kind)) next.kind = "Choose an event type.";
    if (!draft.date) next.date = "Choose the event date.";
    if (!draft.time) next.time = "Choose the start time.";
    if (draft.date && draft.time) {
      if (!Number.isFinite(start.getTime()) || localDateTime(start) !== stamp) next.time = "Choose a valid date and start time in your device's time zone.";
      else if (start.getTime() <= Date.now()) next.time = "Choose a future event date and start time.";
    }
    if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 1440) next.duration = "Choose a duration between 5 and 1,440 minutes.";
    if (!BUILDINGS[draft.building]) next.building = "Choose a campus building.";
    if (!room || room.length > 100) next.room = "Enter a room or meeting point of 1–100 characters.";
    setErrors(next);
    setError("");
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    inFlight.current = true;
    setPending(true);
    form.current?.focus();
    try {
      await createClubEvent({ title, kind: draft.kind, start: start.toISOString(), durationMin, buildingCode: draft.building, room });
      onPublished();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The event could not be published. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const keyboard = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!inFlight.current) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
    const first = fields[0];
    const last = fields[fields.length - 1];
    if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !inFlight.current) onClose(); }}>
      <form ref={form} className="modal iv-modal" role="dialog" aria-modal="true" aria-labelledby="club-event-dialog-title" aria-describedby="club-event-publish-note" tabIndex={-1} onKeyDown={keyboard} onSubmit={submit} noValidate aria-busy={pending}>
        <div className="modal-head">
          <h2 id="club-event-dialog-title" className="h3">Publish a club event</h2>
          <button type="button" className="icon-btn" onClick={() => { if (!inFlight.current) onClose(); }} aria-label="Close event form" disabled={pending}>×</button>
        </div>
        <div className="modal-body stack">
          <p id="club-event-publish-note" className="subtle">Publish this <strong>{draft.kind.toLowerCase()}</strong> for <strong>{clubName}</strong>. Students will see these details on your club page.</p>
          <p id="club-event-time-zone" className="hint">Dates and times use your device's time zone: {zone}.</p>
          <fieldset className="plain" disabled={pending}>
            <div className="stack">
              <div>
                <label className="field" htmlFor="club-event-title">Event title <span className="req">*</span></label>
                <input id="club-event-title" className="input" value={draft.title} onChange={(event) => set("title", event.target.value)} maxLength={200} placeholder="Enter the event title" {...aria("title")} />
                {fieldError("title")}
              </div>
              <div className="form-grid">
                <div>
                  <label className="field" htmlFor="club-event-kind">Event type <span className="req">*</span></label>
                  <select id="club-event-kind" className="input" value={draft.kind} onChange={(event) => set("kind", event.target.value as ClubEvent["kind"])} {...aria("kind")}>
                    {KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                  {fieldError("kind")}
                </div>
                <div>
                  <label className="field" htmlFor="club-event-duration">Duration <span className="req">*</span></label>
                  <select id="club-event-duration" className="input" value={draft.duration} onChange={(event) => set("duration", event.target.value)} {...aria("duration")}>
                    {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select>
                  {fieldError("duration")}
                </div>
                <div>
                  <label className="field" htmlFor="club-event-date">Event date <span className="req">*</span></label>
                  <input id="club-event-date" type="date" className="input" value={draft.date} min={localDateTime(new Date()).slice(0, 10)} onChange={(event) => set("date", event.target.value)} {...aria("date")} />
                  {fieldError("date")}
                </div>
                <div>
                  <label className="field" htmlFor="club-event-time">Start time <span className="req">*</span></label>
                  <input id="club-event-time" type="time" className="input" value={draft.time} onChange={(event) => set("time", event.target.value)} {...aria("time")} aria-describedby={errors.time ? "club-event-time-error" : "club-event-time-zone"} />
                  {fieldError("time")}
                </div>
                <div>
                  <label className="field" htmlFor="club-event-building">Campus building <span className="req">*</span></label>
                  <select id="club-event-building" className="input" value={draft.building} onChange={(event) => set("building", event.target.value)} {...aria("building")}>
                    <option value="">Choose a building</option>
                    {Object.values(BUILDINGS).map((building) => <option key={building.code} value={building.code}>{building.code} · {building.name}</option>)}
                  </select>
                  {fieldError("building")}
                </div>
                <div>
                  <label className="field" htmlFor="club-event-room">Room or meeting point <span className="req">*</span></label>
                  <input id="club-event-room" className="input" value={draft.room} onChange={(event) => set("room", event.target.value)} maxLength={100} placeholder="Enter the room or meeting point" {...aria("room")} />
                  {fieldError("room")}
                </div>
              </div>
            </div>
          </fieldset>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row between wrap">
            <button type="button" className="btn ghost" onClick={() => { if (!inFlight.current) onClose(); }} disabled={pending}>Cancel</button>
            <button type="submit" className="btn primary" disabled={pending}>{pending ? "Publishing…" : "Publish event"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
