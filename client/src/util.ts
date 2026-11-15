// Small helpers. `similarity` is a client-side stand-in for the AI engineer's embedding
// search (/api/ai/answer-bank) so autofill works in the demo before the AI is wired up.

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
export const TODAY = new Date("2026-11-14T12:00:00"); // pinned for the demo; use new Date() later

// Date-only strings ("2026-11-21") mean end of that day in local time, not UTC midnight.
export function toDate(iso: string) {
  return new Date(iso.length === 10 ? `${iso}T23:59:00` : iso);
}

export function daysUntil(iso: string) {
  const end = toDate(iso);
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfToday = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  return Math.round((startOfEnd.getTime() - startOfToday.getTime()) / DAY);
}

export function dueLabel(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return "Closed";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

export function fmtDate(iso: string) {
  return toDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function fmtTime(iso: string) {
  return toDate(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

// Browser storage can throw (private mode, some embeds) — never let it crash the app.
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`odysc:${key}`);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`odysc:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
