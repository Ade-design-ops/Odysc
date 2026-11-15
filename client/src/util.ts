// Small helpers. Answer suggestions compare prompts from the student's own
// saved answer bank. Students review each suggestion before using it.
import type { ClubEvent } from "../../shared/types";

const STOP = new Set(
  "a an the to of and or for in on at with you your we our us me my i do did does is are be about tell describe what why how would join part".split(" "),
);

function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|s)$/, "")),
  );
}

export function similarity(a: string, b: string, ignore: string[] = []) {
  const skip = new Set(ignore.flatMap((n) => [...tokens(n)]));
  const A = [...tokens(a)].filter((t) => !skip.has(t));
  const B = new Set([...tokens(b)].filter((t) => !skip.has(t)));
  if (!A.length || !B.size) return 0;
  const inter = A.filter((t) => B.has(t)).length;
  return inter / new Set([...A, ...B]).size;
}

const DAY = 86_400_000;
export const TODAY = new Date();

// Preserve a date-only value's calendar date for display. Deadline eligibility uses USC time below.
export function toDate(iso: string) {
  return new Date(iso.length === 10 ? `${iso}T23:59:00` : iso);
}

export function daysUntil(iso: string, now = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((value) => value.type === type)?.value);
    const [year, month, day] = iso.split("-").map(Number);
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(part("year"), part("month") - 1, part("day"))) / DAY);
  }
  const end = toDate(iso);
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
}

export function deadlinePassed(iso: string, now = new Date()) {
  if (!iso || !Number.isFinite(toDate(iso).getTime())) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? daysUntil(iso, now) < 0 : toDate(iso).getTime() < now.getTime();
}

export function dueLabel(iso: string) {
  if (!iso || !Number.isFinite(toDate(iso).getTime())) return "No deadline posted";
  const d = daysUntil(iso);
  if (deadlinePassed(iso)) return "Closed";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

export function fmtDate(iso: string) {
  if (!iso || !Number.isFinite(toDate(iso).getTime())) return "Not provided";
  return toDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function fmtTime(iso: string) {
  if (!iso || !Number.isFinite(toDate(iso).getTime())) return "Not provided";
  return toDate(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** RFC 5545 TEXT escaping and UTF-8 line folding keep club text inside its property. */
export function eventIcs(event: ClubEvent, clubName: string, createdAt = new Date()) {
  const start = new Date(event.start);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(event.durationMin) || event.durationMin <= 0) {
    throw new Error("This event's date or duration is unavailable. Contact the club for details.");
  }
  const text = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const fmt = (date: Date) => date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const encoder = new TextEncoder();
  const fold = (line: string) => {
    let output = "";
    let bytes = 0;
    for (const character of line) {
      const size = encoder.encode(character).length;
      if (bytes + size > 75) { output += "\r\n "; bytes = 1; }
      output += character;
      bytes += size;
    }
    return output;
  };
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OdySC//EN", "BEGIN:VEVENT",
    `UID:${text(event.id)}@odysc`, `DTSTAMP:${fmt(createdAt)}`, `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(new Date(start.getTime() + event.durationMin * 60000))}`,
    `SUMMARY:${text(`${clubName}: ${event.title}`)}`,
    `LOCATION:${text([event.buildingCode, event.room].filter(Boolean).join(" ") + ", USC")}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Starting in 30 minutes", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}
