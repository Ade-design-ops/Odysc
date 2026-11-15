// Club side. Officers only get in once verified: their email is on the club's officer
// roster from Campus Activities, or a club admin approves them. Inside, the e-board reviews
// together: everyone scores on the same rubric, OdySC averages the scores and flags a
// reviewer who grades far off from the rest. Admins invite reviewers, decide, and choose
// whether the club needs USC IDs (students must agree before theirs is shared).
import { useEffect, useMemo, useState } from "react";
import type { Applicant, Club, TeamMember } from "../../../shared/types";
import { api } from "../api";
import HomeBand from "../components/HomeBand";
import { Loading, Toast, useToast } from "../components/ui";
import { OFFICER_ROLES } from "../data/mock";
import { FormatIcon, InterviewStatus, ScheduleModal } from "../components/Interview";
import { VERIFY_OFFICERS, myAppId, useApp, type Decision } from "../store";
import { fmtDate } from "../util";

const CRITERIA = ["Motivation", "Experience", "Community impact"];
const INJECTION = /(ignore (all |your )?(previous|prior) instructions|rate this applicant|system prompt)/i;
type Tab = "applicants" | "team" | "settings";

function Highlight({ text }: { text: string }) {
  const m = text.match(/[^.]*(ignore (all |your )?(previous|prior) instructions|rate this applicant)[^.]*\.?/i);
  if (!m || m.index === undefined) return <>{text}</>;
  return (
    <>
      {text.slice(0, m.index)}
      <mark className="inject">{m[0]}</mark>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const total = (s?: Record<string, number>) => (s ? avg(CRITERIA.map((c) => s[c]).filter((n): n is number => typeof n === "number")) : 0);

export default function OrgDashboard() {
  const s = useApp();
  const { ready, clubById, account, myMembership, teams } = s;
  const clubId = account?.clubId ?? "nsbe";
  const club = clubById(clubId);
  const [list, setList] = useState<Applicant[] | null>(null);
  const [tab, setTab] = useState<Tab>("applicants");

  useEffect(() => {
    api.applicants(clubId).then(setList);
  }, [clubId]);

  if (!ready || !club) return <Loading />;
  if (VERIFY_OFFICERS && (!myMembership || myMembership.status !== "active")) return <Pending clubName={club.name} admins={(teams[clubId] ?? []).filter((m) => m.access === "admin" && m.status === "active")} />;
  if (!list) return <Loading />;
  const mine = ownApplication(clubId, club, s);
  const all = mine ? [mine, ...list] : list;

  const isAdmin = !VERIFY_OFFICERS || myMembership?.access === "admin";
  const team = teams[clubId] ?? [];
  const waiting = team.filter((m) => m.status === "pending").length;
  const first = (account?.name ?? "").split(" ")[0];

  return (
    <>
      <HomeBand
        kicker={`${club.shortName} · ${myMembership?.officerRole ?? account?.officerRole ?? "Officer"}`}
        title={<>Hey {first}, <em>{all.length} applicants</em> are waiting on your e-board.</>}
        sub={`Fall recruiting · ${team.filter((m) => m.status === "active").length} reviewers · ${isAdmin ? "You're an admin" : "You can score applicants"}`}
      >
        <div className="stat-chips">
          <StatChip n={all.length} label="Applied" />
          <ScoredChip list={all} />
          <StatChip n={waiting} label="Officers waiting" />
        </div>
      </HomeBand>

      <div className="org-tabs" role="tablist" aria-label="Club dashboard">
        {(["applicants", "team", ...(isAdmin ? ["settings"] : [])] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "applicants" ? "Applicants" : t === "team" ? "E-board" : "Settings"}
            {t === "team" && waiting > 0 && isAdmin && <span className="badge">{waiting}</span>}
          </button>
        ))}
      </div>

      {tab === "applicants" && <Applicants list={all} clubId={clubId} isAdmin={isAdmin} />}
      {tab === "team" && <Team clubId={clubId} isAdmin={isAdmin} />}
      {tab === "settings" && isAdmin && <Settings clubId={clubId} />}
    </>
  );
}

