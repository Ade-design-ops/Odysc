// Red header band for signed-in screens — same world as the sign-in pages (gradient, gold
// light, sparkles, campus line art) so the app doesn't feel like two different products.
import type { ReactNode } from "react";
import { Sparkles, Stroke } from "./AuthScene";

export default function HomeBand({
  kicker,
  title,
  sub,
  actions,
  children,
}: {
  kicker?: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={`homeband bleed ${children ? "has-extra" : ""}`}>
      <div className="glow g1" aria-hidden="true" />
      <Sparkles />
      {/* mini skyline: clock tower + palms */}
      <svg className="homeband-art" viewBox="0 0 220 150" aria-hidden="true">
        <circle className="sun" cx="150" cy="70" r="26" />
        <Stroke d="M80 148 V40 H112 V148 M76 40 L96 12 L116 40" delay={0.2} />
        <Stroke d="M96 60 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M88 118 V104 A8 8 0 0 1 104 104 V118" delay={0.5} />
        <Stroke d="M10 148 V100 H80 M22 148 V126 A9 9 0 0 1 40 126 V148 M50 148 V126 A9 9 0 0 1 68 126 V148" delay={0.4} />
        <g className="sway">
          <Stroke d="M186 148 C183 116 190 90 180 58" delay={0.6} />
          <Stroke d="M180 58 C168 50 158 54 152 64 M180 58 C170 44 160 40 152 44 M180 58 C190 42 202 40 212 48 M180 58 C192 52 204 58 210 70" delay={0.85} />
        </g>
      </svg>
      {children && <Skyline />}
      <div className="container homeband-inner">
        <div className="homeband-copy">
          {kicker && <p className="homeband-kicker">{kicker}</p>}
          <h1>{title}</h1>
          {sub && <p className="homeband-sub">{sub}</p>}
          {actions && <div className="row wrap" style={{ gap: 12, marginTop: 18 }}>{actions}</div>}
        </div>
        {children && <div className="homeband-extra">{children}</div>}
      </div>
      <div className="homeband-ground" aria-hidden="true" />
      <svg className="wave wave-out" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40 C240 80 480 80 720 54 C960 28 1200 16 1440 40 V80 H0 Z" />
      </svg>
    </section>
  );
}

/** A thin line-drawn USC skyline along the bottom of the band: palms, a Doheny-style
 * facade with its rose window, Mudd Hall's tower, and a Trojan helmet at the end. */
function Skyline() {
  const palm = (x: number, h: number, d: number) => (
    <g className="sway slow" key={x}>
      <Stroke d={`M${x} 118 C${x - 2} ${118 - h * 0.4} ${x + 4} ${118 - h * 0.7} ${x - 4} ${118 - h}`} delay={d} />
      <Stroke d={`M${x - 4} ${118 - h} c-10 -6 -20 -3 -25 6 M${x - 4} ${118 - h} c-8 -12 -18 -14 -25 -10 M${x - 4} ${118 - h} c8 -13 20 -14 28 -7 M${x - 4} ${118 - h} c10 -5 21 0 25 10`} delay={d + 0.25} />
    </g>
  );
  return (
    <svg className="homeband-skyline" viewBox="0 0 1440 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {palm(70, 64, 0.2)}
      <Stroke d="M150 118 V72 H300 V118 M150 72 L225 44 L300 72 M140 118 H310" delay={0.35} />
      <Stroke d="M225 60 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M175 118 V96 a10 10 0 0 1 20 0 V118 M215 118 V92 a10 10 0 0 1 20 0 V118 M255 118 V96 a10 10 0 0 1 20 0 V118" delay={0.6} />
      {palm(350, 78, 0.45)}
      {palm(395, 52, 0.55)}
      {palm(880, 58, 0.7)}
      <Stroke d="M1010 118 V58 H1050 V118 M1004 58 L1030 26 L1056 58 M1030 74 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M970 118 V88 H1010 M1050 88 H1090 V118 M960 118 H1100" delay={0.5} />
      {palm(1150, 70, 0.65)}
      <Stroke d="M1230 118 C1230 90 1246 74 1266 74 C1286 74 1300 90 1300 118 M1242 101 H1290 M1266 74 C1258 58 1270 44 1294 46 C1312 48 1318 62 1310 76 M1276 60 l6 -6 M1286 58 l5 -7 M1296 60 l6 -5" delay={0.8} />
      {palm(1370, 60, 0.9)}
    </svg>
  );
}
