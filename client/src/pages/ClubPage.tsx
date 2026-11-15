// A club's public page (reached from Club Search). Simple on purpose:
// who they are, the facts, and one button — add it to your list.
import { Link, useNavigate, useParams } from "react-router-dom";
import { Contacts, EventList, Facts } from "../components/ClubBits";
import { TimelineView, clubRecruits } from "../components/RecruitingTimeline";
import { DuePill, Loading, MatchMeter, Monogram } from "../components/ui";
import { useApp } from "../store";

export default function ClubPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { ready, clubs, events, matches, myClubs, addClub } = useApp();
  if (!ready) return <Loading />;
  const club = clubs.find((c) => c.slug === slug);
  if (!club) return <p>Club not found. <Link to="/search">Back to search</Link></p>;
  const added = myClubs.includes(club.id);
  const match = matches.find((m) => m.clubId === club.id);

  return (
    <div className="narrow">
      <Link to="/search" className="text-link">Back to Club Search</Link>

      <section className="club-hero">
        <Monogram club={club} size="lg" />
        <div style={{ flex: 1 }}>
          <div className="subtle">{club.category}</div>
          <h1 className="h1" style={{ marginTop: 2 }}>{club.name}</h1>
          <p className="muted lead" style={{ margin: "6px 0 14px" }}>{club.tagline}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {added ? (
              <button className="btn primary" onClick={() => nav(`/my-clubs/${club.slug}`)}>Open application</button>
            ) : (
              <button className="btn primary" onClick={() => { void addClub(club.id).catch(() => {}); }}>+ Add to My Clubs</button>
            )}
            <DuePill iso={club.deadline} />
          </div>
        </div>
      </section>

      {match && (
        <div className="why">
          <MatchMeter score={match.score} />
          <span className="subtle">Matches your profile:</span>
          {match.reasons.map((r) => <span key={r} className="chip">{r}</span>)}
        </div>
      )}

      <p className="muted" style={{ fontSize: 16 }}>{club.description}</p>
      <Facts club={club} />

      {clubRecruits(club) && (
        <details className="disclose" open>
          <summary>Recruiting timeline</summary>
          <TimelineView items={club.recruitmentTimeline ?? []} />
        </details>
      )}
      <details className="disclose">
        <summary>Info sessions & events</summary>
        <EventList club={club} events={events} />
      </details>
      <details className="disclose">
        <summary>Contact the club</summary>
        <Contacts club={club} />
      </details>
      <details className="disclose">
        <summary>What they ask ({club.questions.length} questions)</summary>
        <ol className="stack" style={{ paddingLeft: 18, margin: "4px 0 0" }}>
          {club.questions.map((q) => <li key={q.id} className="muted">{q.prompt}</li>)}
        </ol>
      </details>
    </div>
  );
}
