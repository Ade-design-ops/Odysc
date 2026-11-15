// My Clubs — the heart of OdySC, modeled on Common App's "My Colleges".
// Left: your list. Right: the selected club in three steps.
// Extras (map, answer reuse, Free Agent) only appear inside the step that needs them.
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { AnswerBankEntry, AppStatus, Club } from "../../../shared/types";
import { Contacts, EventList, Facts } from "../components/ClubBits";
import { AddButton, DuePill, Loading, Monogram, Ring } from "../components/ui";
import { PHOTOS } from "../photos";
import { InterviewBooking } from "../components/Interview";
import { appState, useApp } from "../store";
import { fmtDate, similarity, daysUntil, wordCount } from "../util";

type Step = "overview" | "questions" | "review";

export default function MyClubs() {
  const { slug } = useParams();
  const s = useApp();
  const { ready, myClubs, clubById } = s;
  if (!ready) return <Loading />;

  const mine = myClubs.map(clubById).filter((c): c is Club => !!c);
  if (mine.length === 0) {
    return (
      <div className="narrow empty-state">
        <img className="empty-photo" src={PHOTOS.chat} alt="" loading="lazy" />
        <h1 className="h1">My Clubs</h1>
        <p className="muted lead">You haven't added any clubs yet. Clubs you add from Club Search show up here with their application.</p>
        <Link to="/search" className="btn primary">Search clubs</Link>
      </div>
    );
  }
  const club = mine.find((c) => c.slug === slug);
  if (!club) return <Navigate to={`/my-clubs/${mine[0].slug}`} replace />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">My Clubs</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{mine.length} club{mine.length === 1 ? "" : "s"} on your list</p>
        </div>
        <Link to="/search" className="btn">+ Add clubs</Link>
      </div>

      <div className="split">
        <aside className="side-list" aria-label="Your clubs">
          {mine.map((c) => {
            const st = appState(s, c);
            const pct = st.status === "draft" ? c.questions.length ? st.answered / c.questions.length : 0 : 1;
            return (
              <Link key={c.id} to={`/my-clubs/${c.slug}`} className={`side-item club ${c.id === club.id ? "active" : ""}`}>
                <Ring value={pct} size={18} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="row-title ellipsis">{c.shortName}</span>
                  <span className="subtle" style={{ display: "block", fontSize: 12 }}>
                    {st.label}{st.status === "draft" ? ` · ${!c.deadline ? "No deadline posted" : daysUntil(c.deadline) >= 0 ? `due ${fmtDate(c.deadline)}` : "closed"}` : ""}
                  </span>
                </span>
              </Link>
            );
          })}
        </aside>

        <ClubPane key={club.id} club={club} />
      </div>
    </>
  );
}

