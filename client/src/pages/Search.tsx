// Club Search, like Common App's college search: search, filter, add to your list.
// Recommendations only appear once the profile is done (they're earned, not dumped on you).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AddButton, DuePill, Loading, MatchMeter, Monogram } from "../components/ui";
import { PHOTOS } from "../photos";
import { useApp } from "../store";

export default function Search() {
  const { ready, clubs, matches, profileDone, clubById } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [openOnly, setOpenOnly] = useState(false);
  const categories = useMemo(() => ["All", ...[...new Set(clubs.map(club => club.category).filter(Boolean))].sort()], [clubs]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clubs
      .filter((c) => cat === "All" || c.category === cat)
      .filter((c) => !openOnly || c.selectivity === "Open")
      .filter((c) => !needle || `${c.name} ${c.shortName} ${c.tagline} ${c.category} ${c.description}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clubs, q, cat, openOnly]);

  if (!ready) return <Loading />;
  const recs = matches
    .filter((match) => Number.isFinite(match.score) && match.score > 0 && clubById(match.clubId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const browsing = !q.trim() && cat === "All" && !openOnly;
  const scoreOf = (id: string) => matches.find((m) => m.clubId === id)?.score;

  return (
    <>
      <section className="banner slim">
        <img src={PHOTOS.steps} alt="" loading="lazy" />
        <div className="banner-shade" />
        <div className="banner-copy">
          <h1>Club Search</h1>
          <p>{clubs.length} USC clubs to explore</p>
        </div>
      </section>

      <div className="search-box">
        <input
          className="input search-input"
          type="search"
          placeholder="Search by name, interest or category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search clubs"
          autoFocus
        />
      </div>
      <div className="row wrap" style={{ gap: 6, margin: "12px 0 0" }} role="group" aria-label="Filter by category">
        {categories.map((c) => (
          <button key={c} className={`filter ${cat === c ? "on" : ""}`} onClick={() => setCat(c)} aria-pressed={cat === c}>{c}</button>
        ))}
        <span style={{ flex: 1 }} />
        <label className="toggle">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Open to everyone
        </label>
      </div>

      {browsing && (
        profileDone ? recs.length > 0 ? (
          <section className="section reveal">
            <div className="section-head">
              <h2 className="h3">Recommended for you</h2>
              <span className="subtle">Matched from your profile</span>
            </div>
            <div className="grid grid-3">
              {recs.map((m) => {
                const c = clubById(m.clubId);
                if (!c) return null;
                return (
                  <Link key={c.id} to={`/search/${c.slug}`} className="card hover rec">
                    <div className="row between">
                      <Monogram club={c} />
                      <MatchMeter score={m.score} />
                    </div>
                    <div className="h3" style={{ marginTop: 12 }}>{c.name}</div>
                    <div className="subtle" style={{ margin: "4px 0 12px" }}>{m.reasons.slice(0, 2).join(" · ")}</div>
                    <AddButton club={c} />
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null : (
          <Link to="/profile" className="hint-bar">
            Complete your profile to see clubs that match it.
          </Link>
        )
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="h3">{browsing ? "All clubs" : `${results.length} result${results.length === 1 ? "" : "s"}`}</h2>
        </div>
        {results.length === 0 ? (
          <div className="card subtle" style={{ textAlign: "center" }}>No clubs match. Try a different word or category.</div>
        ) : (
          <div className="card list">
            {results.map((c) => {
              const score = scoreOf(c.id);
              return (
                <Link key={c.id} to={`/search/${c.slug}`} className="list-row">
                  <Monogram club={c} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-title">{c.name}</div>
                    <div className="subtle">{[c.category, c.hoursPerWeek, c.selectivity === "Open" ? "Open to all" : c.selectivity === "Selective" ? "Selective" : "Membership details not posted"].filter(Boolean).join(" · ")}</div>
                  </div>
                  {score !== undefined && score >= 0.7 && <span className="pill hide-sm">{Math.round(score * 100)}% match</span>}
                  <span className="hide-sm"><DuePill iso={c.deadline} /></span>
                  <AddButton club={c} />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
