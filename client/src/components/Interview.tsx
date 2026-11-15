// Interviews, both sides. The club offers a few times and picks how it happens (Zoom,
// Microsoft Teams, Google Meet, or in person). The student books one time in OdySC.
// Video meetings use an organizer-supplied HTTPS URL. Invitations and bookings are
// saved on the server; no provider connection or email delivery is implied.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Club, Interview, InterviewFormat } from "../../../shared/types";
import { BUILDINGS } from "../data/buildings";
import { useApp } from "../store";
import { fmtDate, fmtTime } from "../util";
import CampusMap from "./CampusMap";

export const FORMATS: { id: InterviewFormat; label: string; short: string }[] = [
  { id: "zoom", label: "Zoom", short: "Zoom" },
  { id: "teams", label: "Microsoft Teams", short: "Teams" },
  { id: "meet", label: "Google Meet", short: "Meet" },
  { id: "in-person", label: "In person", short: "In person" },
];
export const formatLabel = (f: InterviewFormat) => FORMATS.find((x) => x.id === f)!.label;

export function FormatIcon({ format, size = 20 }: { format: InterviewFormat; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (format === "in-person")
    return <svg {...p}><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z" /><circle cx="12" cy="11" r="2.2" /></svg>;
  return <svg {...p}><rect x="3" y="6" width="13" height="12" rx="3" /><path d="m16 10.5 5-3v9l-5-3" /></svg>;
}

const slotRange = (iso: string, mins: number) => `${fmtTime(iso)} – ${fmtTime(new Date(new Date(iso).getTime() + mins * 60000).toISOString())}`;
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const isMeetingLink = (value: string | undefined) => {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
};

/* ================= club side: send / edit an invite ================= */
export function ScheduleModal({ appId, clubId, name, existing, onClose, onSent }: {
  appId: string; clubId: string; name: string; existing?: Interview; onClose: () => void; onSent: () => void;
}) {
  const { scheduleInterview } = useApp();
  const today = new Date();
  const base = (days: number, h: number) => local(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, h));
  const [format, setFormat] = useState<InterviewFormat>(existing?.format ?? "zoom");
  const [slots, setSlots] = useState<string[]>(existing?.slots.map((s) => local(new Date(s))) ?? [base(3, 16), base(4, 12), base(5, 18)]);
  const [duration, setDuration] = useState(existing?.durationMin ?? 20);
  const [link, setLink] = useState(existing?.link ?? "");
  const [building, setBuilding] = useState(existing?.buildingCode ?? "TCC");
  const [room, setRoom] = useState(existing?.room ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "device local time";
  const close = () => { if (!inFlight.current) onClose(); };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    form.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const keyboard = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')).filter((field) => field.getClientRects().length > 0);
    const first = fields[0];
    const last = fields[fields.length - 1];
    if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
  };

  const now = local(new Date());
  const errs: Record<string, string> = {};
  const clean = slots.filter(Boolean);
  if (!clean.length) errs.slots = "Offer at least one time.";
  else if (clean.some((s) => !Number.isFinite(new Date(s).getTime()) || local(new Date(s)) !== s)) errs.slots = "Choose valid local dates and times.";
  else if (clean.some((s) => new Date(s).getTime() <= Date.now())) errs.slots = "One of these times has already passed.";
  else if (new Set(clean.map((s) => new Date(s).getTime())).size !== clean.length) errs.slots = "Two of these times are the same.";
  if (format === "in-person" && !room.trim()) errs.room = "Add the room so they can find you.";
  if (format !== "in-person" && !isMeetingLink(link.trim())) errs.link = `Paste an HTTPS ${formatLabel(format)} meeting link.`;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    setTried(true);
    if (Object.keys(errs).length) return;
    if (clean.some((slot) => new Date(slot).getTime() <= Date.now())) return setError("One of these times has passed. Offer a future time.");
    inFlight.current = true;
    setPending(true);
    setError("");
    form.current?.focus();
    try {
      await scheduleInterview({
        applicationId: appId,
        clubId,
        format,
        slots: clean.map((s) => new Date(s).toISOString()).sort(),
        durationMin: duration,
        link: format !== "in-person" ? link.trim() : undefined,
        buildingCode: format === "in-person" ? building : undefined,
        room: format === "in-person" ? room.trim() : undefined,
        note: note.trim() || undefined,
      });
      onSent();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The interview invitation could not be saved."); }
    finally { inFlight.current = false; setPending(false); }
  };
  const show = (k: string) => tried && errs[k];

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && close()}>
      <form ref={form} tabIndex={-1} onKeyDown={keyboard} className="modal iv-modal" role="dialog" aria-modal="true" aria-labelledby="iv-title" onSubmit={send} noValidate aria-busy={pending}>
        <div className="modal-head">
          <h2 id="iv-title" className="h3">Invite {name} to interview</h2>
          <button type="button" className="icon-btn" disabled={pending} onClick={close} aria-label="Close">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 18 }}>
          <fieldset className="plain" disabled={pending}>
            <legend className="field">How</legend>
            <div className="format-grid">
              {FORMATS.map((f) => (
                <label key={f.id} className={`format-opt ${format === f.id ? "on" : ""}`}>
                  <input type="radio" name="format" value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} />
                  <FormatIcon format={f.id} />
                  <span>{f.short}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {format !== "in-person" ? (
              <div className="connect-box">
                <div>
                  <strong>Manual {formatLabel(format)} meeting links</strong>
                  <p className="subtle" style={{ margin: "2px 0 0", fontSize: 14 }}>Create a meeting with {formatLabel(format)}, then paste its link below. Automatic connection is not configured.</p>
                </div>
                <button type="button" className="btn sm primary" disabled title="Paste an existing meeting link below.">Connect</button>
                <div className="or-paste">
                  <label className="field" htmlFor="iv-link">Paste a meeting link <span className="req">*</span></label>
                  <input id="iv-link" className="input" disabled={pending} maxLength={2000} value={link} onChange={(e) => setLink(e.target.value)} placeholder={format === "zoom" ? "https://usc.zoom.us/j/…" : format === "teams" ? "https://teams.microsoft.com/l/meetup-join/…" : "https://meet.google.com/…"} aria-invalid={!!show("link")} />
                  {show("link") && <p className="field-error" role="alert">{errs.link}</p>}
                </div>
              </div>
          ) : (
            <div className="form-grid">
              <div>
                <label className="field" htmlFor="iv-bldg">Building</label>
                <select id="iv-bldg" className="input" disabled={pending} value={building} onChange={(e) => setBuilding(e.target.value)}>
                  {Object.values(BUILDINGS).map((b) => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field" htmlFor="iv-room">Room <span className="req">*</span></label>
                <input id="iv-room" className="input" disabled={pending} maxLength={100} value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. TCC 227" aria-invalid={!!show("room")} />
                {show("room") && <p className="field-error" role="alert">{errs.room}</p>}
              </div>
            </div>
          )}

          <div>
            <div className="row between">
              <span className="field" style={{ margin: 0 }}>Times they can pick from</span>
              <select className="input sm-select" disabled={pending} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Length">
                {[15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min each</option>)}
              </select>
            </div>
            <p className="hint">Dates and times use your device's time zone: {zone}.</p>
            <div className="slot-edit">
              {slots.map((s, i) => (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <input type="datetime-local" className="input" disabled={pending} value={s} min={now} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Time ${i + 1}`} />
                  {slots.length > 1 && <button type="button" className="icon-btn" disabled={pending} onClick={() => setSlots(slots.filter((_, j) => j !== i))} aria-label={`Remove time ${i + 1}`}>×</button>}
                </div>
              ))}
            </div>
            {slots.length < 6 && <button type="button" className="link-act" disabled={pending} onClick={() => setSlots([...slots, base(slots.length + 3, 17)])}>+ Add a time</button>}
            {show("slots") && <p className="field-error" role="alert">{errs.slots}</p>}
          </div>

          <div>
            <label className="field" htmlFor="iv-note">Note for {name.split(" ")[0]} <span className="optional">Optional</span></label>
            <textarea id="iv-note" className="input" disabled={pending} maxLength={2000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who they'll meet, what to bring, how long it takes." />
          </div>

          {existing?.booked && <p className="hint">Updating this invitation clears the current booking. The applicant will need to choose a time again.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row between wrap" style={{ gap: 10 }}>
            <span className="subtle" style={{ fontSize: 13 }}>The applicant can pick a time in OdySC.</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" disabled={pending} onClick={close}>Cancel</button>
              <button type="submit" className="btn primary" disabled={pending}>{pending ? "Saving…" : existing ? "Update invite" : "Save invite"}</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ================= club side: status in the applicant panel ================= */
export function InterviewStatus({ iv, name, onEdit }: { iv: Interview; name: string; onEdit?: () => void }) {
  const first = name.split(" ")[0];
  return (
    <div className={`iv-status ${iv.booked ? "booked" : ""}`}>
      <span className="iv-ico"><FormatIcon format={iv.format} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {iv.booked ? `Interview booked · ${fmtDate(iv.booked)}, ${slotRange(iv.booked, iv.durationMin)}` : `Waiting for ${first} to pick a time`}
        </div>
        <div className="subtle">
          {formatLabel(iv.format)}
          {iv.format === "in-person" ? ` · ${iv.room}` : ""}
          {!iv.booked && ` · ${iv.slots.length} time${iv.slots.length === 1 ? "" : "s"} offered`}
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {iv.booked && isMeetingLink(iv.link) && <a className="btn sm primary" href={iv.link} target="_blank" rel="noreferrer">Join</a>}
        {onEdit && <button className="btn sm ghost" onClick={onEdit}>Edit</button>}
      </div>
    </div>
  );
}

/* ================= student side: pick a time / see details ================= */
export function InterviewBooking({ iv, club }: { iv: Interview | undefined; club: Club }) {
  const { bookInterview } = useApp();
  const [pick, setPick] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const contact = club.contacts[0]?.email;
  const available = iv?.slots.filter((slot) => Number.isFinite(new Date(slot).getTime()) && new Date(slot).getTime() > Date.now()) ?? [];
  useEffect(() => { setPick(null); setCopied(false); setError(""); }, [iv?.applicationId, iv?.booked, iv?.link, iv?.slots.join("|")]);
  const changeBooking = async (slot: string | null) => {
    if (!iv || inFlight.current) return;
    if (slot && (!available.includes(slot) || new Date(slot).getTime() <= Date.now())) return setError("Choose an available future time.");
    inFlight.current = true;
    setPending(true);
    setError("");
    try { await bookInterview(iv.applicationId, slot); setPick(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The booking could not be updated."); }
    finally { inFlight.current = false; setPending(false); }
  };

  if (!iv)
    return <div className="alert ok reveal"><strong>{club.shortName} wants to interview you.</strong> Interview times will appear here when the club posts them.</div>;

  if (!iv.booked)
    return (
      <div className="iv-card reveal">
        <div className="iv-head">
          <span className="iv-ico big"><FormatIcon format={iv.format} size={24} /></span>
          <div>
            <h3 className="h3" style={{ margin: 0 }}>{club.shortName} wants to interview you</h3>
            <p className="subtle" style={{ margin: "2px 0 0" }}>{formatLabel(iv.format)} · {iv.durationMin} minutes{iv.format === "in-person" && iv.buildingCode ? ` · ${iv.room}` : ""}</p>
          </div>
        </div>
        {iv.note && <p className="iv-note">{iv.note}</p>}
        <fieldset className="plain" disabled={pending}>
          <legend className="field">Pick a time</legend>
          <div className="slot-pick">
            {available.map((s) => (
              <label key={s} className={`slot ${pick === s ? "on" : ""}`}>
                <input type="radio" name="slot" value={s} checked={pick === s} onChange={() => setPick(s)} />
                <span className="slot-day">{new Date(s).toLocaleDateString("en-US", { weekday: "short" })}<b>{new Date(s).getDate()}</b></span>
                <span>{slotRange(s, iv.durationMin)}</span>
              </label>
            ))}
          </div>
          {!available.length && <p className="subtle">No upcoming times are available. Ask the club to offer new times.</p>}
        </fieldset>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="row between wrap" style={{ gap: 10, marginTop: 14 }}>
          {contact ? <a className="text-link" href={`mailto:${contact}?subject=${encodeURIComponent(`${club.shortName} interview times`)}`} style={{ fontSize: 14 }}>None of these work? Email {club.shortName}</a> : <span />}
          <button className="btn primary" disabled={pending || !pick || !available.includes(pick)} onClick={() => { if (pick) void changeBooking(pick); }}>{pending ? "Booking…" : "Book this time"}</button>
        </div>
      </div>
    );

  const start = new Date(iv.booked);
  const b = iv.buildingCode ? BUILDINGS[iv.buildingCode] : undefined;
  return (
    <div className="iv-card booked reveal">
      <div className="iv-ticket">
        <div className="iv-date">
          <span>{start.toLocaleDateString("en-US", { month: "short" })}</span>
          <b>{start.getDate()}</b>
          <span>{start.toLocaleDateString("en-US", { weekday: "short" })}</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="pill ok" style={{ marginBottom: 6 }}>Booked</div>
          <h3 className="h3" style={{ margin: 0 }}>{club.shortName} interview</h3>
          <p className="subtle" style={{ margin: "2px 0 0" }}>{slotRange(iv.booked, iv.durationMin)} · {formatLabel(iv.format)}{iv.room ? ` · ${iv.room}` : ""}</p>
        </div>
      </div>
      {iv.note && <p className="iv-note">{iv.note}</p>}
      {iv.format !== "in-person" && isMeetingLink(iv.link) && (
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn primary" href={iv.link} target="_blank" rel="noreferrer">Join {formatLabel(iv.format)}</a>
          <button className="btn" onClick={async () => {
            try {
              if (!navigator.clipboard || !iv.link) throw new Error("clipboard_unavailable");
              await navigator.clipboard.writeText(iv.link);
              setCopied(true);
            } catch { setError("The link could not be copied. You can open it using the Join button."); }
          }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
      {iv.format === "in-person" && b && <CampusMap code={b.code} room={iv.room ?? b.code} title={`${club.shortName} interview`} when={`${fmtDate(iv.booked)}, ${fmtTime(iv.booked)}`} />}
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="subtle" style={{ fontSize: 14, margin: 0 }}>
        Your selected time is saved in OdySC.{" "}
        <button className="link-act" disabled={pending} onClick={() => { void changeBooking(null); }}>{pending ? "Updating…" : "Change time"}</button>
      </p>
    </div>
  );
}
