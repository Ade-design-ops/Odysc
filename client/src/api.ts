// Every screen gets data through this file. While USE_MOCKS is true we return demo data;
// flip it to false once server/ serves the endpoints in shared/api.md. Shapes don't change.
import type { Applicant, Application, Club, ClubEvent, Match, Student } from "../../shared/types";
import * as mock from "./data/mock";

export const USE_MOCKS = true;

const wait = <T,>(data: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(data), ms));

async function get<T>(path: string, fallback: T): Promise<T> {
  if (USE_MOCKS) return wait(fallback);
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown, fallback: T): Promise<T> {
  if (USE_MOCKS) return wait(fallback, 600);
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  me: () => get<Student>("/me", mock.student),
  clubs: () => get<Club[]>("/clubs", mock.clubs),
  events: () => get<ClubEvent[]>("/events", mock.events),
  myApplications: () => get<Application[]>("/applications/mine", mock.applications),
  matches: (studentId: string) => post<Match[]>("/ai/match", { studentId }, mock.matches),
  parseResume: (fileName: string) =>
    post<Pick<Student, "major" | "year" | "skills" | "interests" | "experiences">>("/ai/parse-resume", { fileName }, mock.parsedResume),
  submitApplication: (clubId: string, answers: Application["answers"]) =>
    post<Application>("/applications", { clubId, answers }, {
      id: `app_${Date.now()}`,
      studentId: mock.student.id,
      clubId,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      answers,
    }),
  applicants: (clubId: string) => get<Applicant[]>(`/clubs/${clubId}/applicants`, mock.applicants),
};
