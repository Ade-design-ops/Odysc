// Sign in + create account, one scene. The backdrop stays put while the card swaps,
// so moving between the two feels like one place, not two pages.
import { useRef, useState } from "react";
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

  return (
    <AuthScene
      footer={
        <>
          <span>Questions? <Link className="text-link light" to="/forgot-password">Get help</Link></span>
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
  const { state } = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const inFlight = useRef(false);
  const notice = state && typeof state === "object" && "notice" in state && typeof state.notice === "string" ? state.notice : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (!email.trim()) return setError("Enter your email.");
    if (!/^[^\s@]+@usc\.edu$/i.test(email.trim())) return setError("Use your @usc.edu email.");
    if (!password) return setError("Enter your OdySC password.");
    setError("");
    setNeedsConfirmation(false);
    inFlight.current = true;
    setPending(true);
    try {
      const acct = await signIn(email.trim(), password, who);
      setPassword("");
      nav(acct.role === "officer" ? "/org" : "/profile");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in could not be completed. Please try again.");
      setNeedsConfirmation(Boolean(failure && typeof failure === "object" && "code" in failure && failure.code === "EMAIL_CONFIRMATION_REQUIRED"));
    } finally { inFlight.current = false; setPending(false); }
  };

  return (
    <>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">
        {who === "student" ? <strong>Trojan student?</strong> : <strong>Club officer?</strong>} Use your USC email and OdySC password to sign in, or{" "}
        <Link to={`/signup?as=${who}`} className="text-link">create an account</Link> to get started.
      </p>
      <p className="req-note"><span className="req">*</span> Required</p>
      {notice && <p className="hint" role="status">{notice}</p>}
      <form onSubmit={submit} noValidate aria-busy={pending}>
        <label className="field" htmlFor="signin-email">USC email <span className="req">*</span></label>
        <input
          id="signin-email"
          disabled={pending}
          maxLength={254}
          className="input lg"
          type="email"
          autoComplete="email"
          placeholder="ttrojan@usc.edu"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(""); setNeedsConfirmation(false); }}
          aria-invalid={!!error}
          aria-describedby={error ? "signin-error" : "signin-note"}
        />
        <label className="field" htmlFor="signin-password">OdySC password <span className="req">*</span></label>
        <input
          id="signin-password"
          disabled={pending}
          maxLength={128}
          className="input lg"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          aria-invalid={!!error}
          aria-describedby={error ? "signin-error" : "signin-note"}
        />
        {error && <p id="signin-error" className="field-error" role="alert">{error}</p>}
        <p id="signin-note" className="hint">
          This is your OdySC account password. Email confirmation checks access to your USC mailbox.
        </p>
        {needsConfirmation && <p className="hint"><Link to="/check-email" state={{ email: email.trim(), as: who }} className="text-link">Resend your confirmation email</Link></p>}
        <div className="auth-actions">
          <button className="btn pill-red" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          <Link to={`/forgot-password?as=${who}`} className="text-link">Forgot password?</Link>
          <p className="subtle">{who === "officer" ? "Club access requires approval." : "You can finish your profile after signing in."}</p>
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
