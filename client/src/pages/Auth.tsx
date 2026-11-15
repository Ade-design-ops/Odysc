// Sign in + create account, one scene. The backdrop stays put while the card swaps,
// so moving between the two feels like one place, not two pages.
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AuthScene, { Stroke } from "../components/AuthScene";
import { useApp } from "../store";
import SignupForm from "./Signup";

type Who = "student" | "officer";

export default function Auth() {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const mode = pathname.startsWith("/start") ? "start" : pathname.startsWith("/signup") ? "signup" : "signin";
  const who: Who = params.get("as") === "officer" ? "officer" : "student";
  const { reset, signIn } = useApp();
  const nav = useNavigate();

  return (
    <AuthScene
      footer={
        <>
          <span>Questions? <a className="text-link light" href="mailto:help@odysc.example.com">Get help</a></span>
          <span className="row" style={{ gap: 14 }}>
            <button className="link-btn light" onClick={() => { signIn("membership@nsbe.example.com"); nav("/org"); }}>Demo: club officer view</button>
            <button className="link-btn light" onClick={() => { reset(); nav("/"); }}>Reset demo</button>
          </span>
        </>
      }
    >
      {mode === "start" ? (
        <RoleChooser next={params.get("next") === "signin" ? "signin" : "signup"} />
      ) : (
      <div className={`auth-card ${mode}`}>
        <div className="auth-tabs" role="tablist" aria-label="Account type" data-active={who}>
          <button role="tab" aria-selected={who === "student"} onClick={() => setParams({ as: "student" })}>Students</button>
          <button role="tab" aria-selected={who === "officer"} onClick={() => setParams({ as: "officer" })}>Club officers</button>
          <span className="auth-tab-bar" aria-hidden="true" />
        </div>
        <div className="auth-body" key={`${mode}-${who}`}>
          {mode === "signin" ? <SignInForm who={who} /> : <SignupForm role={who} />}
        </div>
      </div>
      )}
    </AuthScene>
  );
}

function SignInForm({ who }: { who: Who }) {
  const { signIn } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError("Enter your email.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("That doesn't look like an email address.");
    const acct = signIn(email);
    if (!acct) return setError("No OdySC account uses that email yet.");
    if (acct.role !== who) return setError(`That's a ${acct.role === "officer" ? "club officer" : "student"} account. Switch tabs above.`);
    nav(acct.role === "officer" ? "/org" : "/");
  };

  return (
    <>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">
        {who === "student" ? <strong>Trojan student?</strong> : <strong>Club officer?</strong>} Enter your USC email to sign in, or{" "}
        <Link to={`/signup?as=${who}`} className="text-link">create an account</Link> to get started.
      </p>
      <p className="req-note"><span className="req">*</span> Required</p>
      <form onSubmit={submit} noValidate>
        <label className="field" htmlFor="signin-email">USC email <span className="req">*</span></label>
        <input
          id="signin-email"
          className="input lg"
          type="email"
          autoComplete="email"
          placeholder="ttrojan@usc.edu"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(""); }}
          aria-invalid={!!error}
          aria-describedby={error ? "signin-error" : "signin-note"}
        />
        {error && <p id="signin-error" className="field-error" role="alert">{error}</p>}
        <p id="signin-note" className="hint">
          Prototype sign-in. The live version uses USC's own sign-in, so OdySC never sees your password.
        </p>
        <div className="auth-actions">
          <button className="btn pill-red" type="submit">Sign in</button>
          <p className="subtle">Campus Activities staff? Your account is set up by the department.</p>
        </div>
      </form>
    </>
  );
}

/** Step zero: who are you here as? Each choice has its own small drawing. */
function RoleChooser({ next }: { next: "signin" | "signup" }) {
  const [, setParams] = useSearchParams();
  const verb = next === "signup" ? "Create an account" : "Sign in";
  return (
    <div className="chooser">
      <h1 className="chooser-title">Welcome to OdySC</h1>
      <p className="chooser-sub">Who are you here as?</p>
      <div className="chooser-grid">
        <Link to={`/${next}?as=student`} className="choice">
          <svg className="choice-art" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="choice-bg" cx="60" cy="60" r="52" />
            {/* backpack */}
            <Stroke d="M40 48 C40 36 80 36 80 48 V92 C80 98 40 98 40 92 Z" delay={0.2} />
            <Stroke d="M50 40 C50 28 70 28 70 40" delay={0.45} />
            <Stroke d="M46 70 H74 V86 H46 Z M60 70 V76" delay={0.6} />
            <Stroke d="M34 56 C30 64 30 80 36 88 M86 56 C90 64 90 80 84 88" delay={0.8} />
          </svg>
          <span className="choice-title">I'm a student</span>
          <span className="choice-desc">Find clubs that match you and apply to all of them from one list.</span>
          <span className="choice-cta">{verb} →</span>
        </Link>
        <Link to={`/${next}?as=officer`} className="choice">
          <svg className="choice-art" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="choice-bg" cx="60" cy="60" r="52" />
            {/* three club members under a pennant */}
            <Stroke d="M60 18 V44 M60 20 L82 27 L60 34" delay={0.2} />
            <circle cx="60" cy="56" r="8" pathLength={1} className="draw" style={{ ["--d" as string]: "0.4s" }} />
            <circle cx="36" cy="64" r="7" pathLength={1} className="draw" style={{ ["--d" as string]: "0.5s" }} />
            <circle cx="84" cy="64" r="7" pathLength={1} className="draw" style={{ ["--d" as string]: "0.55s" }} />
            <Stroke d="M44 92 C44 72 76 72 76 92 M22 94 C22 80 48 78 50 86 M98 94 C98 80 72 78 70 86" delay={0.7} />
          </svg>
          <span className="choice-title">I run a club</span>
          <span className="choice-desc">Collect applications, review them fairly, and reply to everyone.</span>
          <span className="choice-cta">{verb} →</span>
        </Link>
      </div>
      <p className="chooser-switch">
        {next === "signup" ? "Already have an account?" : "New to OdySC?"}{" "}
        <button className="link-btn light" onClick={() => setParams({ next: next === "signup" ? "signin" : "signup" })}>
          {next === "signup" ? "Sign in instead" : "Create an account instead"}
        </button>
      </p>
    </div>
  );
}
