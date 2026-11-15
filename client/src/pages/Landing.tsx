// Signed-out home page. One continuous piece: red photo hero → wave → warm cream
// "how it works" → wave → red campus band with the line-art skyline and the footer.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CampusArt, Sparkles, Stroke } from "../components/AuthScene";
import { PHOTOS } from "../photos";
import { useApp } from "../store";

/** Adds "in" once the element scrolls into view, so drawings start when you see them. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return [ref, inView] as const;
}

const STEPS = [
  {
    title: "Build your profile once",
    text: "Upload your resume and we fill in most of it. Every club you apply to sees the same profile.",
    art: (
      <>
        <Stroke d="M24 18 H76 V82 H24 Z" delay={0.1} />
        <circle cx="50" cy="38" r="9" pathLength={1} className="draw" style={{ ["--d" as string]: "0.35s" }} />
        <Stroke d="M36 62 C36 50 64 50 64 62 M34 70 H66 M40 76 H60" delay={0.55} />
      </>
    ),
  },
  {
    title: "Find clubs that fit",
    text: "Search USC's clubs, or start from the ones matched to your interests and experience.",
    art: (
      <>
        <circle cx="44" cy="44" r="20" pathLength={1} className="draw" style={{ ["--d" as string]: "0.2s" }} />
        <Stroke d="M58 58 L78 78" delay={0.5} />
        <Stroke d="M44 36 V52 M36 44 H52" delay={0.7} />
      </>
    ),
  },
  {
    title: "Apply and track",
    text: "Answer each club's questions, reuse answers you've already written, and follow every decision in one list.",
    art: (
      <>
        <Stroke d="M16 50 L82 20 L62 82 L46 58 Z" delay={0.2} />
        <Stroke d="M46 58 L82 20" delay={0.55} />
        <Stroke d="M14 72 C24 70 30 76 38 74" delay={0.75} />
      </>
    ),
  },
];

export default function Landing() {
  const [stepsRef, stepsIn] = useInView<HTMLDivElement>();
  const [bandRef, bandIn] = useInView<HTMLElement>();
  const { reset, signIn } = useApp();
  const nav = useNavigate();

  return (
    <div className="landing">
      <section className="hero-full">
        <img className="hero-img" src={PHOTOS.hero} alt="" />
        <div className="hero-shade" />
        <div className="container hero-copy">
          <h1>Find where you fit at USC.</h1>
          <p>Build one profile, apply to any club, and keep track of every deadline in one place.</p>
          <div className="row wrap" style={{ gap: 16 }}>
            <Link to="/start" className="btn pill-white">Create an account</Link>
            <Link to="/start?next=signin" className="hero-link">Sign in</Link>
          </div>
        </div>
        <svg className="wave wave-out" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 70 C240 124 480 124 720 84 C960 44 1200 24 1440 60 V120 H0 Z" />
        </svg>
      </section>

      <section className="cream bleed">
        <div className={`container reveal-scroll ${stepsIn ? "in" : ""}`} ref={stepsRef}>
          <p className="kicker">How it works</p>
          <h2 className="cream-title">From "what clubs are there?" to applied, in three steps.</h2>
          <ol className="steps3">
            {STEPS.map((s, i) => (
              <li key={s.title} style={{ ["--i" as string]: i }}>
                <div className="step3-art">
                  <span className="step3-num">{i + 1}</span>
                  <svg viewBox="0 0 100 100" aria-hidden="true">{s.art}</svg>
                </div>
                <h3 className="h3">{s.title}</h3>
                <p className="muted">{s.text}</p>
              </li>
            ))}
          </ol>

          <div className="two-sides">
            <div className="side-card">
              <span className="side-tag">Students</span>
              <h3 className="h2">Stop filling out the same form ten times.</h3>
              <p className="muted">One profile, every club, and a heads-up before each deadline.</p>
              <Link to="/signup?as=student" className="btn primary">Create student account</Link>
            </div>
            <div className="side-card dark">
              <span className="side-tag">Club officers</span>
              <h3 className="h2">Review applications without a spreadsheet.</h3>
              <p>Blind review, AI summaries you can check, and a kind reply to every applicant.</p>
              <Link to="/signup?as=officer" className="btn pill-gold">Register your club</Link>
            </div>
          </div>
        </div>
      </section>

      <section className={`band bleed reveal-scroll ${bandIn ? "in" : ""}`} ref={bandRef}>
        <svg className="wave wave-in" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0 H1440 V46 C1200 104 960 112 720 72 C480 32 240 22 0 62 Z" />
        </svg>
        <div className="glow g1" aria-hidden="true" />
        <Sparkles />
        <div className="container band-copy">
          <h2>Clubs are recruiting now.</h2>
          <p>Fall applications are open. Set up your profile now and you can apply the moment a club catches your eye.</p>
          <div className="row wrap" style={{ gap: 16, justifyContent: "center" }}>
            <Link to="/start" className="btn pill-white">Create an account</Link>
            <Link to="/start?next=signin" className="hero-link">Sign in</Link>
          </div>
        </div>
        <CampusArt />
        <footer className="auth-foot">
          <span>
            OdySC · built on Replit for USC Trojans · Photos from{" "}
            <a className="text-link light" href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>
          </span>
          <span className="row" style={{ gap: 14 }}>
            <button className="link-btn light" onClick={() => { signIn("membership@nsbe.example.com"); nav("/org"); }}>Demo: club officer view</button>
            <button className="link-btn light" onClick={() => { reset(); nav("/"); }}>Reset demo</button>
          </span>
        </footer>
      </section>
    </div>
  );
}