function ClubPane({ club }: { club: Club }) {
  const s = useApp();
  const st = appState(s, club);
  const submitted = st.status !== "draft";
  const [step, setStep] = useState<Step>(st.answered > 0 ? "questions" : "overview");

  const draft = s.drafts[club.id] ?? {};
  const answered = club.questions.filter((q) => (draft[q.id] ?? "").trim()).length;
  const overLimit = club.questions.some((q) => q.maxWords && wordCount(draft[q.id] ?? "") > q.maxWords);
  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: "overview", label: "Overview", done: true },
    { id: "questions", label: "Questions", done: answered === club.questions.length && !overLimit },
    { id: "review", label: "Review", done: submitted },
  ];

  return (
    <section className="card panel">
      <div className="pane-head">
        <Monogram club={club} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/search/${club.slug}`} className="h3 text-link">{club.name}</Link>
          <div className="subtle">{club.deadline ? `Closes ${fmtDate(club.deadline)}` : "No deadline posted"}</div>
        </div>
        {submitted ? <span className={`pill ${st.status === "rejected" ? "" : st.status === "accepted" ? "ok" : "cardinal"}`}>{st.label}</span> : <DuePill iso={club.deadline} />}
      </div>

      {submitted ? (
        <Status club={club} status={st.status} />
      ) : (
        <>
          <nav className="steps-nav" aria-label="Application steps">
            {steps.map((x, i) => (
              <button key={x.id} className={`step ${step === x.id ? "on" : ""} ${x.done && x.id !== "overview" ? "done" : ""}`} onClick={() => setStep(x.id)} aria-current={step === x.id ? "step" : undefined}>
                <span className="step-num">{x.done && x.id !== "overview" ? "✓" : i + 1}</span>
                {x.label}
                {x.id === "review" && <span className="hide-sm">& submit</span>}
              </button>
            ))}
          </nav>

          <div className="reveal" key={step}>
            {step === "overview" && <Overview club={club} onStart={() => setStep("questions")} />}
            {step === "questions" && <Questions club={club} onNext={() => setStep("review")} />}
            {step === "review" && <Review club={club} onEdit={() => setStep("questions")} />}
          </div>
        </>
      )}
    </section>
  );
}

function Overview({ club, onStart }: { club: Club; onStart: () => void }) {
  const { events, reminders, toggleReminder, removeClub } = useApp();
  const nav = useNavigate();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Facts club={club} />
      <div className="row between wrap">
        <label className="toggle">
          <input type="checkbox" disabled={!club.deadline} checked={Boolean(club.deadline) && reminders.includes(club.id)} onChange={() => { void toggleReminder(club.id).catch(() => {}); }} />
          Remind me 48 hours before the deadline
        </label>
        <button className="btn primary" onClick={onStart}>Start questions</button>
      </div>
      <details className="disclose">
        <summary>Info sessions & events</summary>
        <EventList club={club} events={events} />
      </details>
      <details className="disclose">
        <summary>Contact the club</summary>
        <Contacts club={club} />
      </details>
      <button
        className="btn ghost sm"
        style={{ alignSelf: "flex-start", color: "var(--ink-3)" }}
        onClick={async () => {
          try { await removeClub(club.id); nav("/my-clubs"); } catch { /* The shared error toast explains the failure. */ }
        }}
      >
        Remove from my list
      </button>
    </div>
  );
}

function Questions({ club, onNext }: { club: Club; onNext: () => void }) {
  const { drafts, saveDraft, answerBank, clubById, clubs } = useApp();
  const draft = drafts[club.id] ?? {};
  const [origin, setOrigin] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  // Answer bank: find an answer you already wrote for a similar question (other clubs only).
  const suggestions = useMemo(() => {
    const ignore = [club.name, ...clubs.flatMap((c) => [c.shortName, c.name])];
    const out: Record<string, AnswerBankEntry | undefined> = {};
    for (const q of club.questions) {
      out[q.id] = answerBank
        .filter((b) => b.fromClubId !== club.id && b.text)
        .map((b) => ({ b, score: similarity(q.prompt, b.prompt, ignore) }))
        .filter((x) => x.score >= 0.25)
        .sort((a, b) => b.score - a.score)[0]?.b;
    }
    return out;
  }, [club, clubs, answerBank]);

  const set = (qid: string, text: string) => { saveDraft(club.id, { ...draft, [qid]: text }); };

  const voice = (qid: string) => {
    const from = origin[qid];
    const now = draft[qid] ?? "";
    if (!from || !now) return null;
    const kept = similarity(now, from);
    if (kept > 0.55) return { ok: true, text: "Reused from a saved answer." };
    if (kept > 0.25) return { ok: true, text: "Tailored for this club." };
    return { ok: false, text: "Mostly rewritten. Read it once more to make sure it sounds like you." };
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      {!club.questions.length && <p className="subtle">No additional questions have been posted. Review your profile before submitting.</p>}
      {club.questions.map((q, i) => {
        const sug = suggestions[q.id];
        const v = voice(q.id);
        const words = wordCount(draft[q.id] ?? "");
        return (
          <div key={q.id}>
            <label className="field" htmlFor={q.id}>{i + 1}. {q.prompt}</label>
            {sug && !(draft[q.id] ?? "").trim() && !dismissed[q.id] && (
              <div className="suggest reveal">
                <div>
                  <strong>You've answered a similar question</strong> for {clubById(sug.fromClubId)?.shortName}
                  <p>"{sug.text.length > 150 ? sug.text.slice(0, 150) + "…" : sug.text}"</p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => { set(q.id, sug.text); setOrigin((o) => ({ ...o, [q.id]: sug.text })); }}>Reuse & tailor</button>
                  <button className="btn sm ghost" onClick={() => setDismissed((d) => ({ ...d, [q.id]: true }))}>Write fresh</button>
                </div>
              </div>
            )}
            <textarea id={q.id} className="input" value={draft[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} placeholder="Write your answer…" />
            <div className="row between" style={{ marginTop: 4, minHeight: 18 }}>
              <span className="voice" style={{ color: v?.ok ? "var(--ok)" : "var(--warn)" }} aria-live="polite">{v?.text ?? ""}</span>
              {q.maxWords && <span className="subtle" style={{ color: words > q.maxWords ? "var(--cardinal)" : undefined }}>{words} / {q.maxWords}</span>}
            </div>
          </div>
        );
      })}
      <div className="row between">
        <span className="subtle">Drafts save automatically</span>
        <button className="btn primary" onClick={onNext}>Review</button>
      </div>
    </div>
  );
}

function Review({ club, onEdit }: { club: Club; onEdit: () => void }) {
  const { drafts, profile, profileDone, submitWithId } = useApp();
  const [sending, setSending] = useState(false);
  const [consent, setConsent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const draft = drafts[club.id] ?? {};
  const missing = club.questions.filter((q) => !(draft[q.id] ?? "").trim());
  const over = club.questions.filter((q) => q.maxWords && wordCount(draft[q.id] ?? "") > q.maxWords);
  const closed = !!club.deadline && daysUntil(club.deadline) < 0;
  const problems = [
    ...(!profileDone ? ["Finish your profile first."] : []),
    ...missing.map((q) => `Answer: "${q.prompt}"`),
    ...over.map((q) => `Shorten: "${q.prompt}" (over ${q.maxWords} words)`),
    ...(closed ? ["This application is closed."] : []),
    ...(club.requiresUscId && !consent ? [`Agree to share your USC ID with ${club.shortName}.`] : []),
    ...(club.requiresUscId && !profile.uscId ? ["Add your USC ID to your profile before sharing it with this club."] : []),
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="review-block">
        <div className="subtle">Profile shared with {club.shortName}</div>
        <div>{profile.name} · {profile.major || "—"} · {["", "Freshman", "Sophomore", "Junior", "Senior"][profile.year] || "—"}</div>
        <div className="subtle">{profile.skills.join(", ")}</div>
        <div className="subtle" style={{ marginTop: 6 }}>{club.requiresUscId ? "Your USC ID is shared only if you agree below." : `Your USC ID stays private. ${club.shortName} won't see it.`}</div>
      </div>
      {club.questions.map((q, i) => (
        <div key={q.id} className="review-block">
          <div className="subtle">{i + 1}. {q.prompt}</div>
          <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{(draft[q.id] ?? "").trim() || <em className="subtle">Not answered yet</em>}</p>
        </div>
      ))}

      {club.requiresUscId && (
        <label className="consent-box">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            <strong>Share my USC ID ({"•••••• " + (profile.uscId ?? "").slice(-4)}) with {club.shortName}</strong>
            <span className="subtle">Why they need it: {club.uscIdReason || "They didn't give a reason."}</span>
            <span className="subtle">Only {club.shortName}'s verified officers will see it, and only for this application.</span>
          </span>
        </label>
      )}

      <label className="check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Save these answers for reuse in my future applications.</span></label>
      {submissionError && <div className="alert warn" role="alert">{submissionError}</div>}

      {problems.length > 0 && (
        <div className="alert warn" role="alert">
          <strong>Before you submit:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="row between">
        <button className="btn ghost" onClick={onEdit}>Edit answers</button>
        <button
          className="btn primary"
          disabled={problems.length > 0 || sending}
          onClick={async () => {
            setSending(true);
            setSubmissionError("");
            try { await submitWithId(club.id, !!club.requiresUscId && consent, remember); }
            catch (error) { setSubmissionError(error instanceof Error ? error.message : "Could not submit. Please try again."); }
            finally { setSending(false); }
          }}
        >
          {sending ? "Submitting…" : `Submit to ${club.shortName}`}
        </button>
      </div>
    </div>
  );
}

const TIMELINE: AppStatus[] = ["submitted", "interview", "accepted"];

function Status({ club, status }: { club: Club; status: AppStatus }) {
  const { matches, myClubs, clubById, apps, interviews, applicationIdForClub } = useApp();
  const iv = interviews[applicationIdForClub(club.id) ?? ""];
  const reached = status === "rejected" ? 3 : TIMELINE.indexOf(status) + 1;

  // Free Agent: open clubs you haven't added, good fit, still accepting.
  const reroutes = matches
    .filter((m) => m.score >= 0.5 && !myClubs.includes(m.clubId))
    .map((m) => ({ m, c: clubById(m.clubId)! }))
    .filter(({ c }) => c && c.selectivity === "Open" && daysUntil(c.deadline) >= 2)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 3);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <ol className={`timeline ${status === "rejected" ? "rejected" : ""}`}>
        {["Submitted", "Interview", "Decision"].map((label, i) => (
          <li key={label} className={i < reached ? "on" : ""}>
            <span className="dot" />
            {label}
            {i === 0 && apps[club.id]?.submittedAt && <span className="subtle"> · {fmtDate(apps[club.id].submittedAt!)}</span>}
          </li>
        ))}
      </ol>

      {status === "submitted" && (
        <div className="alert ok reveal">
          <strong>Submitted to {club.shortName}.</strong> Your Odysc application is saved. You can follow its status here.
        </div>
      )}
      {status === "interview" && <InterviewBooking iv={iv} club={club} />}
      {status === "accepted" && <div className="alert ok">Welcome to {club.shortName}! Contact the club for next steps.</div>}

      {status === "rejected" && (
        <div className="free-agent reveal">
          <h3 className="h3">{club.shortName} didn't accept you this time</h3>
          <p className="muted" style={{ margin: "4px 0 14px" }}>
            These clubs match your profile, accept everyone, and are still taking applications. Your saved answers will carry over.
          </p>
          {reroutes.length === 0 ? (
            <p className="subtle">Every club that matches your profile is already on your list.</p>
          ) : (
            <div className="card list">
              {reroutes.map(({ m, c }) => (
                <Link key={c.id} to={`/search/${c.slug}`} className="list-row">
                  <Monogram club={c} size="sm" />
                  <div style={{ flex: 1 }}>
                    <div className="row-title">{c.name}</div>
                    <div className="subtle">{Math.round(m.score * 100)}% match · {m.reasons.slice(0, 2).join(" · ")}</div>
                  </div>
                  <AddButton club={c} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
