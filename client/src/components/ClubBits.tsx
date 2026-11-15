import { useApp } from "../store";
// Pieces shared by the club page and the My Clubs overview.
import { useState } from "react";
import type { Club, ClubEvent } from "../../../shared/types";
import { fmtDate, fmtTime } from "../util";
import CampusMap from "./CampusMap";

/** Builds a real .ics file so "Add to calendar" works in Google/Apple/Outlook. */
function downloadIcs(e: ClubEvent, clubName: string) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = new Date(e.start);
  const end = new Date(start.getTime() + e.durationMin * 60000);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OdySC//EN", "BEGIN:VEVENT",
    `UID:${e.id}@odysc`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${clubName}: ${e.title}`, `LOCATION:${e.room}, USC`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Starting in 30 minutes", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function EventList({ club, events }: { club: Club; events: ClubEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = events.filter((e) => e.clubId === club.id).sort((a, b) => a.start.localeCompare(b.start));
  if (!list.length) return <p className="subtle">No events posted yet.</p>;
  return (
    <div>
      {list.map((e) => {
        const d = new Date(e.start);
        return (
          <div key={e.id} className="event-wrap">
            <div className="event">
              <div className="datebox">
                <div className="m">{d.toLocaleDateString("en-US", { month: "short" })}</div>
                <div className="d">{d.getDate()}</div>
              </div>
              <div>
                <div className="row-title">{e.title}</div>
                <div className="subtle">{e.kind} · {fmtDate(e.start)}, {fmtTime(e.start)} · {e.room}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <CalButton id={e.id} />
                <button className="btn sm ghost" onClick={() => downloadIcs(e, club.shortName)} aria-label={`Download ${e.title} as .ics`} title="Download .ics for Google, Apple or Outlook">.ics</button>
                <button className="btn sm" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  {open === e.id ? "Hide map" : "Map"}
                </button>
              </div>
            </div>
            {open === e.id && (
              <div className="reveal" style={{ paddingBottom: 16 }}>
                <CampusMap code={e.buildingCode} room={e.room} title={e.title} when={`${fmtDate(e.start)}, ${fmtTime(e.start)}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Contacts({ club }: { club: Club }) {
  return (
    <div>
      {club.contacts.map((p) => (
        <div key={p.role} className="contact">
          <div className="row-title">{p.role}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <a className="chip" href={`mailto:${p.email}`}>{p.email}</a>
            {p.instagram && <span className="chip">{p.instagram}</span>}
          </div>
          {p.officeHours && <div className="subtle" style={{ marginTop: 4 }}>Office hours · {p.officeHours}</div>}
        </div>
      ))}
    </div>
  );
}

export function Facts({ club }: { club: Club }) {
  return (
    <dl className="facts">
      <div><dt>Deadline</dt><dd>{fmtDate(club.deadline)}</dd></div>
      <div><dt>Time</dt><dd>{club.hoursPerWeek}</dd></div>
      <div><dt>Dues</dt><dd>{club.dues}</dd></div>
      <div><dt>Membership</dt><dd>{club.selectivity === "Open" ? "Open to all" : `Selective · ${Math.round((club.acceptanceRate ?? 0) * 100)}%`}</dd></div>
    </dl>
  );
}

function CalButton({ id }: { id: string }) {
  const { calAdded, toggleCalEvent, account } = useApp();
  if (account?.role !== "student") return null;
  const on = calAdded.includes(id);
  return (
    <button className={`btn sm ${on ? "added" : ""}`} aria-pressed={on} onClick={() => toggleCalEvent(id)}>
      {on ? "✓ On calendar" : "+ Calendar"}
    </button>
  );
}
