import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AuthScene from "../components/AuthScene";
import { api } from "../api";

const USC_EMAIL = /^[^\s@]+@usc\.edu$/i;

function FlowCard({ children }: { children: ReactNode }) {
  return (
    <AuthScene footer={<span>Already have an account? <Link to="/signin" className="text-link light">Sign in</Link></span>}>
      <div className="auth-card signin">
        <div className="auth-body">{children}</div>
      </div>
    </AuthScene>
  );
}

function EmailRequest({ confirmation }: { confirmation: boolean }) {
  const { state } = useLocation();
  const [params] = useSearchParams();
  const initialEmail = state && typeof state === "object" && "email" in state && typeof state.email === "string" ? state.email : "";
  const who = state && typeof state === "object" && "as" in state && state.as === "officer" || params.get("as") === "officer" ? "officer" : "student";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!USC_EMAIL.test(email.trim())) return setError("Use your @usc.edu email.");
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = confirmation ? await api.resendConfirmation(email.trim()) : await api.forgotPassword(email.trim());
      setNotice(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The email request could not be completed. Please try again.");
    } finally { setPending(false); }
  };

  return (
    <FlowCard>
      <h1 className="auth-title">{confirmation ? "Check your email" : "Forgot password?"}</h1>
      <p className="auth-lede">
        {confirmation
          ? "Use the confirmation link in your USC email to finish setting up your OdySC account. Need another link? Request one below."
          : "Enter your USC email to request a link for choosing a new OdySC password."}
      </p>
      {confirmation && who === "officer" && <p className="hint">Email confirmation checks your mailbox. Your club access request still needs approval.</p>}
      <p className="req-note"><span className="req">*</span> Required</p>
      <form onSubmit={submit} noValidate aria-busy={pending}>
        <label className="field" htmlFor="email-request">USC email <span className="req">*</span></label>
        <input
          id="email-request"
          className="input lg"
          type="email"
          autoComplete="email"
          placeholder="ttrojan@usc.edu"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setError(""); setNotice(""); }}
          aria-invalid={!!error}
          aria-describedby={error ? "email-request-error" : "email-request-note"}
        />
        {error && <p id="email-request-error" className="field-error" role="alert">{error}</p>}
        {notice && <p className="hint" role="status">{notice}</p>}
        <p id="email-request-note" className="hint">Open the newest email link in this same browser. Links expire; requesting another replaces the pending flow.</p>
        <div className="auth-actions">
          <button className="btn pill-red" type="submit" disabled={pending}>
            {pending ? "Requesting link…" : confirmation ? "Resend confirmation" : "Send reset link"}
          </button>
          <p className="subtle"><Link to={`/signin?as=${who}`} className="text-link">Back to sign in</Link></p>
        </div>
      </form>
    </FlowCard>
  );
}

export function CheckEmail() {
  return <EmailRequest confirmation />;
}

export function ForgotPassword() {
  return <EmailRequest confirmation={false} />;
}

export function ResetPassword() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.recoverySession().then((result) => {
      if (active) setValid(result.valid);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Your reset link could not be checked. Please try again.");
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !valid) return;
    if (password.length < 10 || password.length > 128) return setError("Use 10–128 characters for your new password.");
    if (password !== confirmPassword) return setError("The passwords do not match.");
    setPending(true);
    setError("");
    try {
      const result = await api.resetPassword(password);
      setPassword("");
      setConfirmPassword("");
      nav("/signin", { replace: true, state: { notice: result.message } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be updated. Please try again.");
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) setValid(false);
    } finally { setPending(false); }
  };

  return (
    <FlowCard>
      <h1 className="auth-title">Reset password</h1>
      <p className="auth-lede">Choose a new password for your OdySC account.</p>
      {checking ? <p className="hint" role="status">Checking your reset link…</p> : valid ? (
        <form onSubmit={submit} noValidate aria-busy={pending}>
          <p className="req-note"><span className="req">*</span> Required</p>
          <label className="field" htmlFor="reset-password">New password <span className="req">*</span></label>
          <input id="reset-password" className="input lg" type="password" autoComplete="new-password" maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "reset-error" : "reset-note"} />
          <p id="reset-note" className="hint">Use 10–128 characters.</p>
          <label className="field" htmlFor="reset-confirm-password">Confirm new password <span className="req">*</span></label>
          <input id="reset-confirm-password" className="input lg" type="password" autoComplete="new-password" maxLength={128} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "reset-error" : undefined} />
          {error && <p id="reset-error" className="field-error" role="alert">{error}</p>}
          <div className="auth-actions">
            <button className="btn pill-red" type="submit" disabled={pending}>{pending ? "Updating password…" : "Update password"}</button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="field-error" role="alert">{error}</p>}
          <p className="hint">This browser does not have a valid password reset session. Request a new link and open it here.</p>
        </>
      )}
      <div className="auth-actions">
        <Link to="/forgot-password" className="text-link">Request a new reset link</Link>
        <Link to="/signin" className="text-link">Back to sign in</Link>
      </div>
    </FlowCard>
  );
}

export function AuthError() {
  const [params] = useSearchParams();
  const reason = params.get("reason");
  const message = reason === "expired_link" ? "This email link has expired. Request a new one to continue."
    : reason === "missing_flow" ? "Open the latest link in the browser where you requested it. If that browser's cookies were cleared, request a new link."
      : "This link could not be verified. It may have been used already. Request a new one to continue.";
  return (
    <FlowCard>
      <h1 className="auth-title">Let's try a new link</h1>
      <p className="auth-lede" role="alert">{message}</p>
      <div className="auth-actions">
        <Link to="/check-email" className="btn pill-red">Resend confirmation</Link>
        <Link to="/forgot-password" className="text-link">Request a password reset</Link>
        <Link to="/signin" className="text-link">Back to sign in</Link>
      </div>
    </FlowCard>
  );
}
