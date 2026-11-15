// Interviews, both sides. The club offers a few times and picks how it happens (Zoom,
// Microsoft Teams, Google Meet, or in person). The student books one time in OdySC.
// On booking, a real deployment calls the club's connected video provider (Zoom
// "Create a meeting" / Microsoft Graph onlineMeetings) for a unique link and emails both
// sides; this prototype makes a stand-in link (see meetingLink in the store).
import { useState } from "react";
import type { Club, Interview, InterviewFormat } from "../../../shared/types";
import { BUILDINGS } from "../data/buildings";
import { useApp } from "../store";
import { TODAY, fmtDate, fmtTime } from "../util";
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

/* ================= club side: send / edit an invite ================= */
export function ScheduleModal({ appId, clubId, name, existing, onClose, onSent }: {
  appId: string; clubId: string; name: string; existing?: Interview; onClose: () => void; onSent: () => void;
}) {
  const { scheduleInterview, clubById, setClubSetting } = useApp();
  const club = clubById(clubId)!;
  const base = (days: number, h: number) => local(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days, h));
  const [format, setFormat] = useState<InterviewFormat>(existing?.format ?? "zoom");
  const [slots, setSlots] = useState<string[]>(existing?.slots.map((s) => s.slice(0, 16)) ?? [base(3, 16), base(4, 12), base(5, 18)]);
  const [duration, setDuration] = useState(existing?.durationMin ?? 20);
  const [link, setLink] = useState(existing?.link ?? "");
  const [building, setBuilding] = useState(existing?.buildingCode ?? "TCC");
  const [room, setRoom] = useState(existing?.room ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [tried, setTried] = useState(false);

  const connected = format === "zoom" ? club.zoomConnected : format === "teams" ? club.teamsConnected : format === "meet";
  const now = TODAY.toISOString().slice(0, 16);
  const errs: Record<string, string> = {};
  const clean = slots.filter(Boolean);
  if (!clean.length) errs.slots = "Offer at least one time.";
  else if (clean.some((s) => s < now)) errs.slots = "One of these times has already passed.";
  else if (new Set(clean).size !== clean.length) errs.slots = "Two of these times are the same.";
  if (format === "in-person" && !room.trim()) errs.room = "Add the room so they can find you.";
  if (format !== "in-person" && !connected && !/^https:\/\/\S+$/.test(link.trim())) errs.link = `Connect ${formatLabel(format)} or paste a meeting link.`;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errs).length) return;
    scheduleInterview({
      applicationId: appId,
      clubId,
      format,
      slots: [...clean].sort().map((s) => `${s}:00`),
      durationMin: duration,
      link: format !== "in-person" && link.trim() ? link.trim() : undefined,
      buildingCode: format === "in-person" ? building : undefined,
      room: format === "in-person" ? room.trim() : undefined,
      note: note.trim() || undefined,
    });
    onSent();
  };
  const show = (k: string) => tried && errs[k];

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <form className="modal iv-modal" role="dialog" aria-modal="true" aria-labelledby="iv-title" onSubmit={send} noValidate>
        <div className="modal-head">
          <h2 id="iv-title" className="h3">Invite {name} to interview</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 18 }}>
          <fieldset className="plain">
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

          {format === "zoom" || format === "teams" ? (
            connected ? (
              <p className="connected-note"><span className="dot-ok" /> {formatLabel(format)} is connected. OdySC creates a private meeting link when {name.split(" ")[0]} books.</p>
            ) : (
              <div className="connect-box">
                <div>
                  <strong>Connect {formatLabel(format)}</strong>
                  <p className="subtle" style={{ margin: "2px 0 0", fontSize: 14 }}>Sign in once and OdySC makes a meeting for every interview you book.</p>
                </div>
                <button type="button" className="btn sm primary" onClick={() => setClubSetting(clubId, format === "zoom" ? { zoomConnected: true } : { teamsConnected: true })}>Connect</button>
                <div className="or-paste">
                  <label className="field" htmlFor="iv-link">Or paste a meeting link</label>
                  <input id="iv-link" className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder={format === "zoom" ? "https://usc.zoom.us/j/…" : "https://teams.microsoft.com/l/meetup-join/…"} aria-invalid={!!show("link")} />
                  {show("link") && <p className="field-error" role="alert">{errs.link}</p>}
                </div>
              </div>
            )
          ) : format === "meet" ? (
            <p className="connected-note"><span className="dot-ok" /> A Google Meet link is created when {name.split(" ")[0]} books.</p>
          ) : (
            <div className="form-grid">
              <div>
                <label className="field" htmlFor="iv-bldg">Building</label>
                <select id="iv-bldg" className="input" value={building} onChange={(e) => setBuilding(e.target.value)}>
                  {Object.values(BUILDINGS).map((b) => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field" htmlFor="iv-room">Room <span className="req">*</span></label>
                <input id="iv-room" className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. TCC 227" aria-invalid={!!show("room")} />
                {show("room") && <p className="field-error" role="alert">{errs.room}</p>}
              </div>
            </div>
          )}

          <div>
            <div className="row between">
              <span className="field" style={{ margin: 0 }}>Times they can pick from</span>
              <select className="input sm-select" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Length">
                {[15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min each</option>)}
              </select>
            </div>
            <div className="slot-edit">
              {slots.map((s, i) => (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <input type="datetime-local" className="input" value={s} min={now} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Time ${i + 1}`} />
                  {slots.length > 1 && <button type="button" className="icon-btn" onClick={() => setSlots(slots.filter((_, j) => j !== i))} aria-label={`Remove time ${i + 1}`}>×</button>}
                </div>
              ))}
            </div>
            {slots.length < 6 && <button type="button" className="link-act" onClick={() => setSlots([...slots, base(slots.length + 3, 17)])}>+ Add a time</button>}
            {show("slots") && <p className="field-error" role="alert">{errs.slots}</p>}
          </div>

          <div>
            <label className="field" htmlFor="iv-note">Note for {name.split(" ")[0]} <span className="optional">Optional</span></label>
            <textarea id="iv-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who they'll meet, what to bring, how long it takes." />
          </div>

          <div className="row between wrap" style={{ gap: 10 }}>
            <span className="subtle" style={{ fontSize: 13 }}>They get an email and pick a time in OdySC.</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn primary">{existing ? "Update invite" : "Send invite"}</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ================= club side: status in the applicant panel ================= */
export function InterviewStatus({ iv, name, onEdit }: { iv: Interview; name: string; onEdit: () => void }) {
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
        {iv.booked && iv.link && <a className="btn sm primary" href={iv.link} target="_blank" rel="noreferrer">Join</a>}
        <button className="btn sm ghost" onClick={onEdit}>Edit</button>
      </div>
    </div>
  );
}

/* ================= student side: pick a time / see details ================= */
export function InterviewBooking({ iv, club }: { iv: Interview | undefined; club: Club }) {
  const { bookInterview, profile } = useApp();
  const [pick, setPick] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const contact = club.contacts[0]?.email;

  if (!iv)
    return <div className="alert ok reveal"><strong>{club.shortName} wants to interview you.</strong> They'll send times here soon, and you'll get an email too.</div>;

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
        <fieldset className="plain">
          <legend className="field">Pick a time</legend>
          <div className="slot-pick">
            {iv.slots.map((s) => (
              <label key={s} className={`slot ${pick === s ? "on" : ""}`}>
                <input type="radio" name="slot" value={s} checked={pick === s} onChange={() => setPick(s)} />
                <span className="slot-day">{new Date(s).toLocaleDateString("en-US", { weekday: "short" })}<b>{new Date(s).getDate()}</b></span>
                <span>{slotRange(s, iv.durationMin)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row between wrap" style={{ gap: 10, marginTop: 14 }}>
          {contact ? <a className="text-link" href={`mailto:${contact}?subject=${encodeURIComponent(`${club.shortName} interview times`)}`} style={{ fontSize: 14 }}>None of these work? Email {club.shortName}</a> : <span />}
          <button className="btn primary" disabled={!pick} onClick={() => pick && bookInterview(iv.applicationId, pick)}>Book this time</button>
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
      {iv.format !== "in-person" && iv.link && (
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn primary" href={iv.link} target="_blank" rel="noreferrer">Join {formatLabel(iv.format)}</a>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(iv.link!).then(() => setCopied(true), () => {}); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
      {iv.format === "in-person" && b && <CampusMap code={b.code} room={iv.room ?? b.code} title={`${club.shortName} interview`} when={`${fmtDate(iv.booked)}, ${fmtTime(iv.booked)}`} />}
      <p className="subtle" style={{ fontSize: 14, margin: 0 }}>
        We emailed the details to <strong>{profile.email || "your USC email"}</strong>. It's on your OdySC calendar too.{" "}
        <button className="link-act" onClick={() => bookInterview(iv.applicationId, null)}>Change time</button>
      </p>
    </div>
  );
}
