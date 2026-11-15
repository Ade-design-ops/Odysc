// Profile, Common App style: sections on the left with checkmarks, one section at a time
// on the right. Resume autofill does most of the work. "Saved answers" appears only once
// you've submitted something.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Loading, Ring, Toast, useToast } from "../components/ui";
import { PROFILE_SECTIONS, useApp } from "../store";

const YEARS = ["", "Freshman", "Sophomore", "Junior", "Senior"];
type SectionId = (typeof PROFILE_SECTIONS)[number]["id"] | "answers";

export default function Profile() {
  const { ready, profile, updateProfile, profileProgress, profileDone, answerBank, clubById, apps } = useApp();
  const sharedWith = Object.entries(apps).filter(([, a]) => a.sharedUscId).map(([id]) => clubById(id)?.shortName ?? id);
  const [active, setActive] = useState<SectionId>("academics");
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState("");
  const toast = useToast();
  const nav = useNavigate();
  if (!ready) return <Loading />;

  const sections: { id: SectionId; title: string; done: boolean }[] = [
    ...PROFILE_SECTIONS.map((s) => ({ id: s.id, title: s.title, done: s.done(profile) })),
    ...(answerBank.length ? [{ id: "answers" as const, title: `Saved answers (${answerBank.length})`, done: true }] : []),
  ];

  const onResume = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") return setFileError("Please upload a PDF.");
    setFileError("");
    setParsing(true);
    const parsed = await api.parseResume(file.name);
    updateProfile(parsed);
    setParsing(false);
    toast.show("Filled from your resume. Give each section a quick look.");
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h1">Profile</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Every club you apply to sees this profile.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Ring value={profileProgress} size={36} />
          <span className="subtle">{Math.round(profileProgress * 100)}% complete</span>
        </div>
      </div>

      <label className={`dropzone ${parsing ? "busy" : ""}`}>
        <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => onResume(e.target.files?.[0])} disabled={parsing} />
        <div>
          <div className="h3">{parsing ? "Reading your resume…" : "Autofill from your resume"}</div>
          <div className="subtle">{parsing ? "Pulling out your major, experience and skills." : "Upload a PDF and we'll fill in the sections below. You can edit anything."}</div>
          {fileError && <div role="alert" style={{ color: "var(--cardinal)", fontSize: 13, marginTop: 4 }}>{fileError}</div>}
        </div>
        <span className="btn">{parsing ? "…" : "Upload PDF"}</span>
      </label>

      <div className="split">
        <aside className="side-list" aria-label="Profile sections">
          {sections.map((s) => (
            <button key={s.id} className={`side-item ${active === s.id ? "active" : ""}`} onClick={() => setActive(s.id)}>
              <Ring value={s.done ? 1 : 0} size={18} />
              <span>{s.title}</span>
            </button>
          ))}
        </aside>

        <section className="card panel" key={active}>
          {active === "personal" && (
            <Fields title="Personal" hint="From your account. Clubs see everything here except your USC ID.">
              <Field label="Full name"><input className="input" value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} /></Field>
              <div className="form-grid">
                <Field label="Preferred name"><input className="input" value={profile.preferredName ?? ""} onChange={(e) => updateProfile({ preferredName: e.target.value || undefined })} /></Field>
                <Field label="Pronouns"><input className="input" value={profile.pronouns ?? ""} placeholder="Optional" onChange={(e) => updateProfile({ pronouns: e.target.value || undefined })} /></Field>
              </div>
              <Field label="USC email"><input className="input" value={profile.email} disabled /></Field>
              <Field label="USC ID">
                <input className="input" value={profile.uscId ? `•••••• ${profile.uscId.slice(-4)}` : ""} disabled />
                <span className="hint">{sharedWith.length ? `Private. You agreed to share it with ${sharedWith.join(", ")} only.` : "Private. Clubs only see it if they need it and you agree when you apply."}</span>
              </Field>
            </Fields>
          )}
          {active === "academics" && (
            <Fields title="Academics">
              <Field label="Major"><input className="input" value={profile.major} placeholder="e.g. Computer Science" onChange={(e) => updateProfile({ major: e.target.value })} /></Field>
              <Field label="Class">
                <select className="input" value={profile.year} onChange={(e) => updateProfile({ year: Number(e.target.value) })}>
                  {YEARS.map((y, i) => <option key={i} value={i}>{y || "Select year"}</option>)}
                </select>
              </Field>
              {profile.gradTerm && <Field label="Expected graduation"><input className="input" value={profile.gradTerm} disabled /></Field>}
            </Fields>
          )}
          {active === "experience" && (
            <Fields title="Experience" hint="Projects, jobs and volunteering. One per line.">
              <textarea
                className="input"
                value={profile.experiences.join("\n")}
                placeholder="Built a line-following robot…"
                onChange={(e) => updateProfile({ experiences: e.target.value.split("\n").filter((l, i, a) => l.trim() || i === a.length - 1) })}
              />
            </Fields>
          )}
          {active === "interests" && (
            <Fields title="Skills & interests" hint="Press Enter or use commas between items. Used to match you with clubs.">
              <Field label="Skills"><TagInput value={profile.skills} onChange={(skills) => updateProfile({ skills })} placeholder="Python, Public speaking…" /></Field>
              <Field label="Interests"><TagInput value={profile.interests} onChange={(interests) => updateProfile({ interests })} placeholder="Robotics, Startups…" /></Field>
            </Fields>
          )}
          {active === "answers" && (
            <Fields title="Saved answers" hint="Everything you've submitted. When another club asks something similar, we'll offer it back.">
              {answerBank.map((b) => (
                <div key={b.id} className="saved-answer">
                  <div className="row-title">{b.prompt}</div>
                  <div className="subtle">Written for {clubById(b.fromClubId)?.shortName}</div>
                  <p>{b.text}</p>
                </div>
              ))}
            </Fields>
          )}

          {active !== "answers" && (
            <div className="row between" style={{ marginTop: 20 }}>
              <span className="subtle">Saved automatically</span>
              {profileDone ? (
                <button className="btn primary" onClick={() => nav("/search")}>Search clubs</button>
              ) : (
                <button
                  className="btn"
                  onClick={() => {
                    const i = PROFILE_SECTIONS.findIndex((s) => s.id === active);
                    const next = PROFILE_SECTIONS.slice(i + 1).concat(PROFILE_SECTIONS.slice(0, i)).find((s) => !s.done(profile));
                    if (next) setActive(next.id);
                  }}
                >
                  Next section
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      <Toast message={toast.msg} onDone={toast.clear} />
    </>
  );
}

function Fields({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h2 className="h2" style={{ fontSize: 24 }}>{title}</h2>
        {hint && <p className="subtle" style={{ margin: "2px 0 0" }}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="field">{label}</span>
      {children}
    </label>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText("");
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip removable">
          {t}
          <button aria-label={`Remove ${t}`} onClick={(e) => { e.preventDefault(); onChange(value.filter((x) => x !== t)); }}>×</button>
        </span>
      ))}
      <input
        value={text}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
