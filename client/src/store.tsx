// Shared state comes from authenticated backend responses, never a browser user table.
// Editable drafts stay responsive while writes are serialized to the shared workspace.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account, AppStatus, Club, ClubEvent, Interview, Match, PersonalEvent, Student } from "../../shared/types";
import { api, ApiError, setApiActor, type ClubApplicationState, type ClubSettings, type Decision, type OfficerSignupInfo, type OrganizationState, type RegistrationResult, type SessionState, type StudentSignupInfo, type WorkspacePatch, type WorkspaceState } from "./api";

export type { ClubSettings, Decision } from "./api";
export type Draft = Record<string, string>;
export type ClubApp = ClubApplicationState;
export const VERIFY_OFFICERS = true;

export const PROFILE_SECTIONS = [
  { id: "personal", title: "Personal", done: (s: Student) => !!s.name.trim() && !!s.email },
  { id: "academics", title: "Academics", done: (s: Student) => !!s.major.trim() && s.year > 0 },
  { id: "experience", title: "Experience", done: (_s: Student) => true },
  { id: "interests", title: "Skills & interests", done: (s: Student) => s.interests.some((interest) => interest.trim()) },
] as const;

const emptyProfile = (): Student => ({ id: "", name: "", email: "", major: "", year: 0, skills: [], interests: [], experiences: [], bio: "", goals: [] });
const emptyWorkspace = (): WorkspaceState => ({ version: 0, myClubs: [], drafts: {}, apps: {}, applicationIds: {}, answerBank: [], reminders: [], seenUnlock: false, calAdded: [], personal: [], calColors: {}, calHidden: [], interviews: {} });
const emptyOrganization = (): OrganizationState => ({ teams: {}, scores: {}, decisions: {}, clubSettings: {}, interviews: {}, myMembership: null });
interface DataState extends WorkspaceState, OrganizationState {
  account: Account | null;
  profile: Student;
}
const emptyState = (): DataState => ({ ...emptyWorkspace(), ...emptyOrganization(), account: null, profile: emptyProfile() });
const completeBasics = (student: Student) => !!student.name.trim() && student.year > 0 && !!student.major.trim() && student.interests.some((interest) => interest.trim());
const actorKey = (state: Pick<DataState, "account" | "profile">) => state.account ? state.profile.id || state.account.email : "";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed. Please try again.";

function normalizeWorkspace(value?: Partial<WorkspaceState> | null): WorkspaceState {
  return { ...emptyWorkspace(), ...value, applicationIds: value?.applicationIds ?? {}, interviews: value?.interviews ?? {} };
}
function normalizeOrganization(value?: Partial<OrganizationState> | null): OrganizationState {
  const normalized = { ...emptyOrganization(), ...value };
  normalized.myMembership = value?.myMembership ?? value?.membership ?? null;
  return normalized;
}
function normalizeProfile(value?: Partial<Student> | null): Student {
  return { ...emptyProfile(), ...value, skills: value?.skills ?? [], interests: value?.interests ?? [], experiences: value?.experiences ?? [], goals: value?.goals ?? [] };
}
function editableProfile(student: Student): Partial<Student> {
  return {
    name: student.name, preferredName: student.preferredName ?? "", pronouns: student.pronouns ?? "",
    uscId: student.uscId ?? "", gradTerm: student.gradTerm ?? "", major: student.major, year: student.year,
    skills: [...student.skills], interests: [...student.interests], experiences: [...student.experiences],
    bio: student.bio ?? "", goals: [...(student.goals ?? [])],
  };
}
function mergeData(account: Account | null, profile: Student, workspace: WorkspaceState, organization: OrganizationState): DataState {
  return { ...workspace, ...organization, interviews: { ...workspace.interviews, ...organization.interviews }, account, profile };
}

