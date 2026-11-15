// Create-account form (lives inside the auth card). Students give the basics clubs need to
// know who they are; the rest of the profile is finished later. Officers register for a club.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { OFFICER_ROLES } from "../data/mock";
import { useApp } from "../store";

const USC_EMAIL = /^[a-z0-9._%+-]+@usc\.edu$/i;
const USC_ID = /^\d{10}$/;
const STANDING = ["", "Freshman", "Sophomore", "Junior", "Senior"];
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];

type Errors = Record<string, string>;

export default function SignupForm({ role }: { role: "student" | "officer" }) {
  const { accounts, clubs, signUpStudent, signUpOfficer } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({
    first: "", last: "", preferred: "", pronouns: "", email: "", uscId: "", standing: "0", term: "Spring", year: "", agree: false,
    clubId: "", officerRole: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof typeof f, v: string | boolean) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const validate = () => {
    const e: Errors = {};
    if (!f.first.trim()) e.first = "Enter your first name.";
    if (!f.last.trim()) e.last = "Enter your last name.";
    if (!USC_EMAIL.test(f.email.trim())) e.email = "Use your @usc.edu email.";
    else if (accounts[f.email.trim().toLowerCase()]) e.email = "An account already uses this email. Sign in instead.";
    if (role === "student") {
      if (!USC_ID.test(f.uscId.replace(/\D/g, ""))) e.uscId = "Your USC ID is the 10-digit number on your USCard.";
      if (f.standing === "0") e.standing = "Choose your class.";
      if (!f.year) e.year = "Choose your graduation year.";
    } else {
      if (!f.clubId) e.clubId = "Choose your club.";
      if (!f.officerRole) e.officerRole = "Choose your role.";
    }
    if (!f.agree) e.agree = role === "student" ? "Please agree before continuing." : "Please confirm you're a current officer.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const name = `${f.first.trim()} ${f.last.trim()}`;
    if (role === "student") {
      signUpStudent({
        name,
        preferredName: f.preferred.trim() || undefined,
        pronouns: f.pronouns.trim() || undefined,
        email: f.email.trim(),
        uscId: f.uscId.replace(/\D/g, ""),
        year: Number(f.standing),
        gradTerm: `${f.term} ${f.year}`,
      });
      nav("/");
    } else {
      signUpOfficer({ name, email: f.email.trim(), clubId: f.clubId, officerRole: f.officerRole });
      nav("/org");
    }
  };

  const err = (k: string) => errors[k] && <p id={`${k}-err`} className="field-error" role="alert">{errors[k]}</p>;
  const aria = (k: string) => ({ "aria-invalid": !!errors[k], "aria-describedby": errors[k] ? `${k}-err` : undefined });

  return (
    <>
      <h1 className="auth-title">Create an account</h1>
      <p className="auth-lede">
        {role === "student" ? (
          <><strong>New Trojan?</strong> This tells clubs who you are. You'll fill out the rest of your profile next.</>
        ) : (
          <><strong>Run a club?</strong> Register as an officer to receive and review your club's applications.</>
        )}
      </p>
      <p className="req-note"><span className="req">*</span> Required</p>

      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div>
            <label className="field" htmlFor="first">First name <span className="req">*</span></label>
            <input id="first" className="input" autoComplete="given-name" value={f.first} onChange={(e) => set("first", e.target.value)} {...aria("first")} />
            {err("first")}
          </div>
          <div>
            <label className="field" htmlFor="last">Last name <span className="req">*</span></label>
            <input id="last" className="input" autoComplete="family-name" value={f.last} onChange={(e) => set("last", e.target.value)} {...aria("last")} />
            {err("last")}
          </div>

          {role === "student" && (
            <>
              <div>
                <label className="field" htmlFor="preferred">Preferred name <span className="optional">Optional</span></label>
                <input id="preferred" className="input" value={f.preferred} onChange={(e) => set("preferred", e.target.value)} />
              </div>
              <div>
                <label className="field" htmlFor="pronouns">Pronouns <span className="optional">Optional</span></label>
                <input id="pronouns" className="input" placeholder="e.g. she/her" value={f.pronouns} onChange={(e) => set("pronouns", e.target.value)} />
              </div>
            </>
          )}

          <div className="span-2">
            <label className="field" htmlFor="email">USC email <span className="req">*</span></label>
            <input id="email" className="input" type="email" autoComplete="email" placeholder="ttrojan@usc.edu" value={f.email} onChange={(e) => set("email", e.target.value)} {...aria("email")} />
            {err("email")}
          </div>

          {role === "student" ? (
            <>
              <div className="span-2">
                <label className="field" htmlFor="uscId">USC ID number <span className="req">*</span></label>
                <input id="uscId" className="input" inputMode="numeric" maxLength={12} placeholder="10 digits" value={f.uscId} onChange={(e) => set("uscId", e.target.value)} {...aria("uscId")} />
                <p className="hint">Used only to confirm you're a current student. Clubs never see it.</p>
                {err("uscId")}
              </div>
              <div>
                <label className="field" htmlFor="standing">Class <span className="req">*</span></label>
                <select id="standing" className="input" value={f.standing} onChange={(e) => set("standing", e.target.value)} {...aria("standing")}>
                  {STANDING.map((s, i) => <option key={i} value={i}>{s || "Select"}</option>)}
                </select>
                {err("standing")}
              </div>
              <div>
                <span className="field" id="grad-label">Expected graduation <span className="req">*</span></span>
                <div className="row" style={{ gap: 8 }} role="group" aria-labelledby="grad-label">
                  <select className="input" aria-label="Semester" value={f.term} onChange={(e) => set("term", e.target.value)}>
                    <option>Spring</option>
                    <option>Fall</option>
                  </select>
                  <select className="input" aria-label="Year" value={f.year} onChange={(e) => set("year", e.target.value)} {...aria("year")}>
                    <option value="">Year</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </div>
                {err("year")}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="field" htmlFor="clubId">Club <span className="req">*</span></label>
                <select id="clubId" className="input" value={f.clubId} onChange={(e) => set("clubId", e.target.value)} {...aria("clubId")}>
                  <option value="">Select your club</option>
                  {[...clubs].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {err("clubId")}
              </div>
              <div>
                <label className="field" htmlFor="officerRole">Your role <span className="req">*</span></label>
                <select id="officerRole" className="input" value={f.officerRole} onChange={(e) => set("officerRole", e.target.value)} {...aria("officerRole")}>
                  <option value="">Select</option>
                  {OFFICER_ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                {err("officerRole")}
              </div>
            </>
          )}
        </div>

        <label className="check">
          <input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} {...aria("agree")} />
          <span>
            {role === "student"
              ? "Clubs I apply to can see my name, preferred name, pronouns, USC email, class and the profile I submit. My USC ID stays private."
              : "I'm a current officer of this club. Campus Activities will confirm this against the club's officer list."}
          </span>
        </label>
        {err("agree")}

        <div className="auth-actions">
          <button className="btn pill-red" type="submit">Create account</button>
          <p className="subtle">Already have an account? <Link to={`/signin?as=${role}`} className="text-link">Sign in</Link></p>
        </div>
      </form>
    </>
  );
}
