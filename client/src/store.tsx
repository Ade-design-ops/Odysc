// App-wide state, Common App style: a profile, a "My Clubs" list, per-club drafts and
// statuses, and an answer bank that grows as you submit. Persisted to the browser so the
// demo survives a refresh; "Reset demo" in the footer clears it.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account, AnswerBankEntry, AppStatus, Club, ClubEvent, Interview, Match, PersonalEvent, Student, TeamMember } from "../../shared/types";
import { api } from "./api";
import * as mock from "./data/mock";
import { store } from "./util";

export type Draft = Record<string, string>; // questionId -> text
export interface ClubApp {
  status: AppStatus; // draft until submitted
  submittedAt?: string;
  sharedUscId?: boolean; // student consented to share their USC ID with this club
}

export const PROFILE_SECTIONS = [
  { id: "personal", title: "Personal", done: (s: Student) => !!s.name && !!s.email && !!s.uscId },
  { id: "academics", title: "Academics", done: (s: Student) => !!s.major && s.year > 0 },
  { id: "experience", title: "Experience", done: (s: Student) => s.experiences.some((e) => e.trim()) },
  { id: "interests", title: "Skills & interests", done: (s: Student) => s.skills.length > 0 && s.interests.length > 0 },
] as const;

interface Persisted {
  account: Account | null; // who is signed in
  accounts: Record<string, Account>; // demo "user table", keyed by email
  profile: Student;
  myClubs: string[];
  drafts: Record<string, Draft>;
  apps: Record<string, ClubApp>;
  answerBank: AnswerBankEntry[];
  reminders: string[];
  seenUnlock: boolean;
  // calendar
  calAdded: string[]; // club event ids on my calendar
  personal: PersonalEvent[];
  calColors: Record<string, string>; // clubId or "personal" -> color
  calHidden: string[]; // calendars toggled off
  // club side
  teams: Record<string, TeamMember[]>;
  scores: Record<string, Record<string, Record<string, number>>>; // applicationId -> reviewer email -> criterion -> 1..5
  decisions: Record<string, Decision>;
  clubSettings: Record<string, ClubSettings>;
  interviews: Record<string, Interview>; // applicationId -> interview
}

export type Decision = "advance" | "decline" | "accept";
export interface ClubSettings {
  requiresUscId?: boolean;
  uscIdReason?: string;
  zoomConnected?: boolean;
  teamsConnected?: boolean;
}

/** Officer verification (roster / admin approval). Off for the hackathon demo so anyone can try the club side. */
export const VERIFY_OFFICERS = false;

/** The signed-in student's own application to a club, as the club sees it. */
export const myAppId = (clubId: string) => `me_${clubId}`;
const clubOfMyApp = (appId: string) => (appId.startsWith("me_") ? appId.slice(3) : null);

/** Stand-in for the Zoom / Microsoft Graph "create meeting" call made when a student books. */
export function meetingLink(format: Interview["format"], seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const id = String(h).padStart(10, "7").slice(0, 10);
  if (format === "zoom") return `https://usc.zoom.us/j/${id}`;
  if (format === "teams") return `https://teams.microsoft.com/l/meetup-join/odysc-${id}`;
  if (format === "meet") return `https://meet.google.com/ody-${id.slice(0, 4)}-${id.slice(4, 7)}`;
  return undefined;
}

const initial = (): Persisted => ({
  account: null,
  accounts: { [mock.demoOfficer.email]: mock.demoOfficer },
  profile: mock.student,
  myClubs: [],
  drafts: {},
  apps: {},
  answerBank: mock.answerBank,
  reminders: [],
  seenUnlock: false,
  calAdded: [],
  personal: [],
  calColors: {},
  calHidden: [],
  teams: mock.seedTeams,
  scores: mock.seedScores,
  decisions: {},
  clubSettings: {},
  interviews: {},
});