export interface AppState extends DataState {
  ready: boolean;
  loadError: string | null;
  mutationError: string | null;
  clearMutationError: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  profileSaveError: string | null;
  clubs: Club[];
  events: ClubEvent[];
  createClubEvent: (input: Omit<ClubEvent, "id" | "clubId">) => Promise<void>;
  matches: Match[];
  profileDone: boolean;
  profileProgress: number;
  clubById: (id: string) => Club | undefined;
  applicationIdForClub: (id: string) => string | undefined;
  updateProfile: (patch: Partial<Student>) => void;
  flushProfile: () => Promise<void>;
  completeProfile: () => Promise<void>;
  refresh: () => Promise<void>;
  addClub: (id: string) => Promise<void>;
  removeClub: (id: string) => Promise<void>;
  saveDraft: (clubId: string, draft: Draft) => void;
  submit: (clubId: string) => Promise<void>;
  submitWithId: (clubId: string, shareId: boolean, rememberAnswers?: boolean) => Promise<void>;
  setStatus: (clubId: string, status: AppStatus) => Promise<void>;
  toggleReminder: (clubId: string) => Promise<void>;
  markUnlockSeen: () => Promise<void>;
  reset: () => Promise<void>;
  signUpStudent: (info: StudentSignupInfo) => Promise<RegistrationResult>;
  signUpOfficer: (info: OfficerSignupInfo) => Promise<RegistrationResult>;
  signIn: (email: string, password: string, as: "student" | "officer") => Promise<Account>;
  signOut: () => Promise<void>;
  toggleCalEvent: (eventId: string) => Promise<void>;
  addPersonal: (event: Omit<PersonalEvent, "id">) => Promise<void>;
  removePersonal: (id: string) => Promise<void>;
  setCalColor: (key: string, color: string) => Promise<void>;
  toggleCalHidden: (key: string) => Promise<void>;
  setScore: (applicationId: string, criterion: string, value: number) => Promise<void>;
  decide: (applicationId: string, decision: Decision) => Promise<void>;
  scheduleInterview: (interview: Omit<Interview, "invitedAt" | "booked">) => Promise<void>;
  bookInterview: (applicationId: string, slot: string | null) => Promise<void>;
  demoInterview: (clubId: string) => Promise<void>;
  inviteMember: (email: string, name: string, officerRole: string) => Promise<string | null>;
  approveMember: (email: string) => Promise<void>;
  removeMember: (email: string) => Promise<void>;
  setClubSetting: (clubId: string, patch: ClubSettings) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<DataState>(emptyState);
  const pRef = useRef(p);
  const workspaceRef = useRef<WorkspaceState>(emptyWorkspace());
  const organizationRef = useRef<OrganizationState>(emptyOrganization());
  const epochRef = useRef(0);
  const aliveRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AppState["saveStatus"]>("idle");
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const eventsRevision = useRef(0);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const profileTimer = useRef<ReturnType<typeof setTimeout>>();
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const profileChain = useRef<Promise<void>>(Promise.resolve());
  const workspaceChain = useRef<Promise<void>>(Promise.resolve());
  const organizationChain = useRef<Promise<void>>(Promise.resolve());
  const pendingProfile = useRef<Partial<Student>>({});
  const pendingDrafts = useRef<Record<string, Draft>>({});
  const inFlightDrafts = useRef<Record<string, Draft>>({});
  const profileRevision = useRef(0);
  const profileDirty = useRef(false);
  const lastMatchInput = useRef("");
  const matchingInput = useRef("");
  const matchEvidenceRevision = useRef(0);
  const lastMatchAt = useRef(0);
  const matchTimer = useRef<ReturnType<typeof setTimeout>>();
  const matchLoader = useRef<(epoch: number) => Promise<void>>(async () => undefined);
  const organizationRevision = useRef(0);

