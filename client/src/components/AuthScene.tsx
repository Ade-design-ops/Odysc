// Shared "campus at sunset" art: cardinal gradient, drifting gold light, sparkles, and white
// line drawings (a student scootering to class, a brick arcade, clock tower, palm trees)
// that draw themselves in. Used by the auth pages and the landing page's closing band.
// Decorative only — hidden from screen readers.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** One stroke that animates in; --d staggers them. pathLength=1 keeps the dash math simple. */
export const Stroke = ({ d, delay = 0 }: { d: string; delay?: number }) => (
  <path d={d} pathLength={1} className="draw" style={{ ["--d" as string]: `${delay}s` }} />
);
const Ring = ({ cx, cy, r, delay }: { cx: number; cy: number; r: number; delay: number }) => (
  <circle cx={cx} cy={cy} r={r} pathLength={1} className="draw" style={{ ["--d" as string]: `${delay}s` }} />
);

export function Sparkles() {
  return (
    <svg className="sparkles" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
      {[[120, 80], [260, 190], [840, 70], [930, 220], [720, 300], [60, 300]].map(([x, y], i) => (
        <path key={i} className="spark" style={{ ["--d" as string]: `${i * 0.6}s` }} transform={`translate(${x} ${y})`} d="M0 -9 C1 -2 2 -1 9 0 C2 1 1 2 0 9 C-1 2 -2 1 -9 0 C-2 -1 -1 -2 0 -9Z" />
      ))}
    </svg>
  );
}

/** Scooter on the left, campus skyline on the right, sitting on a white ground line. */
export function CampusArt() {
  return (
    <>
      <svg className="art art-left" viewBox="0 0 260 200" aria-hidden="true">
        <g className="glide">
          <g className="speed">
            <line x1="8" y1="140" x2="40" y2="140" />
            <line x1="0" y1="156" x2="30" y2="156" />
            <line x1="14" y1="124" x2="38" y2="124" />
          </g>
          <Ring cx={60} cy={182} r={14} delay={0.2} />
          <Ring cx={180} cy={182} r={14} delay={0.25} />
          <Stroke d="M50 170 L172 170" delay={0.3} />
          <Stroke d="M170 170 L180 182 M172 170 L190 92 M180 90 L204 95" delay={0.45} />
          <Stroke d="M108 170 L118 134 L112 104 M130 170 L126 136 L118 104" delay={0.6} />
          <Stroke d="M114 104 L128 66" delay={0.75} />
          <Ring cx={133} cy={51} r={11} delay={0.85} />
          <Stroke d="M126 76 L152 88 L188 93" delay={0.95} />
          <Stroke d="M104 72 L120 66 L126 92 L110 98 Z" delay={1.05} />
        </g>
      </svg>
      <svg className="art art-right" viewBox="0 0 320 220" aria-hidden="true">
        <circle className="sun" cx="236" cy="120" r="36" />
        <Stroke d="M36 130 L154 130 M40 130 L40 210 M150 130 L150 210" delay={0.3} />
        <Stroke d="M52 210 V176 A12 12 0 0 1 76 176 V210 M84 210 V176 A12 12 0 0 1 108 176 V210 M116 210 V176 A12 12 0 0 1 140 176 V210" delay={0.55} />
        <Stroke d="M150 210 V60 H194 V210 M146 60 L172 22 L198 60" delay={0.8} />
        <Ring cx={172} cy={84} r={9} delay={1.1} />
        <Stroke d="M172 84 V78 M172 84 L177 87 M162 142 V126 A10 10 0 0 1 182 126 V142 M162 196 V176 A10 10 0 0 1 182 176 V196" delay={1.2} />
        <g className="sway">
          <Stroke d="M262 210 C258 160 268 120 254 72" delay={1.0} />
          <Stroke d="M254 72 C236 60 222 66 212 82 M254 72 C240 52 226 46 212 52 M254 72 C268 50 284 46 298 56 M254 72 C272 62 290 70 298 86 M254 72 C252 54 258 40 268 32" delay={1.35} />
        </g>
        <g className="sway slow">
          <Stroke d="M18 210 C16 180 22 160 14 134" delay={1.15} />
          <Stroke d="M14 134 C4 126 -4 130 -8 140 M14 134 C6 120 -2 116 -8 120 M14 134 C24 120 32 120 40 126 M14 134 C26 130 34 138 36 148" delay={1.5} />
        </g>
      </svg>
      <div className="ground" aria-hidden="true" />
    </>
  );
}

export default function AuthScene({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-scene">
      <div className="glow g1" aria-hidden="true" />
      <div className="glow g2" aria-hidden="true" />
      <Sparkles />
      <header className="auth-top">
        <Link to="/" className="brand light" aria-label="OdySC home">Ody<b>SC</b></Link>
      </header>
      <main id="main" className="auth-main">{children}</main>
      <CampusArt />
      <footer className="auth-foot">{footer}</footer>
    </div>
  );
}