interface AppState extends Persisted {
  ready: boolean;
  clubs: Club[];
  events: ClubEvent[];
  matches: Match[]; // empty until the profile is complete
  profileDone: boolean;
  profileProgress: number; // 0–1
  clubById: (id: string) => Club | undefined;
  updateProfile: (patch: Partial<Student>) => void;
  addClub: (id: string) => void;
  removeClub: (id: string) => void;
  saveDraft: (clubId: string, draft: Draft) => void;
  submit: (clubId: string) => Promise<void>;
  setStatus: (clubId: string, status: AppStatus) => void;
  toggleReminder: (clubId: string) => void;
  markUnlockSeen: () => void;
  reset: () => void;
  signUpStudent: (p: Pick<Student, "name" | "preferredName" | "pronouns" | "email" | "uscId" | "gradTerm" | "year">) => void;
  signUpOfficer: (a: Omit<Account, "role" | "verified">) => void;
  signIn: (email: string) => Account | null;
  signOut: () => void;
  submitWithId: (clubId: string, shareId: boolean) => Promise<void>;
  // calendar
  toggleCalEvent: (eventId: string) => void;
  addPersonal: (e: Omit<PersonalEvent, "id">) => void;
  removePersonal: (id: string) => void;
  setCalColor: (key: string, color: string) => void;
  toggleCalHidden: (key: string) => void;
  // club side
  myMembership: TeamMember | null;
  setScore: (applicationId: string, criterion: string, value: number) => void;
  decide: (applicationId: string, d: Decision) => void;
  scheduleInterview: (i: Omit<Interview, "invitedAt" | "booked">) => void;
  bookInterview: (applicationId: string, slot: string | null) => void;
  demoInterview: (clubId: string) => void;
  inviteMember: (email: string, name: string, officerRole: string) => string | null;
  approveMember: (email: string) => void;
  removeMember: (email: string) => void;
  setClubSetting: (clubId: string, patch: ClubSettings) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [p, setP] = useState<Persisted>(() => ({ ...initial(), ...store.get<Partial<Persisted>>("state-v4", {}) }));