/** The student signed in on this browser applied to this club: show their real application. */
function ownApplication(clubId: string, club: Club, s: ReturnType<typeof useApp>): Applicant | null {
  const app = s.apps[clubId];
  if (!app || app.status === "draft" || !s.profile.name) return null;
  const p = s.profile;
  const draft = s.drafts[clubId] ?? {};
  const first = p.preferredName || p.name.split(" ")[0];
  return {
    applicationId: myAppId(clubId),
    name: p.name,
    preferredName: p.preferredName,
    email: p.email,
    verifiedStudent: true,
    pronouns: p.pronouns,
    major: p.major,
    year: p.year,
    gradTerm: p.gradTerm,
    skills: p.skills,
    interests: p.interests,
    experiences: p.experiences.filter((e) => e.trim()),
    submittedAt: app.submittedAt,
    uscId: club.requiresUscId && app.sharedUscId ? p.uscId : undefined,
    answers: club.questions.map((q) => ({ prompt: q.prompt, text: (draft[q.id] ?? "").trim() })),
    summary: {
      summary: `${first} is a ${p.major || "USC"} student${p.skills.length ? ` with ${p.skills.slice(0, 3).join(", ")}` : ""}. Answered all ${club.questions.length} questions.`,
      evidence: [p.experiences.find((e) => e.trim())?.slice(0, 60), p.interests[0] && `Interested in ${p.interests[0]}`].filter((x): x is string => !!x),
      injectionFlag: false,
    },
  } as Applicant;
}