  const commit = useCallback((next: DataState | ((previous: DataState) => DataState)) => {
    if (!aliveRef.current) return;
    const state = typeof next === "function" ? next(pRef.current) : next;
    pRef.current = state;
    setP(state);
  }, []);
  const sameActor = useCallback((epoch: number, actor: string) => aliveRef.current && epoch === epochRef.current && actor === actorKey(pRef.current), []);
  const publishWorkspace = useCallback((value: WorkspaceState) => {
    if (value.version < workspaceRef.current.version) return;
    workspaceRef.current = normalizeWorkspace(value);
    const visible = { ...workspaceRef.current, drafts: { ...workspaceRef.current.drafts, ...inFlightDrafts.current, ...pendingDrafts.current } };
    commit((current) => mergeData(current.account, current.profile, visible, organizationRef.current));
  }, [commit]);
  const publishOrganization = useCallback((value: OrganizationState) => {
    organizationRef.current = normalizeOrganization(value);
    const workspace = { ...workspaceRef.current, drafts: { ...workspaceRef.current.drafts, ...inFlightDrafts.current, ...pendingDrafts.current } };
    commit((current) => mergeData(current.account, current.profile, workspace, organizationRef.current));
  }, [commit]);
  const clearPending = useCallback(() => {
    clearTimeout(profileTimer.current);
    clearTimeout(draftTimer.current);
    clearTimeout(matchTimer.current);
    pendingProfile.current = {};
    pendingDrafts.current = {};
    inFlightDrafts.current = {};
    profileDirty.current = false;
    lastMatchInput.current = "";
    matchingInput.current = "";
    matchEvidenceRevision.current += 1;
    lastMatchAt.current = 0;
    organizationRevision.current += 1;
    profileRevision.current += 1;
    profileChain.current = Promise.resolve();
    workspaceChain.current = Promise.resolve();
    organizationChain.current = Promise.resolve();
  }, []);
  const applySession = useCallback((session: SessionState) => {
    const account = session.account ?? null;
    const incomingProfile = normalizeProfile(session.profile);
    setApiActor(account ? incomingProfile.id : null);
    const previousActor = actorKey(pRef.current);
    const incomingActor = account ? incomingProfile.id || account.email : "";
    if (previousActor !== incomingActor) {
      clearPending();
      setAllMatches([]);
      setSaveStatus("idle");
      setProfileSaveError(null);
    }
    const incomingWorkspace = normalizeWorkspace(session.workspace);
    if (previousActor !== incomingActor || incomingWorkspace.version >= workspaceRef.current.version) workspaceRef.current = incomingWorkspace;
    organizationRef.current = normalizeOrganization(session.organization);
    const profile = previousActor === incomingActor && profileDirty.current ? pRef.current.profile : incomingProfile;
    const visibleWorkspace = { ...workspaceRef.current, drafts: { ...workspaceRef.current.drafts, ...inFlightDrafts.current, ...pendingDrafts.current } };
    commit(mergeData(account, profile, visibleWorkspace, organizationRef.current));
  }, [clearPending, commit]);

  const notifyFailure = useCallback((error: unknown) => {
    if (!aliveRef.current) return;
    if (error instanceof ApiError && error.actorId && error.actorId !== pRef.current.profile.id) return;
    if (error instanceof ApiError && error.code === "SESSION_CHANGED" && error.actorId) {
      epochRef.current += 1;
      clearPending();
      applySession({ account: null, profile: null, workspace: emptyWorkspace(), organization: null });
      setAllMatches([]);
      setLoadError(null);
    }
    setMutationError(errorMessage(error));
  }, [applySession, clearPending]);
  // Attaching a rejection handler also keeps old fire-and-forget UI callers safe.
  // Awaiting callers still receive the original rejection and can withhold success UI.
  const observed = useCallback(<T,>(task: Promise<T>): Promise<T> => {
    void task.catch(notifyFailure);
    return task;
  }, [notifyFailure]);

