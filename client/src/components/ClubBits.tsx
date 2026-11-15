import { useApp } from "../store";
// Pieces shared by the club page and the My Clubs overview.
import { useState } from "react";
import type { Club, ClubEvent } from "../../../shared/types";
import { eventIcs, fmtDate, fmtTime } from "../util";
import CampusMap from "./CampusMap";

/** Builds a real .ics file so "Add to calendar" works in Google/Apple/Outlook. */
function downloadIcs(e: ClubEvent, clubName: string) {
  const url = URL.createObjectURL(new Blob([eventIcs(e, clubName)], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.id.replace(/[^a-z\d_-]/gi, "_")}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari needs the URL to remain available until it starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EventList({ club, events, onEdit }: { club: Club; events: ClubEvent[]; onEdit?: (event: ClubEvent, trigger: HTMLButtonElement) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
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
                {onEdit && <button className="btn sm" onClick={(click) => onEdit(e, click.currentTarget)} aria-label={`Edit ${e.title}`}>Edit</button>}
                <CalButton id={e.id} />
                <button className="btn sm ghost" onClick={() => { try { downloadIcs(e, club.shortName); setDownloadError(""); } catch (error) { setDownloadError(error instanceof Error ? error.message : "The calendar file could not be downloaded."); } }} aria-label={`Download ${e.title} as .ics`} title="Download .ics for Google, Apple or Outlook">.ics</button>
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
      {downloadError && <p className="field-error" role="alert">{downloadError}</p>}
    </div>
  );
}

export function Contacts({ club }: { club: Club }) {
  if (!club.contacts.length) return <p className="subtle">No contact details posted yet.</p>;
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
      <div><dt>Deadline</dt><dd>{fmtDate(club.deadline)}{club.deadline.length === 10 ? " · USC/Pacific time" : ""}</dd></div>
      <div><dt>Time</dt><dd>{club.hoursPerWeek || "Not provided"}</dd></div>
      <div><dt>Dues</dt><dd>{club.dues || "Not provided"}</dd></div>
      <div><dt>Membership</dt><dd>{club.selectivity === "Open" ? "Open to all" : club.selectivity === "Selective" ? `Selective${club.acceptanceRate !== undefined ? ` · ${Math.round(club.acceptanceRate * 100)}%` : ""}` : "Not provided"}</dd></div>
    </dl>
  );
}

function CalButton({ id }: { id: string }) {
  const { calAdded, toggleCalEvent, account } = useApp();
  if (account?.role !== "student") return null;
  const on = calAdded.includes(id);
  return (
    <button className={`btn sm ${on ? "added" : ""}`} aria-pressed={on} onClick={() => { void toggleCalEvent(id).catch(() => {}); }}>
      {on ? "✓ On calendar" : "+ Calendar"}
    </button>
  );
}
