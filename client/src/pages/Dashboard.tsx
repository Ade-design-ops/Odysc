// Dashboard: one clear next step. New users see only "start your profile";
// everything else appears as they progress.
import { Link } from "react-router-dom";
import { DuePill, Loading, Monogram, Ring } from "../components/ui";
import { PROFILE_SECTIONS, appState, useApp } from "../store";
import { FormatIcon, formatLabel } from "../components/Interview";
import { PHOTOS } from "../photos";
import { TODAY, daysUntil, fmtDate, fmtTime, toDate } from "../util";
import HomeBand from "../components/HomeBand";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export default function Dashboard() {
  const s = useApp();
  const { ready, profile, profileDone, profileProgress, myClubs, clubById, events, seenUnlock, markUnlockSeen, matches, calAdded, personal, toggleCalEvent, interviews, applicationIdForClub } = s;
  const interviewForClub = (id: string) => interviews[applicationIdForClub(id) ?? ""];
  if (!ready) return <Loading />;
  const first = profile.preferredName || profile.name.split(" ")[0];

  // ----- Step 1: brand-new user -----
  if (!profileDone) {
    const next = PROFILE_SECTIONS.find((sec) => !sec.done(profile));
    return (
      <>
        <HomeBand kicker="Fight on" title={<>Welcome, <em>{first}</em></>} sub="Your account is set up. Finish your profile once and use it for every club." />
        <div className="narrow">
          <h2 className="h3" style={{ marginBottom: 4 }}>Two steps to your first application</h2>
          <Link to="/profile" className="card hover step-card">
            <Ring value={profileProgress} size={44} />
            <div style={{ flex: 1 }}>
              <div className="subtle">Step 1 of 2</div>
              <div className="h3">{profileProgress <= 0.25 ? "Build your profile" : `Continue: ${next?.title}`}</div>
              <div className="subtle">Upload your resume and we'll fill most of it in.</div>
            </div>
            <span className="btn primary">Start</span>
          </Link>
          <div className="card step-card locked" aria-disabled="true">
            <Ring value={0} size={44} />
            <div style={{ flex: 1 }}>
              <div className="subtle">Step 2 of 2</div>
              <div className="h3">Find your clubs</div>
              <div className="subtle">Available after your profile is complete.</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ----- Returning user: just what's next -----
  const mine = myClubs.map(clubById).filter((c): c is NonNullable<typeof c> => !!c);
  const todo = mine
    .map((c) => ({ c, st: appState(s, c) }))
    .filter(({ c, st }) => st.status === "draft" && (!c.deadline || daysUntil(c.deadline) >= 0))
    .sort((a, b) => a.c.deadline.localeCompare(b.c.deadline));
  const upcoming = events
    .filter((e) => myClubs.includes(e.clubId))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);

  const added = new Set(calAdded);
  const weekStart = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const week = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  const onDay = (d: Date) => [
    ...events.filter((e) => added.has(e.id) && sameDay(new Date(e.start), d)).map((e) => ({ id: e.id, kind: "event" as const, label: `${clubById(e.clubId)?.shortName}: ${e.title}`, time: fmtTime(e.start) })),
    ...personal.filter((p) => sameDay(new Date(p.start), d)).map((p) => ({ id: p.id, kind: "personal" as const, label: p.title, time: fmtTime(p.start) })),
    ...mine.filter((c) => interviewForClub(c.id)!?.booked && sameDay(new Date(interviewForClub(c.id)!.booked!), d)).map((c) => ({ id: `iv_${c.id}`, kind: "interview" as const, label: `${c.shortName} interview`, time: fmtTime(interviewForClub(c.id)!.booked!) })),
    ...todo.filter(({ c }) => sameDay(toDate(c.deadline), d)).map(({ c }) => ({ id: c.id, kind: "due" as const, label: `${c.shortName} due`, time: "11:59 PM" })),
  ];
  const toBook = mine.map((c) => ({ c })).filter(({ c }) => interviewForClub(c.id)! && !interviewForClub(c.id)!.booked && s.apps[c.id]?.status === "interview");
  const submitted = mine.filter((c) => s.apps[c.id] && s.apps[c.id].status !== "draft").length;
  const dueSoon = todo.filter(({ c }) => !!c.deadline && daysUntil(c.deadline) <= 7).length;
  const greeting = TODAY.getHours() < 12 ? "Morning" : TODAY.getHours() < 18 ? "Afternoon" : "Evening";
  const positiveMatchCount = matches.filter((match) => Number.isFinite(match.score) && match.score > 0 && clubById(match.clubId)).length;

  return (
    <>
      <HomeBand
        kicker={TODAY.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        title={<>{greeting}, <em>{first}</em>.</>}
        sub={mine.length === 0 ? "Your profile is ready. Time to pick some clubs." : dueSoon ? `${dueSoon} application${dueSoon === 1 ? "" : "s"} due this week. You've got this.` : "Nothing due this week. Nice work."}
        actions={<Link to={mine.length ? "/my-clubs" : "/search"} className="btn pill-white">{mine.length ? "Open My Clubs" : "Find clubs"}</Link>}
      >
        <div className="stat-chips">
          <div className="stat-chip"><strong>{mine.length}</strong><span>On your list</span></div>
          <div className="stat-chip"><strong>{submitted}</strong><span>Submitted</span></div>
          <div className="stat-chip"><strong>{dueSoon}</strong><span>Due in 7 days</span></div>
        </div>
      </HomeBand>

      {!seenUnlock && (
        <div className="unlock card">
          <div>
            <div className="h3">Your profile is complete</div>
            <div className="subtle">{positiveMatchCount > 0 ? `${positiveMatchCount} clubs match your profile. See your strongest matches in Club Search.` : "Explore clubs in Club Search. You can update your interests anytime."}</div>
          </div>
          <Link to="/search" className="btn primary" onClick={() => { void markUnlockSeen().catch(() => {}); }}>{positiveMatchCount > 0 ? "See matches" : "Explore clubs"}</Link>
        </div>
      )}

      <div className="home-grid">
        <section>
          <div className="section-head">
            <h2 className="h3">Next up</h2>
            {mine.length > 0 && <Link to="/my-clubs" className="text-link">View all</Link>}
          </div>
          {toBook.map(({ c }) => (
            <Link key={c.id} to={`/my-clubs/${c.slug}`} className="card hover iv-nudge">
              <span className="iv-ico big"><FormatIcon format={interviewForClub(c.id)!.format} size={22} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-title">{c.shortName} wants to interview you</div>
                <div className="subtle">{interviewForClub(c.id)!.slots.length} times to pick from · {formatLabel(interviewForClub(c.id)!.format)}</div>
              </div>
              <span className="btn primary sm">Pick a time</span>
            </Link>
          ))}
          {mine.length === 0 ? (
            <Link to="/search" className="card hover step-card">
              <div style={{ flex: 1 }}>
                <div className="h3">Add your first club</div>
                <div className="subtle">Search USC clubs and add the ones you want to apply to.</div>
              </div>
              <span className="btn primary">Search clubs</span>
            </Link>
          ) : todo.length === 0 ? (
            <div className="card subtle">Nothing due. Every club on your list has been submitted.</div>
          ) : (
            <div className="card list">
              {todo.map(({ c, st }) => (
                <Link key={c.id} to={`/my-clubs/${c.slug}`} className="list-row">
                  <Ring value={st.answered / c.questions.length} />
                  <Monogram club={c} size="sm" />
                  <div style={{ flex: 1 }}>
                    <div className="row-title">{st.answered === 0 ? "Start" : "Finish"} your {c.shortName} application</div>
                    <div className="subtle">{st.answered} of {c.questions.length} questions · closes {fmtDate(c.deadline)}</div>
                  </div>
                  <DuePill iso={c.deadline} />
                </Link>
              ))}
            </div>
          )}

          {upcoming.length > 0 && (
            <>
              <h2 className="h3" style={{ margin: "28px 0 12px" }}>Info sessions from your clubs</h2>
              <div className="card list">
                {upcoming.map((e) => {
                  const c = clubById(e.clubId)!;
                  const on = added.has(e.id);
                  return (
                    <div key={e.id} className="list-row">
                      <div className="datebox sm">
                        <div className="m">{new Date(e.start).toLocaleDateString("en-US", { month: "short" })}</div>
                        <div className="d">{new Date(e.start).getDate()}</div>
                      </div>
                      <Link to={`/my-clubs/${c.slug}`} style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-title">{c.shortName} · {e.title}</div>
                        <div className="subtle">{fmtTime(e.start)} · {e.room}</div>
                      </Link>
                      <button className={`btn sm ${on ? "added" : ""}`} aria-pressed={on} onClick={() => { void toggleCalEvent(e.id).catch(() => {}); }}>{on ? "✓ On calendar" : "+ Calendar"}</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside className="week-card card">
          <div className="section-head" style={{ marginBottom: 6 }}>
            <h2 className="h3">Your week</h2>
            <Link to="/calendar" className="text-link">Calendar</Link>
          </div>
          <ol className="week">
            {week.map((d, i) => {
              const its = onDay(d);
              return (
                <li key={i} className={i === 0 ? "today" : ""}>
                  <div className="wk-date"><span>{d.toLocaleDateString("en-US", { weekday: "short" })}</span><b>{d.getDate()}</b></div>
                  <div className="wk-items">
                    {its.length === 0 ? <span className="wk-free">Free</span> : its.map((x) => (
                      <Link key={x.id} to="/calendar" className={`wk-item ${x.kind}`}><span>{x.time}</span>{x.label}</Link>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          <Link to="/search" className="photo-tile">
            <img src={PHOTOS.group} alt="" loading="lazy" />
            <span>Browse more clubs →</span>
          </Link>
        </aside>
      </div>
    </>
  );
}
