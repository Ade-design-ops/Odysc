// Profile, Common App style: sections on the left with checkmarks, one section at a time
// on the right. Resume autofill does most of the work. "Saved answers" appears only once
// you've submitted something.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Student } from "../../../shared/types";
import { api } from "../api";
import { Loading, Ring, Toast, useToast } from "../components/ui";
import { PROFILE_SECTIONS, useApp } from "../store";

const YEARS = ["", "Freshman", "Sophomore", "Junior", "Senior", "Fifth year or later", "Graduate", "Other"];
type SectionId = (typeof PROFILE_SECTIONS)[number]["id"] | "answers";

export default function Profile() {
  const { ready, profile, updateProfile, profileProgress, profileDone, answerBank, clubById, apps, saveStatus, profileSaveError, flushProfile, completeProfile, resumeUploaded, resume } = useApp();
  const sharedWith = Object.entries(apps).filter(([, a]) => a.sharedUscId).map(([id]) => clubById(id)?.shortName ?? id);
  const [active, setActive] = useState<SectionId>("academics");
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [suggested, setSuggested] = useState<Partial<Student> | null>(null);
  const [basicExtraction, setBasicExtraction] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const resumeInput = useRef<HTMLInputElement>(null);
  const uploadOwner = useRef(profile.id);
  uploadOwner.current = profile.id;
  useEffect(() => { setParsing(false); setSuggested(null); setFileError(""); }, [profile.id]);
  if (!ready) return <Loading />;

  const sections: { id: SectionId; title: string; done: boolean }[] = [
    ...PROFILE_SECTIONS.map((s) => ({ id: s.id, title: s.title, done: s.done(profile, resume) })),
    ...(answerBank.length ? [{ id: "answers" as const, title: `Saved answers (${answerBank.length})`, done: true }] : []),
  ];

  const onResume = async (file: File | undefined) => {
    if (!file) return;
    const pdf = file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name));
    if (!pdf || file.size === 0 || file.size > 5 * 1024 * 1024) return setFileError("Please upload a PDF up to 5 MB and 10 pages.");
    setFileError("");
    setSuggested(null);
    setParsing(true);
    const owner = profile.id;
    const previousResumeId = resume?.id;
    try {
      const parsed = await api.parseResume(file);
      if (uploadOwner.current !== owner) return;
      resumeUploaded(parsed.resume);
      setBasicExtraction(parsed.mode === "local");
      setSuggested(parsed);
      toast.show("Your PDF is saved privately. Review its suggestions before applying them.");
    } catch (error) {
      if (uploadOwner.current !== owner) return;
      const message = error instanceof Error ? error.message : "The PDF could not be uploaded. Try again.";
      // PDF storage can succeed before an AI suggestions request fails. Recover
      // only authoritative metadata for this same signed-in student.
      try {
        const status = await api.resumeStatus();
        if (uploadOwner.current !== owner) return;
        if (status.resume && status.resume.id !== previousResumeId) {
          resumeUploaded(status.resume);
          setFileError("Your PDF is saved. Suggestions could not be loaded; you can fill in your details manually.");
        } else setFileError(message);
      } catch { if (uploadOwner.current === owner) setFileError(message); }
    } finally { if (uploadOwner.current === owner) setParsing(false); }
  };

  const applySuggestions = () => {
    if (!suggested) return;
    const patch: Partial<Student> = {};
    if (suggested.major?.trim()) patch.major = suggested.major;
    if (!profile.year && suggested.year) patch.year = suggested.year;
    for (const key of ["skills", "interests", "experiences"] as const) {
      if (suggested[key]?.length) patch[key] = [...new Set([...profile[key], ...suggested[key]!])].filter(value => value.trim());
    }
    if (Object.keys(patch).length) updateProfile(patch);
    setSuggested(null);
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
        <input ref={resumeInput} type="file" accept="application/pdf" className="sr-only" required={!resume} aria-label={resume ? "Replace résumé PDF" : "Upload required résumé PDF"} aria-describedby={resume ? "resume-upload-note resume-upload-status" : "resume-upload-note"} onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void onResume(file); }} disabled={parsing || finishing} />
        <div>
          <div className="h3">{parsing ? "Uploading and reading your résumé…" : "Your résumé"} <span className="req">*</span></div>
          <div id="resume-upload-note" className="subtle">{parsing ? "Saving your PDF and looking for suggested profile details." : "Required to finish onboarding and get club recommendations. Upload a PDF up to 5 MB and 10 pages; review suggested details before applying them."}</div>
          {resume && <div id="resume-upload-status" className="hint" role="status">Uploaded: {resume.fileName}. You can replace this PDF anytime.</div>}
          {fileError && <div role="alert" style={{ color: "var(--cardinal)", fontSize: 13, marginTop: 4 }}>{fileError}</div>}
        </div>
        <span className="btn">{parsing ? "…" : resume ? "Replace PDF" : "Upload PDF"}</span>
      </label>

      {suggested && <div className="alert" role="status">
        <strong>Review résumé suggestions</strong>
        {basicExtraction && <p className="subtle">Using basic text extraction. Review suggestions; some details may need entering manually.</p>}
        <p className="subtle">{[suggested.major, suggested.skills?.length ? `${suggested.skills.length} skills` : "", suggested.interests?.length ? `${suggested.interests.length} interests` : "", suggested.experiences?.length ? `${suggested.experiences.length} experience entries` : ""].filter(Boolean).join(" · ") || "No extra details could be extracted. Your PDF is saved; you can enter your profile yourself."}</p>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={applySuggestions}>Apply suggestions</button><button className="btn ghost" onClick={() => setSuggested(null)}>Keep my entered details</button></div>
      </div>}

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
              <Field label="Full name"><input className="input" maxLength={100} value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} /></Field>
              <div className="form-grid">
                <Field label="Preferred name"><input className="input" maxLength={100} value={profile.preferredName ?? ""} onChange={(e) => updateProfile({ preferredName: e.target.value })} /></Field>
                <Field label="Pronouns"><input className="input" maxLength={80} value={profile.pronouns ?? ""} placeholder="Optional" onChange={(e) => updateProfile({ pronouns: e.target.value })} /></Field>
              </div>
              <Field label="USC email"><input className="input" value={profile.email} disabled /></Field>
              <Field label="USC ID (optional)">
                <input className="input" inputMode="numeric" maxLength={10} value={profile.uscId ?? ""} aria-invalid={!!profile.uscId && !/^\d{10}$/.test(profile.uscId)} placeholder="10 digits, only if you choose to provide it" onChange={(event) => updateProfile({ uscId: event.target.value.replace(/\D/g, "").slice(0, 10) })} />
                <span className="hint">{sharedWith.length ? `Private. You agreed to share it with ${sharedWith.join(", ")} only.` : "Optional and private. This number is not used to verify enrollment. Clubs only see it with your consent."}</span>
                {!!profile.uscId && !/^\d{10}$/.test(profile.uscId) && <span className="field-error" role="alert">Enter all 10 digits, or leave it blank, to save your profile.</span>}
              </Field>
            </Fields>
          )}
          {active === "academics" && (
            <Fields title="Academics">
              <Field label="Major"><input className="input" maxLength={150} value={profile.major} placeholder="e.g. Computer Science" onChange={(e) => updateProfile({ major: e.target.value })} /></Field>
              <Field label="Class">
                <select className="input" value={profile.year} onChange={(e) => updateProfile({ year: Number(e.target.value) })}>
                  {YEARS.map((y, i) => <option key={i} value={i}>{y || "Select year"}</option>)}
                </select>
              </Field>
              {profile.gradTerm && <Field label="Expected graduation"><input className="input" value={profile.gradTerm} disabled /></Field>}
            </Fields>
          )}
          {active === "experience" && (
            <Fields title="Résumé & experience" hint="The résumé PDF above is required. Projects, jobs, volunteering, and the details below are optional. One experience per line.">
              <textarea
                className="input"
                maxLength={4000}
                value={profile.experiences.join("\n")}
                placeholder="Built a line-following robot…"
                onChange={(e) => updateProfile({ experiences: e.target.value.split("\n").filter((l, i, a) => l.trim() || i === a.length - 1) })}
              />
              <Field label="Short bio (optional)"><textarea className="input" maxLength={1500} value={profile.bio ?? ""} placeholder="A little about you." onChange={(e) => updateProfile({ bio: e.target.value })} /></Field>
              <Field label="Goals (optional)"><TagInput value={profile.goals ?? []} placeholder="Meet friends, build skills…" onChange={(goals) => updateProfile({ goals })} /></Field>
            </Fields>
          )}
          {active === "interests" && (
            <Fields title="Skills & interests" hint="Press Enter or use commas between items. Used to match you with clubs.">
              <Field label="Skills (optional)"><TagInput value={profile.skills} onChange={(skills) => updateProfile({ skills })} placeholder="Python, Public speaking…" /></Field>
              <Field label="Interests"><TagInput value={profile.interests} onChange={(interests) => updateProfile({ interests })} placeholder="Robotics, Startups…" /></Field>
            </Fields>
          )}
          {active === "answers" && (
            <Fields title="Saved answers" hint="Answers you chose to save. When another club asks something similar, we'll offer them back.">
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
              <span className="subtle" role="status" aria-live="polite">{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? profileSaveError || "Could not save. Please try again." : "Edits save automatically"}</span>
              {profileDone ? (
                <button className="btn primary" disabled={finishing || parsing} onClick={async () => { setFinishing(true); try { await flushProfile(); await completeProfile(); nav("/search"); } catch (error) { toast.show(error instanceof Error ? error.message : "Could not finish saving your profile."); } finally { setFinishing(false); } }}>{finishing ? "Saving…" : "Search clubs"}</button>
              ) : !resume && profile.name.trim() && profile.major.trim() && profile.year > 0 && profile.interests.some((interest) => interest.trim()) ? (
                <button className="btn primary" disabled={parsing || finishing} onClick={() => resumeInput.current?.click()}>{parsing ? "Uploading…" : "Upload required PDF"}</button>
              ) : (
                <button
                  className="btn"
                  disabled={parsing || finishing}
                  onClick={() => {
                    const i = PROFILE_SECTIONS.findIndex((s) => s.id === active);
                    const next = PROFILE_SECTIONS.slice(i + 1).concat(PROFILE_SECTIONS.slice(0, i)).find((s) => !s.done(profile, resume));
                    if (next) setActive(next.id);
                    else toast.show(active === "interests" ? "Add at least one interest. Press Enter or click outside the field to save it." : "Complete this section before searching for clubs.");
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
