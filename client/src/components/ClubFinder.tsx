// Floating club finder using the authenticated student's saved profile and PDF.
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type FinderMatch, type FinderTurn } from "../api";
import { useApp } from "../store";
import "../club-finder.css";

type Message = { id: number; from: "bot" | "me"; text: string; matches?: FinderMatch[] };
type SearchRequest = { history: FinderTurn[] };
const listEvidence = (values: string[]) => [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
const turnText = (reply: string, matches: FinderMatch[]) =>
  (matches.length ? `${reply}\nSuggested: ${matches.map((match) => match.name).join(", ")}` : reply).slice(0, 2000);

/** Original Odysc mascot: a friendly modern-day soldier. */
function SoldierAvatar() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%">
      <defs><clipPath id="cf-avatar-clip"><circle cx="32" cy="32" r="30" /></clipPath></defs>
      <g clipPath="url(#cf-avatar-clip)">
        <circle cx="32" cy="32" r="30" fill="var(--cardinal, #990000)" />
        <ellipse cx="32" cy="64" rx="20" ry="12" fill="#5b6b3a" />
        <path d="M27 52 L32 57 L37 52" fill="none" stroke="#3e4a26" strokeWidth="1.5" />
        <circle cx="32" cy="38" r="13" fill="#f2c9a0" />
        <path d="M19 37 Q21 48 29 50.5 M45 37 Q43 48 35 50.5" fill="none" stroke="#3e4a26" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 35 Q16 15 32 15 Q48 15 48 35 Z" fill="#5b6b3a" />
        <ellipse cx="32" cy="35" rx="17.5" ry="3" fill="#4a5830" />
        <circle cx="25" cy="25" r="2.2" fill="#4a5830" /><circle cx="37" cy="22" r="2.6" fill="#4a5830" /><circle cx="41" cy="29" r="1.8" fill="#4a5830" />
        <circle cx="27" cy="40.5" r="1.7" fill="#3a2418" /><circle cx="37" cy="40.5" r="1.7" fill="#3a2418" />
        <circle cx="24" cy="44.5" r="2" fill="#e8a587" opacity="0.7" /><circle cx="40" cy="44.5" r="2" fill="#e8a587" opacity="0.7" />
        <path d="M28 45.5 q4 3.2 8 0" fill="none" stroke="#3a2418" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Optional avatar artwork can be supplied by the app; the default is the teammate's mascot. */
export default function ClubFinder({ avatarSrc }: { avatarSrc?: string } = {}) {
  const { account, profile, resume, profileDone, flushProfile, clubById } = useApp();
  const canUse = account?.role === "student" && profileDone && !!resume;
  const evidence = JSON.stringify([profile.major.trim().toLowerCase(), profile.year, listEvidence(profile.interests), listEvidence(profile.skills), profile.experiences.map((value) => value.trim()).filter(Boolean), profile.bio?.trim(), listEvidence(profile.goals ?? [])]);
  const contextKey = JSON.stringify([account?.role, profile.id, resume?.id ?? null, evidence]);
  const first = profile.preferredName?.trim() || profile.name.trim().split(/\s+/)[0];
  const greeting = canUse
    ? `Hi${first ? `, ${first}` : ""}! I'll use your saved ${profile.major} profile${profile.interests.length ? `, interests in ${profile.interests.slice(0, 3).join(", ")},` : ""} and résumé to find USC clubs. Select Find my clubs, or tell me what you'd like to focus on.`
    : "Finish your student profile and upload your résumé PDF first. Then I can use those saved details to suggest USC clubs without asking you to enter them again.";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [{ id: 0, from: "bot", text: greeting }]);
  const [conversationKey, setConversationKey] = useState(contextKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedRequest, setFailedRequest] = useState<SearchRequest | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const starter = useRef<HTMLButtonElement>(null);
  const profileLink = useRef<HTMLAnchorElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const requestEpoch = useRef(0);
  const inFlight = useRef(false);
  const nextId = useRef(1);
  const history = useRef<FinderTurn[]>([]);
  const latest = useRef({ contextKey, canUse, resumeId: resume?.id, greeting, clubById });
  latest.current = { contextKey, canUse, resumeId: resume?.id, greeting, clubById };
  const panelId = useId();

  const reset = () => {
    requestEpoch.current += 1;
    inFlight.current = false;
    history.current = [];
    setConversationKey(latest.current.contextKey);
    setMessages([{ id: 0, from: "bot", text: latest.current.greeting }]);
    setDraft("");
    setError("");
    setFailedRequest(null);
    setBusy(false);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestEpoch.current += 1; inFlight.current = false; };
  }, []);
  // Compare evidence values, not polling object identities; real profile/PDF changes invalidate old recommendations.
  useEffect(() => { reset(); }, [contextKey, canUse]);
  useEffect(() => {
    if (!open) return;
    if (!canUse) profileLink.current?.focus();
    else if (busy) closeButton.current?.focus();
    else if (!history.current.length && !error) starter.current?.focus();
    else input.current?.focus();
  }, [open, busy, canUse, error]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy, open]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };
  const say = (...items: Omit<Message, "id">[]) => {
    const additions = items.map((item) => ({ ...item, id: nextId.current++ }));
    setMessages((current) => [...current, ...additions]);
  };

  const search = async (request: SearchRequest) => {
    if (inFlight.current || !latest.current.canUse) return;
    const owner = latest.current.contextKey;
    const resumeId = latest.current.resumeId;
    const epoch = ++requestEpoch.current;
    const current = () => mounted.current && epoch === requestEpoch.current && owner === latest.current.contextKey;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setFailedRequest(null);
    const sentHistory = request.history.map((turn) => ({ ...turn }));
    try {
      await flushProfile();
      if (!current() || !latest.current.canUse) return;
      const result = await api.clubFinder({ history: sentHistory, resumeId });
      if (!current() || !latest.current.canUse) return;
      const matches = result.matches.filter((match) => latest.current.clubById(match.clubId));
      const kept: FinderTurn[] = [...sentHistory, { role: "assistant", content: turnText(result.reply, matches) }];
      // Successful history starts/ends with assistant; adding one user turn yields at most 20 valid turns.
      history.current = kept.slice(-19);
      say({ from: "bot", text: result.reply, matches });
    } catch (failure) {
      if (!current()) return;
      setError(failure instanceof Error ? failure.message : "The club finder couldn't answer. Please try again.");
      setFailedRequest({ history: sentHistory });
    } finally {
      if (current()) { inFlight.current = false; setBusy(false); }
    }
  };

  const start = () => {
    if (!canUse || inFlight.current) return;
    say({ from: "me", text: "Find my clubs" });
    void search({ history: [] });
  };
  const send = () => {
    const text = draft.trim();
    if (!text || !canUse || inFlight.current) return;
    const previous = history.current.length ? history.current : [{ role: "assistant" as const, content: "What would you like to focus on when exploring USC clubs?" }];
    const next: FinderTurn[] = [...previous, { role: "user", content: text }];
    setDraft("");
    say({ from: "me", text });
    void search({ history: next.slice(-20) });
  };

  if (account?.role !== "student") return null;
  const sameContext = conversationKey === contextKey;
  const visibleMessages = sameContext ? messages : [{ id: 0, from: "bot" as const, text: greeting }];
  const thinking = sameContext && busy;
  const visibleError = sameContext ? error : "";

  return (
    <div className="cf" onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}>
      {open && (
        <section id={panelId} className="cf-panel" role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`} aria-busy={thinking}>
          <header className="cf-head">
            <div>
              <h2 id={`${panelId}-title`} className="cf-title">Find your clubs</h2>
              <p className="cf-sub">Matches from clubs listed on Odysc</p>
            </div>
            <div className="cf-head-actions">
              {(messages.length > 1 || thinking || visibleError) && <button type="button" className="btn sm ghost" onClick={reset}>Start over</button>}
              <button ref={closeButton} type="button" className="cf-close" onClick={close} aria-label="Close club finder">×</button>
            </div>
          </header>

          <div className="cf-context">
            {resume ? <span>Using your saved résumé: <strong>{resume.fileName}</strong></span> : <span>A saved résumé PDF is required.</span>}
            <Link ref={profileLink} to="/profile" onClick={close}>{canUse ? "Review profile" : "Complete profile"}</Link>
            <span>When you search, Claude receives your saved résumé PDF and profile details to recommend clubs.</span>
          </div>

          <div className="cf-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
            {visibleMessages.map((message) => (
              <div key={message.id} className={`cf-msg ${message.from}`}>
                <p>{message.id === 0 ? greeting : message.text}</p>
                {!!message.matches?.length && (
                  <ol className="cf-matches">
                    {message.matches.map((match) => {
                      const club = clubById(match.clubId);
                      if (!club) return null;
                      return (
                        <li key={match.clubId} className="cf-match">
                          <div className="cf-match-top">
                            <Link to={`/search/${encodeURIComponent(club.slug)}`} className="cf-match-name" onClick={close}>{club.name}</Link>
                            <span className={`cf-fit ${match.fit}`}>{match.fit === "strong" ? "Strong fit" : "Good fit"}</span>
                          </div>
                          <p className="cf-reason">{match.reason}</p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
            {thinking && <div className="cf-msg bot cf-typing" role="status" aria-label="Finding clubs"><span /><span /><span /></div>}
          </div>

          {!history.current.length && !thinking && !visibleError && (
            <div className="cf-chips">
              <button ref={starter} type="button" className="btn primary sm" disabled={!canUse} onClick={start}>Find my clubs</button>
            </div>
          )}
          {visibleError && <div className="cf-error" role="alert"><p className="field-error">{visibleError}</p>{failedRequest && <button type="button" className="btn sm" disabled={thinking || !canUse} onClick={() => { void search(failedRequest); }}>Try again</button>}</div>}

          <form className="cf-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label className="sr-only" htmlFor={`${panelId}-input`}>Ask about club recommendations</label>
            <input id={`${panelId}-input`} ref={input} className="input" value={draft} maxLength={1000}
              placeholder={!canUse ? "Complete your profile first" : thinking ? "Finding clubs…" : "Ask for more, fewer or different clubs"} disabled={thinking || !canUse} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" className="btn primary" disabled={!draft.trim() || thinking || !canUse}>Send</button>
          </form>
        </section>
      )}

      <button ref={launcher} type="button" className={`cf-launcher${open ? " open" : ""}`} aria-expanded={open} aria-controls={panelId}
        aria-label={open ? "Close club finder" : "Ask me! Open the club finder"} onClick={() => (open ? close() : setOpen(true))}>
        {!open && <span className="cf-thought" aria-hidden="true">Ask me!<span className="cf-thought-dot big" /><span className="cf-thought-dot small" /></span>}
        <span className="cf-avatar" aria-hidden="true">{open ? <span className="cf-avatar-x">×</span> : avatarSrc ? <img src={avatarSrc} alt="" /> : <SoldierAvatar />}</span>
      </button>
    </div>
  );
}
