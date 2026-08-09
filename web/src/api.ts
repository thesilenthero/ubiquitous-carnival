import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Analytics,
  Application,
  Contact,
  FetchedPosting,
  Settings,
  Stage,
  Suggestion,
} from "./types";

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

const keys = {
  applications: ["applications"] as const,
  application: (id: string) => ["application", id] as const,
  analytics: ["analytics"] as const,
  analyticsRange: (range: AnalyticsRange) =>
    ["analytics", range.from ?? "", range.to ?? ""] as const,
  contacts: ["contacts"] as const,
  suggestions: ["suggestions"] as const,
  settings: ["settings"] as const,
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
      questions?: string;
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
    },
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
