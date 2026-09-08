import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Activity,
  Analytics,
  Application,
  Contact,
  DiscoveredJob,
  DiscoveredStatus,
  FetchedPosting,
  JobBoard,
  RefreshResult,
  NextStep,
  Settings,
  SheetsStatus,
  Stage,
  Suggestion,
} from "./types";
import { todayIso } from "./lib/format";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AnalyticsRange {
  from?: string;
  to?: string;
}

// `dateField` chooses which of the log's two clocks the range filters on.
// "recorded" (the default) answers "what did I hear this week"; "occurred"
// answers "what is on the calendar next week" — over the very same rows.
export interface ActivityFilters {
  dateField?: "recorded" | "occurred";
  from?: string;
  to?: string;
  entity?: string;
  action?: string;
  applicationId?: string;
  contactId?: string;
  source?: string;
  limit?: number;
}

const keys = {
  applications: ["applications"] as const,
  application: (id: string) => ["application", id] as const,
  analytics: ["analytics"] as const,
  analyticsRange: (range: AnalyticsRange) =>
    ["analytics", range.from ?? "", range.to ?? ""] as const,
  contacts: ["contacts"] as const,
  suggestions: ["suggestions"] as const,
  nextSteps: ["next-steps"] as const,
  settings: ["settings"] as const,
  sheetsStatus: ["sheets-status"] as const,
  boards: ["boards"] as const,
  discovered: (status: DiscoveredStatus) => ["discovered", status] as const,
  activity: (f: ActivityFilters) =>
    ["activity", JSON.stringify(f)] as const,
};

// After any mutation we invalidate both the list and the analytics so the
// dashboard reflects the change immediately — the "live" requirement.
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.applications });
    qc.invalidateQueries({ queryKey: keys.analytics });
    qc.invalidateQueries({ queryKey: ["application"] });
    qc.invalidateQueries({ queryKey: keys.suggestions });
    qc.invalidateQueries({ queryKey: keys.nextSteps });
    qc.invalidateQueries({ queryKey: ["discovered"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };
}

export function useApplications() {
  return useQuery({
    queryKey: keys.applications,
    queryFn: () => http<Application[]>("/api/applications"),
  });
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: keys.application(id ?? ""),
    queryFn: () => http<Application>(`/api/applications/${id}`),
    enabled: !!id,
  });
}

export function useAnalytics(range: AnalyticsRange = {}) {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const qs = params.toString();
  return useQuery({
    queryKey: keys.analyticsRange(range),
    queryFn: () => http<Analytics>(`/api/analytics${qs ? `?${qs}` : ""}`),
  });
}

export function useActivity(filters: ActivityFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return useQuery({
    queryKey: keys.activity(filters),
    queryFn: () => http<Activity[]>(`/api/activity${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateApplication() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: Partial<Application>) =>
      http<Application>("/api/applications", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateApplication() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Application> }) =>
      http<Application>(`/api/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useSetStage() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      stage,
      note,
      occurredAt,
    }: {
      id: string;
      stage: Stage;
      note?: string;
      occurredAt?: string;
    }) =>
      http<Application>(`/api/applications/${id}/stage`, {
        method: "POST",
        body: JSON.stringify({ stage, note, occurredAt }),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateStageEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      eventId,
      stage,
      note,
      occurredAt,
    }: {
      id: string;
      eventId: string;
      stage?: Stage;
      note?: string | null;
      occurredAt?: string;
    }) =>
      http<Application>(`/api/applications/${id}/stage/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage, note, occurredAt }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteStageEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, eventId }: { id: string; eventId: string }) =>
      http<Application>(`/api/applications/${id}/stage/${eventId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// --- PDF attachments -----------------------------------------------------

export type AttachmentKind = "resume" | "cover-letter";

// Upload deliberately bypasses `http`: that helper sets a JSON Content-Type,
// and forcing one on a FormData body strips the multipart boundary the server
// needs to parse it. The browser sets the correct header itself.
export function useUploadAttachment(kind: AttachmentKind) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/applications/${id}/attachments/${kind}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed: ${res.status}`);
      }
      return (await res.json()) as Application;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAttachment(kind: AttachmentKind) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) =>
      http<Application>(`/api/applications/${id}/attachments/${kind}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// --- Interviews ----------------------------------------------------------

export function useAddInterview() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      date?: string;
      format?: string;
      interviewers?: string;
      notes?: string;
    }) =>
      http<Application>(`/api/applications/${id}/interviews`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateInterview() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      interviewId,
      patch,
    }: {
      id: string;
      interviewId: string;
      patch: Record<string, unknown>;
    }) =>
      http<Application>(`/api/applications/${id}/interviews/${interviewId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteInterview() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, interviewId }: { id: string; interviewId: string }) =>
      http<Application>(`/api/applications/${id}/interviews/${interviewId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// --- Contacts ------------------------------------------------------------

export function useContacts() {
  return useQuery({
    queryKey: keys.contacts,
    queryFn: () => http<Contact[]>("/api/contacts"),
  });
}

function useInvalidateContacts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.contacts });
}

