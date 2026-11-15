// Shared building blocks: nav, club monogram, progress ring, pills, toast.
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { Club } from "../../../shared/types";
import { useApp } from "../store";
import { daysUntil, dueLabel } from "../util";

export function Nav() {
  const { account, myClubs } = useApp();
  if (!account) {
    return (
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="OdySC home">Ody<b>SC</b></Link>
          <span style={{ flex: 1 }} />
          <Link to="/start?next=signin" className="btn">Sign in</Link>
          <Link to="/start" className="btn primary">Create an account</Link>
        </div>
      </header>
    );
  }
  const tabs =
    account.role === "officer"
      ? [{ to: "/org", label: "Club dashboard", end: true, badge: 0 }]
      : [
          { to: "/", label: "Dashboard", end: true, badge: 0 },
          { to: "/my-clubs", label: "My Clubs", end: false, badge: myClubs.length },
          { to: "/calendar", label: "Calendar", end: false, badge: 0 },
          { to: "/profile", label: "Profile", end: false, badge: 0 },
          { to: "/search", label: "Club Search", end: false, badge: 0 },
        ];
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="OdySC home">Ody<b>SC</b></Link>
          <nav className="tabs" aria-label="Main">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}>
                {t.label}
                {!!t.badge && <span className="badge" key={t.badge}>{t.badge}</span>}
              </NavLink>
            ))}
          </nav>
          <AccountMenu />
        </div>
      </header>
      {/* outside <header> so position:fixed isn't trapped */}
      <nav className="tabbar" aria-label="Main (mobile)">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>
        ))}
      </nav>
    </>
  );
}

function AccountMenu() {
  const { account, profile, signOut, clubById } = useApp();
  const [open, setOpen] = useState(false);
  const navTo = useNavigate();
  if (!account) return null;
  const display = account.role === "student" ? profile.preferredName || account.name.split(" ")[0] : account.name.split(" ")[0];
  const initials = account.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sub = account.role === "officer" ? `${account.officerRole} · ${clubById(account.clubId ?? "")?.shortName ?? ""}` : account.email;
  return (
    <div className="account" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="account-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="hide-sm">{display}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div className="row-title">{account.name}</div>
            <div className="subtle">{sub}</div>
          </div>
          {account.role === "student" && <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}>Profile</Link>}
          <button role="menuitem" onClick={async () => { try { await signOut(); setOpen(false); navTo("/"); } catch { /* The shared error toast explains a failed sign-out. */ } }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

/** Club initials in a neutral tile. */
export function Monogram({ club, size }: { club: Club; size?: "lg" | "sm" }) {
  const acronym = /^[A-Z]{2,4}$/.test(club.shortName);
  const letters = acronym ? club.shortName : club.shortName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
  return (
    <div className={`mono ${size ?? ""} ${letters.length > 3 ? "long" : ""}`} aria-hidden="true">
      <span>{letters}</span>
    </div>
  );
}

/** Small ring that fills as a club application (or the profile) gets done. */
export function Ring({ value, size = 22 }: { value: number; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const done = value >= 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill={done ? "var(--ink-2)" : "none"} stroke="var(--line-2)" strokeWidth="2" />
      {!done && value > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ink-2)"
          strokeWidth="2.5"
          strokeDasharray={`${c * value} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.4s ease" }}
        />
      )}
      {done && <path d={`M${size * 0.3} ${size * 0.52}l${size * 0.14} ${size * 0.14} ${size * 0.26}-${size * 0.3}`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function MatchMeter({ score }: { score: number }) {
  return (
    <div className="meter" title="AI match score">
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      {Math.round(score * 100)}%
    </div>
  );
}

export function DuePill({ iso }: { iso: string }) {
  const d = daysUntil(iso);
  const cls = d < 0 ? "" : d <= 2 ? "cardinal" : d <= 7 ? "gold" : "";
  return <span className={`pill ${cls}`}>{dueLabel(iso)}</span>;
}

/** Add-to-list button used in search and on club pages. */
export function AddButton({ club, size = "sm" }: { club: Club; size?: "sm" | "md" }) {
  const { myClubs, addClub } = useApp();
  const added = myClubs.includes(club.id);
  return (
    <button
      className={`btn ${size === "sm" ? "sm" : ""} ${added ? "added" : "secondary"}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!added) void addClub(club.id).catch(() => {});
      }}
      aria-pressed={added}
      aria-label={added ? `${club.name} is in My Clubs` : `Add ${club.name} to My Clubs`}
    >
      {added ? "Added" : "Add"}
    </button>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return <div className="toast" role="status">{message}</div>;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const clear = useCallback(() => setMsg(null), []);
  return { msg, show: setMsg, clear };
}

export function Loading() {
  return (
    <div className="stack" aria-busy="true">
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}
    </div>
  );
}
