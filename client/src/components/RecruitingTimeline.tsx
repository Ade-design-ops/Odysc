import { useEffect, useMemo, useState } from "react";
import type { Club, RecruitmentMilestone, RecruitmentStep } from "../../../shared/types";
import { useApp } from "../store";

const STEPS: RecruitmentStep[] = ["Applications open", "Info session", "Applications due", "Interviews", "Decisions released", "New member onboarding", "Other"];
const MAX_MILESTONES = 12;
const todayKey = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
// Calendar dates are stored as YYYY-MM-DD; noon avoids time-zone day shifts.
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const shortDay = (day: string) => asDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (day: string) => asDate(day).toLocaleDateString("en-US", { weekday: "short" });
const milestoneName = (item: RecruitmentMilestone) => item.title?.trim() || item.step;
const sortTimeline = (items: RecruitmentMilestone[]) => [...items].sort((a, b) => a.date.localeCompare(b.date) || STEPS.indexOf(a.step) - STEPS.indexOf(b.step));
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
const sameTimeline = (a: RecruitmentMilestone[], b: RecruitmentMilestone[]) => JSON.stringify(sortTimeline(a)) === JSON.stringify(sortTimeline(b));

/** Read-only timeline. Past steps fade; the next step is marked so students know where things stand. */
export function TimelineView({ items, emptyText, renderItem }: { items: RecruitmentMilestone[]; emptyText?: string; renderItem?: (item: RecruitmentMilestone, content: JSX.Element) => JSX.Element }) {
  const sorted = sortTimeline(items);
  const today = todayKey();
  const nextId = sorted.find((item) => (item.endDate ?? item.date) >= today)?.id;
  if (!sorted.length) return <p className="subtle">{emptyText ?? "No recruiting dates posted yet."}</p>;
  return (
    <ol className="rt-list">
      {sorted.map((item) => {
        const past = (item.endDate ?? item.date) < today;
        const state = item.id === nextId ? "next" : past ? "past" : "later";
        return (
          <li key={item.id} className={`rt-item ${state}`}>
            <div className="rt-when">
              <span className="rt-day">{shortDay(item.date)}</span>
              <span className="rt-weekday">{item.endDate && item.endDate !== item.date ? `to ${shortDay(item.endDate)}` : weekday(item.date)}</span>
            </div>
            <div className="rt-body">
              {(() => {
                const content = (
                  <div>
                    <div className="row-title">
                      {milestoneName(item)}
                      {state === "next" && <span className="rt-flag">Next</span>}
                      {state === "past" && <span className="sr-only"> (passed)</span>}
                    </div>
                    {item.note && <p className="rt-note">{item.note}</p>}
                  </div>
                );
                return renderItem ? renderItem(item, content) : content;
              })()}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type Draft = { step: RecruitmentStep; title: string; date: string; endDate: string; note: string };
const emptyDraft = (): Draft => ({ step: "Applications open", title: "", date: "", endDate: "", note: "" });

/** Organizer workspace section: choose how members join and publish the recruiting timeline. */
export default function RecruitingTimeline({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const { clubById, setClubSetting } = useApp();
  const club = clubById(clubId);
  const savedRecruits = club?.selectivity === "Selective";
  const savedTimeline = useMemo(() => club?.recruitmentTimeline ?? [], [club?.recruitmentTimeline]);
  const [recruits, setRecruits] = useState(savedRecruits);
  const [timeline, setTimeline] = useState<RecruitmentMilestone[]>(savedTimeline);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { setRecruits(savedRecruits); setTimeline(savedTimeline); }, [savedRecruits, savedTimeline]);
  if (!club) return null;

  const dirty = recruits !== savedRecruits || (recruits && !sameTimeline(timeline, savedTimeline));
  const membershipLabel = club.selectivity === "Open" ? "Open to all" : club.selectivity === "Selective" ? "Recruits members" : "Not set yet";

  const save = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await setClubSetting(clubId, recruits ? { selectivity: "Selective", recruitmentTimeline: sortTimeline(timeline) } : { selectivity: "Open" });
      setNotice(recruits ? "Timeline published. Students see it on your club page." : "Saved. Students see your club as open to all.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The timeline could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  };
  const upsert = (item: RecruitmentMilestone) => {
    setTimeline((current) => sortTimeline([...current.filter((entry) => entry.id !== item.id), item]));
    setEditing(null);
    setNotice("");
  };
  const remove = (id: string) => { setTimeline((current) => current.filter((entry) => entry.id !== id)); setNotice(""); };

  return (
    <section className="card panel" aria-labelledby="recruiting-heading">
      <div className="section-head">
        <div>
          <h2 id="recruiting-heading" className="h3">Recruiting timeline</h2>
          <p className="subtle">Tell students how to join {club.shortName} and when each recruiting step happens.</p>
        </div>
        {!isAdmin && <span className="chip">{membershipLabel}</span>}
      </div>

      {!isAdmin ? (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>Club administrators can edit the recruiting timeline.</p>
          {club.selectivity === "Selective"
            ? <TimelineView items={savedTimeline} />
            : <p className="subtle">{club.selectivity === "Open" ? "Your club is open to all, so it has no recruiting timeline." : "Your club hasn't said how members join yet."}</p>}
        </>
      ) : (
        <>
          <div className="segmented rt-mode" role="radiogroup" aria-label="How new members join">
            <button type="button" role="radio" aria-checked={!recruits} className={!recruits ? "on" : ""} disabled={pending} onClick={() => { setRecruits(false); setNotice(""); }}>Anyone can join</button>
            <button type="button" role="radio" aria-checked={recruits} className={recruits ? "on" : ""} disabled={pending} onClick={() => { setRecruits(true); setNotice(""); }}>We recruit members</button>
          </div>

          {!recruits ? (
            <p className="subtle">Students will see your club as open to all. Use programming events to welcome new members.</p>
          ) : (
            <>
              <TimelineView
                items={timeline}
                emptyText="Add your first recruiting date, such as when applications open."
                renderItem={(item, content) => editing === item.id
                  ? <MilestoneForm initial={item} onCancel={() => setEditing(null)} onSave={upsert} />
                  : (
                    <div className="rt-editable">
                      {content}
                      <span className="row rt-actions">
                        <button type="button" className="btn sm ghost" disabled={pending || editing !== null} onClick={() => setEditing(item.id)} aria-label={`Edit ${milestoneName(item)}`}>Edit</button>
                        <button type="button" className="btn sm ghost" disabled={pending || editing !== null} onClick={() => remove(item.id)} aria-label={`Remove ${milestoneName(item)}`}>Remove</button>
                      </span>
                    </div>
                  )}
              />
              {editing === "new"
                ? <MilestoneForm onCancel={() => setEditing(null)} onSave={upsert} />
                : (
                  <button type="button" className="btn" style={{ marginTop: 14 }} disabled={pending || editing !== null || timeline.length >= MAX_MILESTONES} onClick={() => setEditing("new")}>
                    Add milestone
                  </button>
                )}
              {timeline.length >= MAX_MILESTONES && <p className="hint">You can post up to {MAX_MILESTONES} milestones.</p>}
            </>
          )}

          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row rt-save">
            <button type="button" className="btn primary" disabled={pending || !dirty || editing !== null} onClick={() => { void save(); }}>
              {pending ? "Publishing…" : recruits ? "Publish timeline" : "Save"}
            </button>
            {dirty && !pending && <span className="subtle">Unpublished changes</span>}
            {notice && <span className="subtle" role="status">{notice}</span>}
          </div>
        </>
      )}
    </section>
  );
}

function MilestoneForm({ initial, onCancel, onSave }: { initial?: RecruitmentMilestone; onCancel: () => void; onSave: (item: RecruitmentMilestone) => void }) {
  const [draft, setDraft] = useState<Draft>(initial
    ? { step: initial.step, title: initial.title ?? "", date: initial.date, endDate: initial.endDate ?? "", note: initial.note ?? "" }
    : emptyDraft());
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const prefix = initial ? `rt-${initial.id}` : "rt-new";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const aria = (key: keyof Draft) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${prefix}-${key}-error` : undefined });
  const fieldError = (key: keyof Draft) => errors[key] && <p id={`${prefix}-${key}-error`} className="field-error" role="alert">{errors[key]}</p>;

  const submit = () => {
    const next: typeof errors = {};
    const title = draft.title.trim();
    const note = draft.note.trim();
    if (draft.step === "Other" && !title) next.title = "Name this milestone.";
    if (title.length > 80) next.title = "Use 80 characters or fewer.";
    if (!draft.date) next.date = "Choose a date.";
    if (draft.endDate && draft.date && draft.endDate < draft.date) next.endDate = "The end date can't be before the start date.";
    if (note.length > 300) next.note = "Use 300 characters or fewer.";
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    onSave({
      id: initial?.id ?? newId(),
      step: draft.step,
      date: draft.date,
      ...(title ? { title } : {}),
      ...(draft.endDate && draft.endDate !== draft.date ? { endDate: draft.endDate } : {}),
      ...(note ? { note } : {}),
    });
  };

  return (
    <div className="rt-form" role="group" aria-label={initial ? `Edit ${milestoneName(initial)}` : "New milestone"}>
      <div className="form-grid">
        <div>
          <label className="field" htmlFor={`${prefix}-step`}>Step <span className="req">*</span></label>
          <select id={`${prefix}-step`} className="input" value={draft.step} onChange={(event) => set("step", event.target.value as RecruitmentStep)}>
            {STEPS.map((step) => <option key={step} value={step}>{step}</option>)}
          </select>
        </div>
        <div>
          <label className="field" htmlFor={`${prefix}-title`}>Name {draft.step === "Other" ? <span className="req">*</span> : <span className="subtle">(optional)</span>}</label>
          <input id={`${prefix}-title`} className="input" value={draft.title} maxLength={80} placeholder={draft.step === "Other" ? "e.g. Shadow day" : draft.step} onChange={(event) => set("title", event.target.value)} {...aria("title")} />
          {fieldError("title")}
        </div>
        <div>
          <label className="field" htmlFor={`${prefix}-date`}>Date <span className="req">*</span></label>
          <input id={`${prefix}-date`} type="date" className="input" value={draft.date} onChange={(event) => set("date", event.target.value)} {...aria("date")} />
          {fieldError("date")}
        </div>
        <div>
          <label className="field" htmlFor={`${prefix}-endDate`}>End date <span className="subtle">(for multi-day steps)</span></label>
          <input id={`${prefix}-endDate`} type="date" className="input" value={draft.endDate} min={draft.date || undefined} onChange={(event) => set("endDate", event.target.value)} {...aria("endDate")} />
          {fieldError("endDate")}
        </div>
        <div className="span-2">
          <label className="field" htmlFor={`${prefix}-note`}>Note for students <span className="subtle">(optional)</span></label>
          <input id={`${prefix}-note`} className="input" value={draft.note} maxLength={300} placeholder="e.g. Interviews are 20 minutes, in person or on Zoom." onChange={(event) => set("note", event.target.value)} {...aria("note")} />
          {fieldError("note")}
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn primary sm" onClick={submit}>{initial ? "Update milestone" : "Add to timeline"}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function clubRecruits(club: Club) {
  return club.selectivity === "Selective" && (club.recruitmentTimeline?.length ?? 0) > 0;
}