function StatChip({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="stat-chip">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}
function ScoredChip({ list }: { list: Applicant[] }) {
  const { scores, account } = useApp();
  const me = account?.email ?? "";
  const n = list.filter((a) => CRITERIA.every((c) => scores[a.applicationId]?.[me]?.[c])).length;
  return <StatChip n={`${n}/${list.length}`} label="You've scored" />;
}

/* ---------- not verified yet ---------- */
function Pending({ clubName, admins }: { clubName: string; admins: TeamMember[] }) {
  const { account, signOut } = useApp();
  return (
    <div className="pending-wrap">
      <div className="card pending-card">
        <div className="lock" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48"><rect x="10" y="21" width="28" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M16 21v-6a8 8 0 0 1 16 0v6" fill="none" stroke="currentColor" strokeWidth="2.5" /><circle cx="24" cy="31" r="2.5" fill="currentColor" /></svg>
        </div>
        <h1 className="h2">You're on the waitlist for {clubName}</h1>
        <p className="subtle">
          We couldn't find <strong>{account?.email}</strong> on {clubName}'s officer list from Campus Activities, so a club admin
          has to confirm you're on the e-board. Until then you can't see applicants. That keeps anyone from claiming a board seat.
        </p>
        <ol className="pending-steps">
          <li className="done">Account created</li>
          <li className="now">Waiting for a {clubName} admin{admins.length ? ` (${admins.map((a) => a.name).join(" or ")})` : ""} to approve you</li>
          <li>Review applicants with your e-board</li>
        </ol>
        <p className="subtle" style={{ fontSize: 14 }}>Faster: ask your president to invite this email from their E-board tab, or update your club's officer list on EngageSC.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

/* ---------- applicants ---------- */
function Applicants({ list, clubId, isAdmin }: { list: Applicant[]; clubId: string; isAdmin: boolean }) {
  const { scores, setScore, decide, decisions, account, teams, clubById, interviews } = useApp();
  const [scheduling, setScheduling] = useState(false);
  const club = clubById(clubId)!;
  const [sel, setSel] = useState(0);
  const [blind, setBlind] = useState(false);
  const toast = useToast();
  const me = account?.email ?? "";
  const team = teams[clubId] ?? [];
  const nameOf = (email: string) => team.find((m) => m.email === email)?.name ?? email;

  // Reviewer bias: how far each reviewer's average sits from everyone else's.
  const bias = useMemo(() => {
    const byReviewer: Record<string, number[]> = {};
    for (const a of list) for (const [r, s] of Object.entries(scores[a.applicationId] ?? {})) if (total(s)) (byReviewer[r] ??= []).push(total(s));
    const out: Record<string, number> = {};
    for (const r of Object.keys(byReviewer)) {
      const others = Object.entries(byReviewer).filter(([k]) => k !== r).flatMap(([, v]) => v);
      if (Object.keys(byReviewer).length >= 3 && others.length && byReviewer[r].length >= 2) out[r] = avg(byReviewer[r]) - avg(others);
    }
    return out;
  }, [list, scores]);

  const a = list[sel];
  const flagged = a.summary.injectionFlag || a.answers.some((x) => INJECTION.test(x.text));
  const mine = scores[a.applicationId]?.[me] ?? {};
  const all = Object.entries(scores[a.applicationId] ?? {}).filter(([, s]) => total(s) > 0);
  const label = (x: Applicant, i: number) => (blind ? `Applicant ${i + 1}` : x.preferredName ? `${x.preferredName} ${x.name.split(" ").slice(-1)[0]}` : x.name);
  const teamAvg = avg(all.map(([, s]) => total(s)));

  const iv = interviews[a.applicationId];
  const decision = decisions[a.applicationId];
  const doDecide = (d: Decision) => {
    decide(a.applicationId, d);
    toast.show(d === "accept" ? `${label(a, sel)} is in. They'll see it in OdySC and get an email.` : d === "advance" ? `${label(a, sel)} moved to interviews.` : `Declined. ${label(a, sel)} gets Free Agent suggestions for similar clubs.`);
  };

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 14, gap: 12 }}>
        <p className="subtle" style={{ margin: 0 }}>{Object.keys(decisions).filter((k) => list.some((x) => x.applicationId === k)).length} of {list.length} decided</p>
        <label className="toggle" title="Hide names, emails and majors while you score">
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          Blind review
        </label>
      </div>
      <div className="org-layout">
        <aside className="card" style={{ padding: 8, alignSelf: "start" }}>
          {list.map((x, i) => {
            const d = decisions[x.applicationId];
            const scoredIt = CRITERIA.every((c) => scores[x.applicationId]?.[me]?.[c]);
            const t = scoredIt ? avg(Object.values(scores[x.applicationId] ?? {}).map(total).filter(Boolean)) : 0;
            return (
              <button key={x.applicationId} className={`applicant ${i === sel ? "active" : ""}`} onClick={() => setSel(i)}>
                <div className="row between">
                  <span style={{ fontWeight: 600 }}>{label(x, i)}</span>
                  {d ? <span className={`pill ${d === "decline" ? "" : d === "accept" ? "ok" : "gold"}`}>{d === "accept" ? "Accepted" : d === "decline" ? "Declined" : interviews[x.applicationId]?.booked ? "Booked" : "Interview"}</span>
                    : x.summary.injectionFlag ? <span className="pill cardinal">Flag</span> : null}
                </div>
                <div className="subtle">{blind ? `Year ${x.year}` : `${x.major} · Year ${x.year}`}{t ? ` · ${t.toFixed(1)} avg` : ""}</div>
              </button>
            );
          })}
        </aside>

        <section style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div className="row between wrap" style={{ gap: 10 }}>
              <div>
                <h2 className="h3" style={{ margin: 0 }}>{label(a, sel)}</h2>
                {!blind && <p className="subtle" style={{ margin: "4px 0 0" }}>{[a.pronouns, a.major, `Year ${a.year}`, a.gradTerm && `Graduates ${a.gradTerm}`].filter(Boolean).join(" · ")}</p>}
              </div>
              {a.verifiedStudent && <span className="pill ok">Verified USC student</span>}
            </div>

            {blind ? (
              <p className="subtle" style={{ margin: "10px 0 0" }}>Name, email and major are hidden while blind review is on.</p>
            ) : (
              <dl className="kv">
                {a.preferredName && <><dt>Goes by</dt><dd>{a.preferredName}</dd></>}
                <dt>Email</dt><dd><a className="text-link" href={`mailto:${a.email}`}>{a.email}</a></dd>
                {a.submittedAt && <><dt>Applied</dt><dd>{fmtDate(a.submittedAt)}</dd></>}
                {club.requiresUscId && <><dt>USC ID</dt><dd>{a.uscId ?? <span className="subtle">Not shared (applied before you required it)</span>}</dd></>}
              </dl>
            )}

            {!blind && (a.skills?.length || a.interests?.length) ? (
              <div className="tagrows">
                {a.skills?.length ? <div><span className="subtle">Skills</span><div className="row wrap" style={{ gap: 6 }}>{a.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div></div> : null}
                {a.interests?.length ? <div><span className="subtle">Interests</span><div className="row wrap" style={{ gap: 6 }}>{a.interests.map((s) => <span key={s} className="chip">{s}</span>)}</div></div> : null}
              </div>
            ) : null}
            {!blind && a.experiences?.length ? (
              <details className="more-info">
                <summary>Experience ({a.experiences.length})</summary>
                <ul>{a.experiences.map((x) => <li key={x}>{x}</li>)}</ul>
              </details>
            ) : null}

            {flagged && (
              <div className="alert danger" style={{ marginTop: 14 }} role="alert">
                <strong>Possible prompt injection.</strong> This application contains text that tries to instruct the AI reviewer.
                OdySC ignored it, and the summary below uses only the applicant's actual answers. It's highlighted below.
              </div>
            )}

            <div className="ai-box">
              <div className="row between">
                <span style={{ fontWeight: 600, fontSize: 14 }}>AI summary</span>
                <span className="subtle">Suggests · never decides</span>
              </div>
              <p style={{ margin: "6px 0 10px", fontSize: 14 }}>{a.summary.summary}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                {a.summary.evidence.map((e) => <span key={e} className="chip">Evidence: {e}</span>)}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="h3">Answers</h2>
            {a.answers.map((x) => (
              <div key={x.prompt} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                <div className="subtle">{x.prompt}</div>
                <p style={{ margin: "4px 0 0" }}><Highlight text={x.text} /></p>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="row between wrap">
              <h2 className="h3">Your scores</h2>
              <span className="subtle">Score first. The board's scores unlock after, so nobody anchors on anyone else.</span>
            </div>
            {CRITERIA.map((c) => (
              <div key={c} className="row between" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <span style={{ fontSize: 14 }}>{c}</span>
                <div className="rubric" role="radiogroup" aria-label={c}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={mine[c] === n} className={mine[c] === n ? "on" : ""} onClick={() => setScore(a.applicationId, c, n)}>{n}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="row between wrap">
              <h2 className="h3">E-board scores</h2>
              {teamAvg > 0 && CRITERIA.every((c) => mine[c]) && <span className="team-avg"><strong>{teamAvg.toFixed(1)}</strong> / 5 team average</span>}
            </div>
            {all.length === 0 && <p className="subtle">No one has scored this applicant yet.</p>}
            {all.map(([r, s]) => {
              const b = bias[r];
              const off = b !== undefined && Math.abs(b) >= 0.8;
              const hide = r !== me && !CRITERIA.every((c) => mine[c]);
              return (
                <div key={r} className="reviewer-row">
                  <span className="avatar" aria-hidden="true">{nameOf(r).split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r === me ? "You" : nameOf(r)}</div>
                    {off && <div className="bias-note">Scores {Math.abs(b).toFixed(1)} {b < 0 ? "lower" : "higher"} than the rest of the board on average</div>}
                  </div>
                  <div className="score-bars" aria-label={hide ? "Hidden until you score" : CRITERIA.map((c) => `${c} ${s[c] ?? "-"}`).join(", ")}>
                    {hide ? <span className="subtle">Hidden until you score</span> : CRITERIA.map((c) => (
                      <span key={c} title={`${c}: ${s[c] ?? "-"}`}><i style={{ width: `${((s[c] ?? 0) / 5) * 100}%` }} /></span>
                    ))}
                  </div>
                  <strong className="score-total">{hide ? "–" : total(s).toFixed(1)}</strong>
                </div>
              );
            })}
            {iv && <InterviewStatus iv={iv} name={blind ? "the applicant" : a.preferredName || a.name} onEdit={() => setScheduling(true)} />}
            <div className="decide-row">
              {isAdmin ? (
                <>
                  {decision === "accept" || decision === "decline" ? (
                    <span className="subtle">{decision === "accept" ? "Accepted." : "Declined."} <button className="link-act" onClick={() => decide(a.applicationId, "advance")}>Undo</button></span>
                  ) : iv ? (
                    <>
                      <button className="btn primary" onClick={() => doDecide("accept")}>Accept</button>
                      <button className="btn" onClick={() => doDecide("decline")}>Decline</button>
                    </>
                  ) : (
                    <>
                      <button className="btn primary" onClick={() => setScheduling(true)}>Invite to interview</button>
                      <button className="btn" onClick={() => doDecide("accept")}>Accept</button>
                      <button className="btn" onClick={() => doDecide("decline")}>Decline</button>
                    </>
                  )}
                  <span className="subtle" style={{ fontSize: 13, flexBasis: "100%" }}>Declined students get suggestions for similar clubs that are still open.</span>
                </>
              ) : (
                <span className="subtle">Only club admins can make the final call. Your scores go into the team average.</span>
              )}
            </div>
          </div>
        </section>
      </div>
      {scheduling && (
        <ScheduleModal
          appId={a.applicationId}
          clubId={clubId}
          name={blind ? "this applicant" : a.preferredName ? `${a.preferredName} ${a.name.split(" ").slice(-1)[0]}` : a.name}
          existing={iv}
          onClose={() => setScheduling(false)}
          onSent={() => { setScheduling(false); toast.show(`Invite sent. ${blind ? "They" : a.preferredName || a.name.split(" ")[0]} picks a time in OdySC and gets an email.`); }}
        />
      )}
      <Toast message={toast.msg} onDone={toast.clear} />
    </>
  );
}

/* ---------- team ---------- */
function Team({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const { teams, approveMember, removeMember, inviteMember, account } = useApp();
  const team = teams[clubId] ?? [];
  const [f, setF] = useState({ email: "", name: "", role: "Vice President" });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const pending = team.filter((m) => m.status === "pending");
  const rest = team.filter((m) => m.status !== "pending");

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const r = inviteMember(f.email, f.name, f.role);
    setErr(r);
    if (!r) { toast.show(`Invite sent to ${f.email.trim()}. They can review as soon as they sign up.`); setF({ email: "", name: "", role: "Vice President" }); }
  };

  return (
    <div className="team-grid">
      <div style={{ display: "grid", gap: 16 }}>
        {isAdmin && pending.length > 0 && (
          <div className="card pending-list">
            <h2 className="h3">Asking to join</h2>
            <p className="subtle" style={{ marginTop: 0 }}>These people aren't on your officer list from Campus Activities. Only approve people you know are on your board.</p>
            {pending.map((m) => (
              <div key={m.email} className="member-row">
                <span className="avatar" aria-hidden="true">{m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div className="subtle">Says they're {m.officerRole} · {m.email}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => { approveMember(m.email); toast.show(`${m.name} can now review applicants.`); }}>Approve</button>
                  <button className="btn sm ghost" onClick={() => removeMember(m.email)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="card">
          <h2 className="h3">Your e-board on OdySC</h2>
          {rest.map((m) => (
            <div key={m.email} className="member-row">
              <span className="avatar" aria-hidden="true">{m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{m.name}{m.email === account?.email ? " (you)" : ""}</div>
                <div className="subtle">{m.officerRole} · {m.email}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {m.status === "invited" ? <span className="pill gold">Invited</span> : <span className={`pill ${m.access === "admin" ? "cardinal" : ""}`}>{m.access === "admin" ? "Admin" : "Reviewer"}</span>}
                {isAdmin && m.email !== account?.email && <button className="btn sm ghost" onClick={() => removeMember(m.email)} aria-label={`Remove ${m.name}`}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        {isAdmin ? (
          <form className="card" onSubmit={invite} noValidate>
            <h2 className="h3">Invite a reviewer</h2>
            <p className="subtle" style={{ marginTop: 0 }}>They'll score applicants alongside you. Use their USC email so we know it's really them.</p>
            <label className="field" htmlFor="inv-email">USC email <span className="req">*</span></label>
            <input id="inv-email" className="input" type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setErr(null); }} placeholder="ttrojan@usc.edu" aria-invalid={!!err} />
            {err && <p className="field-error" role="alert">{err}</p>}
            <label className="field" htmlFor="inv-name" style={{ marginTop: 12 }}>Name</label>
            <input id="inv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tommy Trojan" />
            <label className="field" htmlFor="inv-role" style={{ marginTop: 12 }}>Role</label>
            <select id="inv-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {OFFICER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn primary" type="submit" style={{ marginTop: 16, width: "100%" }}>Send invite</button>
          </form>
        ) : (
          <div className="card"><p className="subtle" style={{ margin: 0 }}>Ask a club admin if someone else on your board should be reviewing.</p></div>
        )}
        <div className="card how-verify">
          <h2 className="h3">How we check officers</h2>
          <ul>
            <li><strong>On the officer list?</strong> If your email is on your club's officer list from Campus Activities, you're in right away.</li>
            <li><strong>Invited by an admin?</strong> You're in when you sign up with that email.</li>
            <li><strong>Neither?</strong> You wait until an admin approves you.</li>
          </ul>
        </div>
      </div>
      <Toast message={toast.msg} onDone={toast.clear} />
    </div>
  );
}

/* ---------- settings ---------- */
function Settings({ clubId }: { clubId: string }) {
  const { clubById, setClubSetting } = useApp();
  const club = clubById(clubId)!;
  const [reason, setReason] = useState(club.uscIdReason ?? "");
  const [saved, setSaved] = useState(false);
  const on = !!club.requiresUscId;
  const tooShort = on && reason.trim().length < 15;
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 680 }}>
    <div className="card settings-card">
      <h2 className="h3">Interview video calls</h2>
      <p className="subtle">Connect your club's account once. When a student books an interview, OdySC creates the meeting and emails the link to both of you.</p>
      {([["zoom", "Zoom", club.zoomConnected], ["teams", "Microsoft Teams", club.teamsConnected]] as const).map(([id, name, on]) => (
        <div key={id} className="integration-row">
          <span className="iv-ico"><FormatIcon format={id} /></span>
          <div style={{ minWidth: 0 }}>
            <strong>{name}</strong>
            <div className="subtle" style={{ fontSize: 14 }}>{on ? "Connected. New interviews get their own meeting link." : "Not connected. You can still paste a link per interview."}</div>
          </div>
          <button className={`btn sm ${on ? "ghost" : "primary"}`} onClick={() => setClubSetting(clubId, id === "zoom" ? { zoomConnected: !on } : { teamsConnected: !on })}>{on ? "Disconnect" : "Connect"}</button>
        </div>
      ))}
      <p className="subtle" style={{ fontSize: 13, margin: "10px 0 0" }}>Google Meet links are created automatically. In-person interviews just need a room.</p>
    </div>
    <div className="card settings-card">
      <h2 className="h3">USC ID</h2>
      <p className="subtle">Student IDs are private by default. Nobody, including your e-board, sees them. Only turn this on if you truly need IDs (for example a background check or a building access list).</p>
      <label className="switch-row">
        <input type="checkbox" checked={on} onChange={(e) => { setClubSetting(clubId, { requiresUscId: e.target.checked }); setSaved(false); }} />
        <span><strong>Ask applicants for their USC ID</strong><br /><span className="subtle">Students see your reason and must agree before applying. You'll only see IDs from students who agreed.</span></span>
      </label>
      {on && (
        <div className="reveal" style={{ marginTop: 14 }}>
          <label className="field" htmlFor="id-reason">Why you need it <span className="req">*</span></label>
          <textarea id="id-reason" className="input" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setSaved(false); }} placeholder="e.g. Our venue needs a list of USC IDs for building access." aria-invalid={saved && tooShort} />
          {tooShort && <p className="subtle" style={{ fontSize: 13 }}>Write at least a full sentence. Students read this before deciding.</p>}
          <button className="btn primary" style={{ marginTop: 10 }} disabled={tooShort} onClick={() => { setClubSetting(clubId, { uscIdReason: reason.trim() }); setSaved(true); }}>Save reason</button>
          {saved && <span className="subtle" style={{ marginLeft: 10 }} role="status">Saved</span>}
        </div>
      )}
    </div>
    </div>
  );
}