  const loadMatches = useCallback(async (epoch: number) => {
    if (!aliveRef.current || epoch !== epochRef.current) return;
    const actor = actorKey(pRef.current);
    if (!actor || pRef.current.account?.role !== "student" || !completeBasics(pRef.current.profile)) {
      if (aliveRef.current && epoch === epochRef.current) setAllMatches([]);
      return;
    }
    const input = `${actor}:${matchEvidenceRevision.current}:${JSON.stringify(pRef.current.profile)}`;
    if (lastMatchInput.current === input || matchingInput.current === input) return;
    // Autosaving a paragraph must not start an AI request on every pause in typing.
    const wait = 10_000 - (Date.now() - lastMatchAt.current);
    if (wait > 0) {
      clearTimeout(matchTimer.current);
      matchTimer.current = setTimeout(() => { void matchLoader.current(epoch); }, wait + 25);
      return;
    }
    clearTimeout(matchTimer.current);
    lastMatchAt.current = Date.now();
    matchingInput.current = input;
    try {
      const matches = await api.matches();
      const currentInput = `${actor}:${matchEvidenceRevision.current}:${JSON.stringify(pRef.current.profile)}`;
      if (sameActor(epoch, actor) && input === currentInput) { lastMatchInput.current = input; setAllMatches(matches); }
    } catch (error) {
      const currentInput = `${actor}:${matchEvidenceRevision.current}:${JSON.stringify(pRef.current.profile)}`;
      if (sameActor(epoch, actor) && input === currentInput) { setAllMatches([]); notifyFailure(error); }
    } finally {
      if (matchingInput.current === input) matchingInput.current = "";
    }
  }, [notifyFailure, sameActor]);
  matchLoader.current = loadMatches;

