// Club access comes from active server-side membership approved by a club admin.
// Inside, the e-board reviews
// together: everyone scores on the same rubric, OdySC averages the scores and flags a
// reviewer who grades far off from the rest. Admins invite reviewers, decide, and choose
// whether the club needs USC IDs (students must agree before theirs is shared).
import { useEffect, useMemo, useState } from "react";
import type { Applicant, TeamMember } from "../../../shared/types";
import { api } from "../api";
import HomeBand from "../components/HomeBand";
import ClubEvents from "../components/ClubEvents";
import RecruitingTimeline from "../components/RecruitingTimeline";
import { Loading, Toast, useToast } from "../components/ui";
import { OFFICER_ROLES } from "../data/reference";
import { FormatIcon, InterviewStatus, ScheduleModal } from "../components/Interview";
import { useApp, type Decision } from "../store";
import { fmtDate } from "../util";

const CRITERIA = ["Motivation", "Experience", "Community impact"];
const INJECTION = /(ignore (all |your )?(previous|prior) instructions|rate this applicant|system prompt)/i;
type Tab = "applicants" | "team" | "events" | "settings";
const academicYearLabel = (year: number) => year === 5 ? "Fifth year+" : year === 6 ? "Graduate" : year === 7 ? "Other" : year >= 1 && year <= 4 ? `Year ${year}` : "Year not provided";

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
  const clubId = account?.clubId ?? "";
  const club = clubById(clubId);
  const [list, setList] = useState<Applicant[] | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [tab, setTab] = useState<Tab>("applicants");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const accessKey = `${account?.email ?? ""}:${clubId}:${myMembership?.status ?? ""}`;

  useEffect(() => {
    let active = true;
    setList(null);
    setLoadedFor("");
    setLoadError("");
    if (ready && account?.role === "officer" && clubId && myMembership?.status === "active") {
      api.applicants(clubId).then((applicants) => { if (active) { setList(applicants); setLoadedFor(accessKey); } })
        .catch((failure: unknown) => { if (active) setLoadError(failure instanceof Error ? failure.message : "Applications could not be loaded."); });
    }
    return () => { active = false; };
  }, [ready, account?.role, clubId, myMembership?.status, accessKey, reload]);

  if (!ready) return <Loading />;
  if (!clubId || !club) return <div className="card"><h1 className="h2">Club access is not available</h1><p className="subtle">Your account does not have a club workspace available. Ask a club admin or the project operator to check your membership.</p></div>;
  if (!myMembership || myMembership.status !== "active") return <Pending clubName={club.name} admins={(teams[clubId] ?? []).filter((m) => m.access === "admin" && m.status === "active")} />;
  if (loadError) return <div className="card"><p className="field-error" role="alert">{loadError}</p><button className="btn primary" onClick={() => setReload((value) => value + 1)}>Try again</button></div>;
  if (!list || loadedFor !== accessKey) return <Loading />;
  const all = list;

  const isAdmin = myMembership.access === "admin";
  const selectedTab = tab === "settings" && !isAdmin ? "applicants" : tab;
  const team = teams[clubId] ?? [];
  const waiting = team.filter((m) => m.status === "pending").length;
  const first = (account?.name ?? "").split(" ")[0];

  return (
    <>
      <HomeBand
        kicker={`${club.shortName} · ${myMembership?.officerRole ?? account?.officerRole ?? "Officer"}`}
        title={<>Hey {first}, <em>{all.length} applicants</em> are waiting on your e-board.</>}
        sub={`Recruiting · ${team.filter((m) => m.status === "active").length} reviewers · ${isAdmin ? "You're an admin" : "You can score applicants"}`}
      >
        <div className="stat-chips">
          <StatChip n={all.length} label="Applied" />
          <ScoredChip list={all} />
          <StatChip n={waiting} label="Officers waiting" />
        </div>
      </HomeBand>

      <div className="org-tabs" role="tablist" aria-label="Club dashboard">
        {(["applicants", "team", "events", ...(isAdmin ? ["settings"] : [])] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={selectedTab === t} className={selectedTab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "applicants" ? "Applicants" : t === "team" ? "E-board" : t === "events" ? "Recruiting & events" : "Settings"}
            {t === "team" && waiting > 0 && isAdmin && <span className="badge">{waiting}</span>}
          </button>
        ))}
      </div>

      {selectedTab === "applicants" && <Applicants list={all} clubId={clubId} isAdmin={isAdmin} />}
      {selectedTab === "team" && <Team clubId={clubId} isAdmin={isAdmin} />}
      {selectedTab === "events" && (
        <div className="workspace-stack">
          <RecruitingTimeline key={`rt:${clubId}:${account?.email ?? ""}`} clubId={clubId} isAdmin={isAdmin} />
          <ClubEvents key={`${clubId}:${account?.email ?? ""}`} clubId={clubId} isAdmin={isAdmin} />
        </div>
      )}
      {selectedTab === "settings" && isAdmin && <Settings clubId={clubId} />}
    </>
  );
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
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="pending-wrap">
      <div className="card pending-card">
        <div className="lock" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48"><rect x="10" y="21" width="28" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M16 21v-6a8 8 0 0 1 16 0v6" fill="none" stroke="currentColor" strokeWidth="2.5" /><circle cx="24" cy="31" r="2.5" fill="currentColor" /></svg>
        </div>
        <h1 className="h2">You're on the waitlist for {clubName}</h1>
        <p className="subtle">
          The access request for <strong>{account?.email}</strong> needs approval from a club admin. Until your membership is active,
          you can't see applicants. Confirming a USC email does not grant club permissions.
        </p>
        <ol className="pending-steps">
          <li className="done">Account created</li>
          <li className="now">Waiting for a {clubName} admin{admins.length ? ` (${admins.map((a) => a.name).join(" or ")})` : ""} to approve you</li>
          <li>Review applicants with your e-board</li>
        </ol>
        <p className="subtle" style={{ fontSize: 14 }}>Ask an existing club admin to approve your request. If your club has no admin yet, contact the project operator to set up its first admin.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn" disabled={leaving} onClick={async () => {
          setLeaving(true);
          try { await signOut(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-out could not be completed."); }
          finally { setLeaving(false); }
        }}>{leaving ? "Signing out…" : "Sign out"}</button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  const activeIndex = Math.min(sel, Math.max(0, list.length - 1));
  const a = list[activeIndex];
  if (!a) return <div className="card"><h2 className="h3">No applications yet</h2><p className="subtle">Submitted applications will appear here. Your club's reviewers can score them once they arrive.</p></div>;
  const flagged = a.summary?.injectionFlag || a.answers.some((x) => INJECTION.test(x.text));
  const mine = scores[a.applicationId]?.[me] ?? {};
  const all = Object.entries(scores[a.applicationId] ?? {}).filter(([, s]) => total(s) > 0);
  const label = (x: Applicant, i: number) => (blind ? `Applicant ${i + 1}` : x.preferredName ? `${x.preferredName} ${x.name.split(" ").slice(-1)[0]}` : x.name);
  const teamAvg = avg(all.map(([, s]) => total(s)));

  const iv = interviews[a.applicationId];
  const decision = decisions[a.applicationId];
  const run = async (action: () => Promise<void>, notice?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); if (notice) toast.show(notice); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const doDecide = (d: Decision) => run(() => decide(a.applicationId, d), d === "accept" ? `${label(a, activeIndex)} was accepted in OdySC.` : d === "advance" ? `${label(a, activeIndex)} moved to interviews.` : "Application declined in OdySC.");

  return (
    <>
      {error && <p className="field-error" role="alert">{error}</p>}
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
              <button key={x.applicationId} className={`applicant ${i === activeIndex ? "active" : ""}`} onClick={() => setSel(i)}>
                <div className="row between">
                  <span style={{ fontWeight: 600 }}>{label(x, i)}</span>
                  {d ? <span className={`pill ${d === "decline" ? "" : d === "accept" ? "ok" : "gold"}`}>{d === "accept" ? "Accepted" : d === "decline" ? "Declined" : interviews[x.applicationId]?.booked ? "Booked" : "Interview"}</span>
                    : x.summary?.injectionFlag ? <span className="pill cardinal">Flag</span> : null}
                </div>
                <div className="subtle">{blind ? academicYearLabel(x.year) : `${x.major} · ${academicYearLabel(x.year)}`}{t ? ` · ${t.toFixed(1)} avg` : ""}</div>
              </button>
            );
          })}
        </aside>

        <section style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div className="row between wrap" style={{ gap: 10 }}>
              <div>
                <h2 className="h3" style={{ margin: 0 }}>{label(a, activeIndex)}</h2>
                {!blind && <p className="subtle" style={{ margin: "4px 0 0" }}>{[a.pronouns, a.major, academicYearLabel(a.year), a.gradTerm && `Graduates ${a.gradTerm}`].filter(Boolean).join(" · ")}</p>}
              </div>
              {a.verifiedUscEmail && <span className="pill ok">USC email confirmed</span>}
            </div>

            {blind ? (
              <p className="subtle" style={{ margin: "10px 0 0" }}>Identity fields are hidden. Written answers may still include identifying details.</p>
            ) : (
              <dl className="kv">
                {a.preferredName && <><dt>Goes by</dt><dd>{a.preferredName}</dd></>}
                <dt>Email</dt><dd><a className="text-link" href={`mailto:${a.email}`}>{a.email}</a></dd>
                {a.submittedAt && <><dt>Applied</dt><dd>{fmtDate(a.submittedAt)}</dd></>}
                {club.requiresUscId && <><dt>USC ID</dt><dd>{a.uscId ?? <span className="subtle">Not shared by this applicant</span>}</dd></>}
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
                Review the highlighted text and compare the summary with the submitted answers.
              </div>
            )}

            <div className="ai-box">
              <div className="row between">
                <span style={{ fontWeight: 600, fontSize: 14 }}>Application summary</span>
                <span className="subtle">Suggests · never decides</span>
              </div>
              <p style={{ margin: "6px 0 10px", fontSize: 14 }}>{a.summary?.summary || "A summary is not available. Review the submitted answers below."}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                {(a.summary?.evidence ?? []).map((e) => <span key={e} className="chip">Evidence: {e}</span>)}
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
                    <button key={n} role="radio" aria-checked={mine[c] === n} className={mine[c] === n ? "on" : ""} disabled={busy} onClick={() => { void run(() => setScore(a.applicationId, c, n)); }}>{n}</button>
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
            {iv && <InterviewStatus iv={iv} name={blind ? "the applicant" : a.preferredName || a.name} onEdit={isAdmin ? () => setScheduling(true) : undefined} />}
            <div className="decide-row">
              {isAdmin ? (
                <>
                  {decision === "accept" || decision === "decline" ? (
                    <span className="subtle">{decision === "accept" ? "Accepted." : "Declined."} <button className="link-act" disabled={busy} onClick={() => { void doDecide("advance"); }}>Undo</button></span>
                  ) : iv ? (
                    <>
                      <button className="btn primary" disabled={busy} onClick={() => { void doDecide("accept"); }}>Accept</button>
                      <button className="btn" disabled={busy} onClick={() => { void doDecide("decline"); }}>Decline</button>
                    </>
                  ) : (
                    <>
                      <button className="btn primary" disabled={busy} onClick={() => setScheduling(true)}>Invite to interview</button>
                      <button className="btn" disabled={busy} onClick={() => { void doDecide("accept"); }}>Accept</button>
                      <button className="btn" disabled={busy} onClick={() => { void doDecide("decline"); }}>Decline</button>
                    </>
                  )}
                  <span className="subtle" style={{ fontSize: 13, flexBasis: "100%" }}>Decisions are saved in OdySC, where applicants can check their status.</span>
                </>
              ) : (
                <span className="subtle">Only club admins can make the final call. Your scores go into the team average.</span>
              )}
            </div>
          </div>
        </section>
      </div>
      {scheduling && isAdmin && (
        <ScheduleModal
          appId={a.applicationId}
          clubId={clubId}
          name={blind ? "this applicant" : a.preferredName ? `${a.preferredName} ${a.name.split(" ").slice(-1)[0]}` : a.name}
          existing={iv}
          onClose={() => setScheduling(false)}
          onSent={() => { setScheduling(false); toast.show("Interview invitation saved. The applicant can choose a time in OdySC."); }}
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
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pending = team.filter((m) => m.status === "pending");
  const rest = team.filter((m) => m.status !== "pending");

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@usc\.edu$/i.test(f.email.trim())) return setErr("Use the reviewer's @usc.edu email.");
    setBusy(true);
    setErr(null);
    try {
      const result = await inviteMember(f.email, f.name, f.role);
      setErr(result);
      if (!result) {
        toast.show(`Invitation recorded for ${f.email.trim()} in OdySC. Share the signup link with them.`);
        setF({ email: "", name: "", role: "Vice President" });
      }
    } catch (failure) { setErr(failure instanceof Error ? failure.message : "The invitation could not be saved."); }
    finally { setBusy(false); }
  };
  const changeMember = async (action: () => Promise<void>, notice: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try { await action(); toast.show(notice); }
    catch (failure) { setErr(failure instanceof Error ? failure.message : "The membership change could not be saved."); }
    finally { setBusy(false); }
  };

  return (
    <div className="team-grid">
      <div style={{ display: "grid", gap: 16 }}>
        {isAdmin && pending.length > 0 && (
          <div className="card pending-list">
            <h2 className="h3">Asking to join</h2>
            <p className="subtle" style={{ marginTop: 0 }}>These accounts requested access to your club. Only approve people you know should review your applicants.</p>
            {pending.map((m) => (
              <div key={m.email} className="member-row">
                <span className="avatar" aria-hidden="true">{m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div className="subtle">Says they're {m.officerRole} · {m.email}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" disabled={busy} onClick={() => { void changeMember(() => approveMember(m.email), `${m.name} can now review applicants.`); }}>Approve</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => { void changeMember(() => removeMember(m.email), "Access request denied."); }}>Deny</button>
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
                {isAdmin && m.email !== account?.email && <button className="btn sm ghost" disabled={busy} onClick={() => { void changeMember(() => removeMember(m.email), `${m.name}'s access was removed.`); }} aria-label={`Remove ${m.name}`}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        {isAdmin ? (
          <form className="card" onSubmit={invite} noValidate aria-busy={busy}>
            <h2 className="h3">Invite a reviewer</h2>
            <p className="subtle" style={{ marginTop: 0 }}>Record their USC email here, then share the signup link. They must confirm that mailbox before using their account.</p>
            <label className="field" htmlFor="inv-email">USC email <span className="req">*</span></label>
            <input id="inv-email" className="input" type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setErr(null); }} placeholder="ttrojan@usc.edu" aria-invalid={!!err} />
            {err && <p className="field-error" role="alert">{err}</p>}
            <label className="field" htmlFor="inv-name" style={{ marginTop: 12 }}>Name</label>
            <input id="inv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tommy Trojan" />
            <label className="field" htmlFor="inv-role" style={{ marginTop: 12 }}>Role</label>
            <select id="inv-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {OFFICER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 16, width: "100%" }}>{busy ? "Saving…" : "Invite reviewer"}</button>
          </form>
        ) : (
          <div className="card"><p className="subtle" style={{ margin: 0 }}>Ask a club admin if someone else on your board should be reviewing.</p></div>
        )}
        <div className="card how-verify">
          <h2 className="h3">How we check officers</h2>
          <ul>
            <li><strong>USC email confirmed?</strong> This checks mailbox access, not enrollment or a board position.</li>
            <li><strong>Invited by an admin?</strong> Sign up with that email to use the invitation recorded in OdySC.</li>
            <li><strong>Requesting access?</strong> A club admin must approve your membership. The project operator sets up each club's first admin.</li>
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
  const [on, setOn] = useState(!!club.requiresUscId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setOn(!!club.requiresUscId);
    setReason(club.uscIdReason ?? "");
  }, [club.requiresUscId, club.uscIdReason]);
  const tooShort = on && reason.trim().length < 15;
  const save = async () => {
    if (pending) return;
    if (tooShort) return setError("Explain why IDs are needed using at least 15 characters.");
    setPending(true);
    setError("");
    setSaved(false);
    try {
      await setClubSetting(clubId, { requiresUscId: on, uscIdReason: reason.trim() });
      setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Settings could not be saved."); }
    finally { setPending(false); }
  };
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 680 }}>
    <div className="card settings-card">
      <h2 className="h3">Interview video calls</h2>
      <p className="subtle">Create a meeting with your preferred provider, then paste its HTTPS link into the interview invitation.</p>
      {([["zoom", "Zoom"], ["teams", "Microsoft Teams"]] as const).map(([id, name]) => (
        <div key={id} className="integration-row">
          <span className="iv-ico"><FormatIcon format={id} /></span>
          <div style={{ minWidth: 0 }}>
            <strong>{name}</strong>
            <div className="subtle" style={{ fontSize: 14 }}>Manual meeting links. Automatic provider connection is not configured.</div>
          </div>
          <button className="btn sm primary" disabled title="Paste a meeting link into each interview invitation.">Connect</button>
        </div>
      ))}
      <p className="subtle" style={{ fontSize: 13, margin: "10px 0 0" }}>Google Meet also requires a pasted meeting link. In-person interviews need a building and room.</p>
    </div>
    <div className="card settings-card">
      <h2 className="h3">USC ID</h2>
      <p className="subtle">Student IDs are private unless an applicant explicitly shares theirs with your club. Only request IDs when your club needs them, and explain why.</p>
      <label className="switch-row">
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => { setOn(e.target.checked); setSaved(false); setError(""); }} />
        <span><strong>Ask applicants for their USC ID</strong><br /><span className="subtle">Students see your reason and must agree before applying. You'll only see IDs from students who agreed.</span></span>
      </label>
        <div className="reveal" style={{ marginTop: 14 }}>
          {on && <>
          <label className="field" htmlFor="id-reason">Why you need it <span className="req">*</span></label>
          <textarea id="id-reason" className="input" rows={3} value={reason} disabled={pending} onChange={(e) => { setReason(e.target.value); setSaved(false); setError(""); }} placeholder="e.g. Our venue needs a list of USC IDs for building access." aria-invalid={!!error && tooShort} />
          {tooShort && <p className="subtle" style={{ fontSize: 13 }}>Write at least a full sentence. Students read this before deciding.</p>}
          </>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="btn primary" style={{ marginTop: 10 }} disabled={pending || tooShort} onClick={() => { void save(); }}>{pending ? "Saving…" : on ? "Save reason" : "Save settings"}</button>
          {saved && <span className="subtle" style={{ marginLeft: 10 }} role="status">Saved</span>}
        </div>
    </div>
    </div>
  );
}