  useEffect(() => {
    (async () => {
      const [c, e, m] = await Promise.all([api.clubs(), api.events(), api.matches(p.profile.id)]);
      setClubs(c);
      setEvents(e);
      setAllMatches(m);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    store.set("state-v4", p);
  }, [p]);

  const done = PROFILE_SECTIONS.filter((s) => s.done(p.profile)).length;
  const profileDone = done === PROFILE_SECTIONS.length;

  const mergedClubs = useMemo(() => clubs.map((c) => ({ ...c, ...p.clubSettings[c.id] })), [clubs, p.clubSettings]);
  const myMembership =
    p.account?.role === "officer" && p.account.clubId
      ? (p.teams[p.account.clubId] ?? []).find((m) => m.email === p.account!.email) ?? null
      : null;

  const doSubmit = async (clubId: string, shareId: boolean) => {
    const club = mergedClubs.find((c) => c.id === clubId);
    const draft = p.drafts[clubId] ?? {};
    if (!club) return;
    const answers = club.questions.map((q) => ({ questionId: q.id, text: (draft[q.id] ?? "").trim() }));
    const app = await api.submitApplication(clubId, answers);
    const entries: AnswerBankEntry[] = club.questions.map((q) => ({
      id: `ab_${q.id}`,
      prompt: q.prompt,
      text: (draft[q.id] ?? "").trim(),
      fromClubId: clubId,
    }));
    setP((s) => ({
      ...s,
      apps: { ...s.apps, [clubId]: { status: "submitted", submittedAt: app.submittedAt, sharedUscId: shareId || undefined } },
      answerBank: [...entries, ...s.answerBank.filter((b) => !entries.some((e) => e.id === b.id))],
    }));
  };

  const value = useMemo<AppState>(
    () => ({
      ...p,
      ready,
      clubs: mergedClubs,
      myMembership,
      events,
      matches: profileDone ? allMatches : [],
      profileDone,
      profileProgress: done / PROFILE_SECTIONS.length,
      clubById: (id) => mergedClubs.find((c) => c.id === id),
      updateProfile: (patch) => setP((s) => ({ ...s, profile: { ...s.profile, ...patch } })),
      addClub: (id) =>
        setP((s) =>
          s.myClubs.includes(id) ? s : { ...s, myClubs: [...s.myClubs, id], reminders: [...new Set([...s.reminders, id])] },
        ),
      removeClub: (id) => setP((s) => ({ ...s, myClubs: s.myClubs.filter((x) => x !== id) })),
      saveDraft: (clubId, draft) => setP((s) => ({ ...s, drafts: { ...s.drafts, [clubId]: draft } })),
      submit: (clubId) => doSubmit(clubId, false),
      submitWithId: (clubId, shareId) => doSubmit(clubId, shareId),
      setStatus: (clubId, status) => setP((s) => ({ ...s, apps: { ...s.apps, [clubId]: { ...s.apps[clubId], status } } })),
      toggleReminder: (id) =>
        setP((s) => ({ ...s, reminders: s.reminders.includes(id) ? s.reminders.filter((x) => x !== id) : [...s.reminders, id] })),
      markUnlockSeen: () => setP((s) => ({ ...s, seenUnlock: true })),
      reset: () => setP(initial()),
      signUpStudent: (info) =>
        setP((s) => {
          const account: Account = { role: "student", name: info.name, email: info.email.toLowerCase() };
          return { ...initial(), accounts: { ...s.accounts, [account.email]: account }, account, profile: { ...mock.student, ...info, email: account.email } };
        }),
      signUpOfficer: (info) =>
        setP((s) => {
          // Verified instantly if Campus Activities' roster lists this email for the club, or if
          // a club admin already invited it. Otherwise: pending until a club admin approves.
          const email = info.email.toLowerCase();
          const clubId = info.clubId ?? "";
          const team = s.teams[clubId] ?? [];
          const invited = team.find((m) => m.email === email && m.status === "invited");
          const onRoster = (mock.OFFICER_ROSTER[clubId] ?? []).includes(email);
          const verified = !VERIFY_OFFICERS || onRoster || !!invited;
          const member: TeamMember = {
            email,
            name: info.name,
            officerRole: info.officerRole ?? "Officer",
            access: !VERIFY_OFFICERS ? "admin" : invited?.access ?? (team.some((m) => m.status === "active") ? "reviewer" : "admin"),
            status: verified ? "active" : "pending",
          };
          const account: Account = { ...info, role: "officer", email, verified };
          return {
            ...s,
            accounts: { ...s.accounts, [email]: account },
            account,
            teams: { ...s.teams, [clubId]: [...team.filter((m) => m.email !== email), member] },
          };
        }),
      signIn: (email) => {
        const found = p.accounts[email.trim().toLowerCase()] ?? null;
        if (found) setP((s) => ({ ...s, account: found }));
        return found;
      },
      signOut: () => setP((s) => ({ ...s, account: null })),

      toggleCalEvent: (id) => setP((s) => ({ ...s, calAdded: s.calAdded.includes(id) ? s.calAdded.filter((x) => x !== id) : [...s.calAdded, id] })),
      addPersonal: (e) => setP((s) => ({ ...s, personal: [...s.personal, { ...e, id: `pe_${Date.now()}` }] })),
      removePersonal: (id) => setP((s) => ({ ...s, personal: s.personal.filter((x) => x.id !== id) })),
      setCalColor: (key, color) => setP((s) => ({ ...s, calColors: { ...s.calColors, [key]: color } })),
      toggleCalHidden: (key) => setP((s) => ({ ...s, calHidden: s.calHidden.includes(key) ? s.calHidden.filter((x) => x !== key) : [...s.calHidden, key] })),

      setScore: (appId, criterion, v) =>
        setP((s) => {
          const me = s.account?.email ?? "";
          const mine = s.scores[appId]?.[me] ?? {};
          return { ...s, scores: { ...s.scores, [appId]: { ...s.scores[appId], [me]: { ...mine, [criterion]: v } } } };
        }),
      decide: (appId, d) =>
        setP((s) => {
          // If this is the signed-in student's own application, their status updates too.
          const clubId = clubOfMyApp(appId);
          const status: AppStatus = d === "accept" ? "accepted" : d === "decline" ? "rejected" : "interview";
          const apps = clubId && s.apps[clubId] ? { ...s.apps, [clubId]: { ...s.apps[clubId], status } } : s.apps;
          return { ...s, apps, decisions: { ...s.decisions, [appId]: d } };
        }),
      scheduleInterview: (i) =>
        setP((s) => {
          const clubId = clubOfMyApp(i.applicationId);
          const apps = clubId && s.apps[clubId] ? { ...s.apps, [clubId]: { ...s.apps[clubId], status: "interview" as AppStatus } } : s.apps;
          return {
            ...s,
            apps,
            decisions: { ...s.decisions, [i.applicationId]: "advance" },
            interviews: { ...s.interviews, [i.applicationId]: { ...i, invitedAt: new Date().toISOString() } },
          };
        }),
      bookInterview: (appId, slot) =>
        setP((s) => {
          const iv = s.interviews[appId];
          if (!iv) return s;
          const link = slot && iv.format !== "in-person" ? iv.link ?? meetingLink(iv.format, appId + slot) : iv.link;
          return { ...s, interviews: { ...s.interviews, [appId]: { ...iv, booked: slot ?? undefined, link: slot ? link : iv.link } } };
        }),
      demoInterview: (clubId) =>
        setP((s) => {
          const appId = myAppId(clubId);
          const day = (d: number, h: number) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00`;
          const iv: Interview = { applicationId: appId, clubId, format: "zoom", slots: [day(17, 16), day(18, 12), day(19, 18)], durationMin: 20, note: "A quick chat with two board members. No prep needed.", invitedAt: new Date().toISOString() };
          return {
            ...s,
            apps: { ...s.apps, [clubId]: { ...s.apps[clubId], status: "interview" } },
            decisions: { ...s.decisions, [appId]: "advance" },
            interviews: { ...s.interviews, [appId]: iv },
          };
        }),
      inviteMember: (email, name, officerRole) => {
        const e = email.trim().toLowerCase();
        const clubId = p.account?.clubId;
        if (!clubId) return "Not signed in to a club.";
        if (!/^[a-z0-9._%+-]+@usc\.edu$/.test(e)) return "Invite their @usc.edu email.";
        if ((p.teams[clubId] ?? []).some((m) => m.email === e)) return "They're already on your team.";
        setP((s) => ({
          ...s,
          teams: { ...s.teams, [clubId]: [...(s.teams[clubId] ?? []), { email: e, name: name.trim() || e, officerRole: officerRole || "Officer", access: "reviewer", status: "invited" }] },
        }));
        return null;
      },
      approveMember: (email) =>
        setP((s) => {
          const clubId = s.account?.clubId ?? "";
          const accounts = s.accounts[email] ? { ...s.accounts, [email]: { ...s.accounts[email], verified: true } } : s.accounts;
          return {
            ...s,
            accounts,
            teams: { ...s.teams, [clubId]: (s.teams[clubId] ?? []).map((m) => (m.email === email ? { ...m, status: "active" } : m)) },
          };
        }),
      removeMember: (email) =>
        setP((s) => {
          const clubId = s.account?.clubId ?? "";
          return { ...s, teams: { ...s.teams, [clubId]: (s.teams[clubId] ?? []).filter((m) => m.email !== email) } };
        }),
      setClubSetting: (clubId, patch) => setP((s) => ({ ...s, clubSettings: { ...s.clubSettings, [clubId]: { ...s.clubSettings[clubId], ...patch } } })),
    }),
    [p, ready, mergedClubs, myMembership, events, allMatches, profileDone, done],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

/** Where a club application stands, Common App style. */
export function appState(s: Pick<AppState, "apps" | "drafts">, club: Club) {
  const app = s.apps[club.id];
  if (app && app.status !== "draft") return { label: statusLabel(app.status), status: app.status, answered: club.questions.length };
  const draft = s.drafts[club.id] ?? {};
  const answered = club.questions.filter((q) => (draft[q.id] ?? "").trim()).length;
  return { label: answered === 0 ? "Not started" : "In progress", status: "draft" as AppStatus, answered };
}

export function statusLabel(s: AppStatus) {
  return { draft: "In progress", submitted: "Submitted", interview: "Interview", accepted: "Accepted", rejected: "Not this time" }[s];
}