  const load = useCallback(async (epoch: number, includeDirectory: boolean) => {
    const startedProfileRevision = profileRevision.current;
    const startedOrganizationRevision = organizationRevision.current;
    const startedEventsRevision = eventsRevision.current;
    const work: [Promise<SessionState>, Promise<Club[]>, Promise<ClubEvent[]>] = [
      api.session(), includeDirectory ? api.clubs() : Promise.resolve(clubs), includeDirectory ? api.events() : Promise.resolve(events),
    ];
    const [sessionResult, clubsResult, eventsResult] = await Promise.allSettled(work);
    if (!aliveRef.current || epoch !== epochRef.current) return;
    const failures: string[] = [];
    if (sessionResult.status === "fulfilled") {
      const incoming = sessionResult.value;
      const incomingActor = incoming.account ? incoming.profile?.id || incoming.account.email : "";
      const same = incomingActor === actorKey(pRef.current);
      applySession({
        ...incoming,
        profile: same && startedProfileRevision !== profileRevision.current ? pRef.current.profile : incoming.profile,
        organization: same && startedOrganizationRevision !== organizationRevision.current ? organizationRef.current : incoming.organization,
      });
    }
    else {
      if (sessionResult.reason instanceof ApiError && [401, 403].includes(sessionResult.reason.status)) {
        epochRef.current += 1;
        clearPending();
        applySession({ account: null, profile: null, workspace: emptyWorkspace(), organization: null });
        setAllMatches([]);
      }
      failures.push(errorMessage(sessionResult.reason));
    }
    if (includeDirectory && clubsResult.status === "fulfilled") setClubs(clubsResult.value);
    else if (includeDirectory && clubsResult.status === "rejected") failures.push(errorMessage(clubsResult.reason));
    // A directory response started before publication must not erase the new event.
    if (includeDirectory && eventsResult.status === "fulfilled" && startedEventsRevision === eventsRevision.current) setEvents(eventsResult.value);
    else if (includeDirectory && eventsResult.status === "rejected") failures.push(errorMessage(eventsResult.reason));
    setLoadError(failures[0] ?? null);
    setReady(true);
    if (sessionResult.status === "fulfilled") void loadMatches(epoch);
  }, [applySession, clearPending, clubs, events, loadMatches]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    aliveRef.current = true;
    const epoch = ++epochRef.current;
    void loadRef.current(epoch, true);
    return () => { aliveRef.current = false; epochRef.current += 1; clearTimeout(profileTimer.current); clearTimeout(draftTimer.current); clearTimeout(matchTimer.current); };
  }, []);

  const enqueueWorkspace = useCallback((patchFor: (current: WorkspaceState) => WorkspacePatch): Promise<void> => {
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    if (!actor) return observed(Promise.reject(new ApiError("Sign in to save your changes.", 401, "UNAUTHORIZED")));
    const task = workspaceChain.current.catch(() => undefined).then(async () => {
      if (!sameActor(epoch, actor)) return;
      let result: WorkspaceState;
      try {
        result = await api.saveWorkspace({ ...patchFor(workspaceRef.current), expectedVersion: workspaceRef.current.version });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || error.code === "SESSION_CHANGED") throw error;
        const latest = await api.workspace();
        if (!sameActor(epoch, actor)) return;
        workspaceRef.current = normalizeWorkspace(latest);
        result = await api.saveWorkspace({ ...patchFor(workspaceRef.current), expectedVersion: workspaceRef.current.version });
      }
      if (sameActor(epoch, actor)) publishWorkspace(result);
    });
    workspaceChain.current = task;
    return observed(task);
  }, [observed, publishWorkspace, sameActor]);

  const flushDrafts = useCallback((): Promise<void> => {
    clearTimeout(draftTimer.current);
    const batch = pendingDrafts.current;
    if (!Object.keys(batch).length) return workspaceChain.current.catch(() => undefined);
    pendingDrafts.current = {};
    inFlightDrafts.current = { ...inFlightDrafts.current, ...batch };
    const task = enqueueWorkspace((current) => ({ drafts: { ...current.drafts, ...batch } }));
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    const finished = task.then(() => {
      if (!sameActor(epoch, actor)) return;
      for (const [clubId, draft] of Object.entries(batch)) if (inFlightDrafts.current[clubId] === draft) delete inFlightDrafts.current[clubId];
      publishWorkspace(workspaceRef.current);
    }, (error) => {
      if (sameActor(epoch, actor)) {
        pendingDrafts.current = { ...batch, ...pendingDrafts.current };
        for (const [clubId, draft] of Object.entries(batch)) if (inFlightDrafts.current[clubId] === draft) delete inFlightDrafts.current[clubId];
      }
      throw error;
    });
    return observed(finished);
  }, [enqueueWorkspace, observed, publishWorkspace, sameActor]);

  const flushProfile = useCallback((): Promise<void> => {
    clearTimeout(profileTimer.current);
    if (!Object.keys(pendingProfile.current).length) return profileChain.current;
    // A queued later snapshot carries all current edits, including an earlier failed write.
    const patch = editableProfile(pRef.current.profile);
    pendingProfile.current = {};
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    const revision = profileRevision.current;
    if (!actor) return observed(Promise.reject(new ApiError("Sign in to save your profile.", 401, "UNAUTHORIZED")));
    setSaveStatus("saving");
    const task = profileChain.current.catch(() => undefined).then(async () => {
      if (!sameActor(epoch, actor)) return;
      try {
        const saved = normalizeProfile(await api.saveProfile(patch));
        if (!sameActor(epoch, actor)) return;
        if (revision === profileRevision.current) {
          profileDirty.current = false;
          commit((current) => ({ ...current, profile: saved, account: current.account ? { ...current.account, name: saved.name } : null }));
          setSaveStatus("saved");
          setProfileSaveError(null);
          void loadMatches(epoch);
        }
      } catch (error) {
        if (sameActor(epoch, actor)) {
          // Retain unsaved input for the next save attempt rather than discarding it.
          if (revision === profileRevision.current) pendingProfile.current = { ...patch, ...pendingProfile.current };
          setSaveStatus("error");
          setProfileSaveError(errorMessage(error));
        }
        throw error;
      }
    });
    profileChain.current = task;
    return observed(task);
  }, [commit, loadMatches, observed, sameActor]);

  const updateProfile = useCallback((patch: Partial<Student>) => {
    if (!actorKey(pRef.current)) { notifyFailure(new Error("Sign in to save your profile.")); return; }
    // Identity/email belong to the authenticated session, never editable profile patches.
    const { id: _id, email: _email, ...input } = patch;
    const editable = Object.fromEntries(Object.entries(input).map(([key, value]) => [key,
      value === undefined ? ["skills", "interests", "experiences", "goals"].includes(key) ? [] : "" : value,
    ])) as Partial<Student>;
    if (!Object.keys(editable).length) return;
    pendingProfile.current = { ...pendingProfile.current, ...editable };
    profileRevision.current += 1;
    profileDirty.current = true;
    commit((current) => ({ ...current, profile: { ...current.profile, ...editable } }));
    setSaveStatus("saving");
    setProfileSaveError(null);
    clearTimeout(profileTimer.current);
    profileTimer.current = setTimeout(() => { void flushProfile().catch(() => undefined); }, 500);
  }, [commit, flushProfile, notifyFailure]);

  const refresh = useCallback(async () => {
    await flushProfile();
    await flushDrafts();
    await workspaceChain.current.catch(() => undefined);
    await organizationChain.current.catch(() => undefined);
    lastMatchInput.current = "";
    matchEvidenceRevision.current += 1;
    lastMatchAt.current = 0;
    await loadRef.current(epochRef.current, true);
  }, [flushDrafts, flushProfile]);

  useEffect(() => {
    if (!p.account || !ready) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden" || profileDirty.current || Object.keys(pendingDrafts.current).length || Object.keys(inFlightDrafts.current).length) return;
      void Promise.allSettled([workspaceChain.current, organizationChain.current]).then(() => loadRef.current(epochRef.current, false));
    }, 30_000);
    return () => clearInterval(timer);
  }, [p.account, ready]);

  const signIn = useCallback(async (email: string, password: string, as: "student" | "officer"): Promise<Account> => {
    const epoch = ++epochRef.current;
    clearPending();
    const session = await api.login(email, password, as);
    if (!session.account) throw new ApiError("The sign-in session could not be established.", 401, "UNAUTHORIZED");
    if (!aliveRef.current || epoch !== epochRef.current) throw new Error("The sign-in request was replaced. Please try again.");
    applySession(session);
    setMutationError(null);
    setLoadError(null);
    setReady(true);
    void loadRef.current(epoch, true);
    return session.account;
  }, [applySession, clearPending]);

  const register = useCallback(async (operation: () => Promise<RegistrationResult>): Promise<RegistrationResult> => {
    const epoch = ++epochRef.current;
    clearPending();
    const result = await operation();
    if (!aliveRef.current || epoch !== epochRef.current) throw new Error("The signup request was replaced. Please try again.");
    const session = result.session ?? (!result.requiresEmailConfirmation ? await api.session() : undefined);
    if (session?.account) {
      applySession(session);
      setReady(true);
      void loadRef.current(epoch, true);
      return { ...result, session, account: session.account };
    }
    if (!result.requiresEmailConfirmation) throw new ApiError("The new account could not be signed in. Please sign in to continue.", 401, "UNAUTHORIZED");
    applySession({ account: null, profile: null, workspace: emptyWorkspace(), organization: null });
    return result;
  }, [applySession, clearPending]);

  const signOut = useCallback(async () => {
    try { await flushProfile(); await flushDrafts(); } catch { /* Sign-out must still be available after a save failure. */ }
    await workspaceChain.current.catch(() => undefined);
    await organizationChain.current.catch(() => undefined);
    try { await api.logout(); }
    catch (error) { if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) { notifyFailure(error); throw error; } }
    epochRef.current += 1;
    clearPending();
    applySession({ account: null, profile: null, workspace: emptyWorkspace(), organization: null });
    setMutationError(null);
    setAllMatches([]);
  }, [applySession, clearPending, flushDrafts, flushProfile, notifyFailure]);

  const mutateOrganization = useCallback((operation: () => Promise<OrganizationState>): Promise<void> => {
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    if (!actor) return observed(Promise.reject(new ApiError("Sign in to continue.", 401, "UNAUTHORIZED")));
    organizationRevision.current += 1;
    const task = organizationChain.current.catch(() => undefined).then(async () => {
      if (!sameActor(epoch, actor)) return;
      const result = await operation();
      if (sameActor(epoch, actor)) publishOrganization(result);
    });
    organizationChain.current = task;
    return observed(task);
  }, [observed, publishOrganization, sameActor]);

  const submit = useCallback((clubId: string, shareUscId = false, rememberAnswers = false): Promise<void> => observed((async () => {
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    if (!actor) throw new ApiError("Sign in to submit an application.", 401, "UNAUTHORIZED");
    await flushProfile();
    await flushDrafts();
    if (!sameActor(epoch, actor)) throw new ApiError("Your session changed. Sign in again before submitting.", 409, "SESSION_CHANGED");
    const club = clubs.find((item) => item.id === clubId);
    if (!actor || !club) throw new Error("Choose an available club after signing in.");
    const draft = pRef.current.drafts[clubId] ?? {};
    const answers = club.questions.map((question) => ({ questionId: question.id, text: (draft[question.id] ?? "").trim() }));
    const result = await api.submitApplication(clubId, answers, shareUscId, rememberAnswers);
    if (sameActor(epoch, actor)) publishWorkspace(result.workspace);
  })()), [clubs, flushDrafts, flushProfile, observed, publishWorkspace, sameActor]);

  const requireOfficerClub = useCallback(() => {
    const clubId = pRef.current.account?.role === "officer" ? pRef.current.account.clubId : undefined;
    if (!clubId) throw new Error("Sign in as a club officer to continue.");
    return clubId;
  }, []);

  const createClubEvent = useCallback((input: Omit<ClubEvent, "id" | "clubId">): Promise<void> => {
    const epoch = epochRef.current;
    const actor = actorKey(pRef.current);
    let clubId: string;
    const requireAdmin = () => {
      const account = pRef.current.account;
      const membership = organizationRef.current.myMembership;
      const currentClub = requireOfficerClub();
      if (membership?.status !== "active" || membership.access !== "admin"
        || membership.email.toLowerCase() !== account?.email.toLowerCase()) {
        throw new ApiError("An approved club administrator is required to publish an event.", 403, "ORGANIZER_ACCESS_REQUIRED", actor || undefined);
      }
      return currentClub;
    };
    try { clubId = requireAdmin(); }
    catch (error) { return observed(Promise.reject(error)); }
    const payload = { ...input, clubId };
    const task = organizationChain.current.catch(() => undefined).then(async () => {
      if (!sameActor(epoch, actor) || requireAdmin() !== clubId) {
        throw new ApiError("Your session changed. Sign in again before publishing.", 409, "SESSION_CHANGED", actor || undefined);
      }
      const event = await api.createEvent(payload);
      if (!sameActor(epoch, actor)) {
        throw new ApiError("Your session changed. Refresh to see the published event.", 409, "SESSION_CHANGED", actor || undefined);
      }
      eventsRevision.current += 1;
      setEvents((current) => [...current.filter((entry) => entry.id !== event.id), event]);
    });
    organizationChain.current = task;
    return observed(task);
  }, [observed, requireOfficerClub, sameActor]);

  const profileDone = completeBasics(p.profile);
  const requiredProgress = [!!p.profile.name.trim() && !!p.profile.email, !!p.profile.major.trim(), p.profile.year > 0, p.profile.interests.some((interest) => interest.trim())].filter(Boolean).length / 4;
  const mergedClubs = useMemo(() => clubs.map((club) => ({ ...club, ...p.clubSettings[club.id] })), [clubs, p.clubSettings]);

  const value: AppState = {
    ...p, ready, loadError, mutationError,
    clearMutationError: () => setMutationError(null),
    saveStatus, profileSaveError,
    clubs: mergedClubs, events, createClubEvent, matches: profileDone ? allMatches : [], profileDone, profileProgress: requiredProgress,
    clubById: (id) => mergedClubs.find((club) => club.id === id),
    applicationIdForClub: (id) => p.applicationIds[id],
    updateProfile, flushProfile, refresh, signIn, signOut,
    signUpStudent: (info) => register(() => api.registerStudent(info)),
    signUpOfficer: (info) => register(() => api.registerOfficer(info)),
    completeProfile: () => observed((async () => {
      const epoch = epochRef.current;
      const actor = actorKey(pRef.current);
      await flushProfile();
      if (!actor || !sameActor(epoch, actor)) throw new ApiError("Your session changed. Sign in again before finishing your profile.", 409, "SESSION_CHANGED");
      const revision = profileRevision.current;
      const profile = normalizeProfile(await api.completeProfile());
      if (sameActor(epoch, actor) && revision === profileRevision.current) commit((current) => ({ ...current, profile }));
    })()),
    addClub: (id) => enqueueWorkspace((current) => ({ myClubs: [...new Set([...current.myClubs, id])], reminders: [...new Set([...current.reminders, id])] })),
    removeClub: (id) => enqueueWorkspace((current) => ({ myClubs: current.myClubs.filter((value) => value !== id), reminders: current.reminders.filter((value) => value !== id) })),
    saveDraft: (clubId, draft) => {
      if (!actorKey(pRef.current)) { notifyFailure(new Error("Sign in to save this draft.")); return; }
      const copy = { ...draft };
      pendingDrafts.current = { ...pendingDrafts.current, [clubId]: copy };
      commit((current) => ({ ...current, drafts: { ...current.drafts, [clubId]: copy } }));
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => { void flushDrafts().catch(() => undefined); }, 500);
    },
    submit: (clubId) => submit(clubId),
    submitWithId: submit,
    setStatus: () => observed(Promise.reject(new Error("Application status is set by the club after review."))),
    toggleReminder: (id) => enqueueWorkspace((current) => ({ reminders: current.reminders.includes(id) ? current.reminders.filter((value) => value !== id) : [...current.reminders, id] })),
    markUnlockSeen: () => enqueueWorkspace(() => ({ seenUnlock: true })),
    reset: refresh,
    toggleCalEvent: (id) => enqueueWorkspace((current) => ({ calAdded: current.calAdded.includes(id) ? current.calAdded.filter((value) => value !== id) : [...current.calAdded, id] })),
    addPersonal: (event) => {
      const entry: PersonalEvent = { ...event, id: crypto.randomUUID() };
      return enqueueWorkspace((current) => ({ personal: [...current.personal, entry] }));
    },
    removePersonal: (id) => enqueueWorkspace((current) => ({ personal: current.personal.filter((entry) => entry.id !== id) })),
    setCalColor: (key, color) => enqueueWorkspace((current) => ({ calColors: { ...current.calColors, [key]: color } })),
    toggleCalHidden: (key) => enqueueWorkspace((current) => ({ calHidden: current.calHidden.includes(key) ? current.calHidden.filter((value) => value !== key) : [...current.calHidden, key] })),
    setScore: (applicationId, criterion, score) => mutateOrganization(() => {
      const email = pRef.current.account?.email;
      if (!email) throw new Error("Sign in to review applications.");
      return api.setScore(applicationId, { ...organizationRef.current.scores[applicationId]?.[email], [criterion]: score });
    }),
    decide: (applicationId, decision) => mutateOrganization(() => api.decide(applicationId, decision)),
    scheduleInterview: (interview) => mutateOrganization(() => {
      const { clubId: _clubId, ...payload } = interview;
      return api.scheduleInterview(payload);
    }),
    bookInterview: (applicationId, slot) => observed((async () => {
      const epoch = epochRef.current;
      const actor = actorKey(pRef.current);
      const workspace = await api.bookInterview(applicationId, slot);
      if (sameActor(epoch, actor)) publishWorkspace(workspace);
    })()),
    demoInterview: () => observed(Promise.reject(new Error("A club officer must send a real interview invitation."))),
    inviteMember: async (email, name, officerRole) => {
      try { await mutateOrganization(() => api.inviteMember(requireOfficerClub(), email, name, officerRole)); return null; }
      catch (error) { return errorMessage(error); }
    },
    approveMember: (email) => mutateOrganization(() => api.approveMember(requireOfficerClub(), email)),
    removeMember: (email) => mutateOrganization(() => api.removeMember(requireOfficerClub(), email)),
    setClubSetting: (clubId, patch) => mutateOrganization(() => api.setClubSetting(clubId, patch)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function appState(state: Pick<AppState, "apps" | "drafts">, club: Club) {
  const application = state.apps[club.id];
  if (application && application.status !== "draft") return { label: statusLabel(application.status), status: application.status, answered: club.questions.length };
  const draft = state.drafts[club.id] ?? {};
  const answered = club.questions.filter((question) => (draft[question.id] ?? "").trim()).length;
  return { label: answered === 0 ? "Not started" : "In progress", status: "draft" as AppStatus, answered };
}

export function statusLabel(status: AppStatus) {
  return { draft: "In progress", submitted: "Submitted", interview: "Interview", accepted: "Accepted", rejected: "Not this time" }[status];
}