export function useCreateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: Partial<Contact>) =>
      http<Contact>("/api/contacts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Contact> }) =>
      http<Contact>(`/api/contacts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (id: string) =>
      http<void>(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useAddInteraction() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({
      contactId,
      ...body
    }: {
      contactId: string;
      kind: string;
      note?: string;
      occurredAt?: string;
      applicationId?: string | null;
    }) =>
      http<Contact>(`/api/contacts/${contactId}/interactions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteInteraction() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({
      contactId,
      interactionId,
    }: {
      contactId: string;
      interactionId: string;
    }) =>
      http<Contact>(`/api/contacts/${contactId}/interactions/${interactionId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// --- Suggestions ---------------------------------------------------------

export function useSuggestions() {
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: () => http<Suggestion[]>("/api/suggestions"),
  });
}

export function useResolveSuggestion() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "accept" | "dismiss";
    }) =>
      http<Suggestion>(`/api/suggestions/${id}/${action}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

// --- Next steps ----------------------------------------------------------

export function useNextSteps() {
  return useQuery({
    queryKey: keys.nextSteps,
    queryFn: () => http<NextStep[]>("/api/next-steps"),
  });
}

export function useSnoozeNextStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http<{ id: string; until: string }>("/api/next-steps/snooze", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.nextSteps }),
  });
}

// --- Settings ------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => http<Settings>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      http<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.settings });
      qc.invalidateQueries({ queryKey: keys.analytics });
      // quietDays and weeklyTarget are thresholds the play engine reads.
      qc.invalidateQueries({ queryKey: keys.nextSteps });
    },
  });
}

// --- Google Sheet mirror -------------------------------------------------

export function useSheetsStatus() {
  return useQuery({
    queryKey: keys.sheetsStatus,
    queryFn: () => http<SheetsStatus>("/api/sheets/status"),
    // The server pushes on its own; this is just to keep "last synced" honest
    // without making the user reload the page.
    refetchInterval: 60_000,
  });
}

export function useSyncSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      http<SheetsStatus & { synced: boolean }>("/api/sheets/sync", {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sheetsStatus }),
  });
}

// --- Discovery -----------------------------------------------------------

export function useBoards() {
  return useQuery({
    queryKey: keys.boards,
    queryFn: () => http<JobBoard[]>("/api/boards"),
  });
}

function useInvalidateBoards() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.boards });
    qc.invalidateQueries({ queryKey: ["discovered"] });
  };
}

export function useCreateBoard() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (input: { url: string; keywords: string; company?: string }) =>
      http<JobBoard>("/api/boards", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteBoard() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (id: string) =>
      http<void>(`/api/boards/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// Polls every active board. This is the only thing here that hits the network
// beyond our own API, so it is manual and never fires on page load.
export function useRefreshBoards() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: () =>
      http<RefreshResult>("/api/boards/refresh", { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useDiscovered(status: DiscoveredStatus = "new") {
  return useQuery({
    queryKey: keys.discovered(status),
    queryFn: () => http<DiscoveredJob[]>(`/api/discovered?status=${status}`),
  });
}

// save / dismiss / apply — one hook, action in the path, mirroring
// useResolveSuggestion. `apply` creates an application, so this uses the shared
// invalidator rather than the boards-scoped one.
export function useResolveDiscovered() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "save" | "dismiss" | "docket" | "apply";
    }) =>
      // `date` is the browser's calendar day, which the server uses as the
      // application date — its own UTC "today" runs ahead of ours all evening.
      http<DiscoveredJob>(
        `/api/discovered/${id}/${action}?date=${todayIso()}`,
        { method: "POST" },
      ),
    onSuccess: invalidate,
  });
}

// --- Posting autofill ----------------------------------------------------

// Read a posting URL (or pasted text) into draft fields. Hits
// /api/postings/fetch, which is stdlib-only on the server — no model, no cost.
// Nothing is persisted, so there is no cache to invalidate.
export function useFetchPosting() {
  return useMutation({
    mutationFn: (input: { url?: string; text?: string }) =>
      http<FetchedPosting>("/api/postings/fetch", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useImportCsv() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (payload: { csv: string; mapping: Record<string, string> }) =>
      http<{ imported: number; errors: string[] }>("/api/import", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });
}
