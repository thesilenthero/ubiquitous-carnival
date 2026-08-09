import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAddInteraction,
  useApplications,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useDeleteInteraction,
  useUpdateContact,
} from "../api";
import {
  CONTACT_NEXT_ACTIONS,
  CONTACT_ROLES,
  CONTACT_STATUSES,
  INTERACTION_KINDS,
  RELATIONSHIPS,
  type Contact,
} from "../types";
import {
  FieldDate,
  FieldEdit,
  FieldOptional,
  FieldSelect,
  FieldUrl,
} from "../components/fields";
import { fmtDate, relativeDays } from "../lib/format";

const isoFromDate = (d: string) => new Date(d + "T12:00:00.000Z").toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_COLORS: Record<string, string> = {
  Pending: "#f59e0b",
  Connected: "#10b981",
  "Followed up": "#4f46e5",
  Closed: "#6b7280",
};

export default function Contacts() {
  const { data: contacts, isLoading } = useContacts();
  const create = useCreateContact();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  // Follow-ups deep-links here with ?open=<contactId> to expand that card.
  const [params] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(params.get("open"));
  const [form, setForm] = useState({ name: "", company: "", relationship: "" });

  const rows = useMemo(() => {
    let list = contacts ?? [];
    if (statusFilter !== "all")
      list = list.filter((c) => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      const has = (v: string | null) => (v ?? "").toLowerCase().includes(q);
      list = list.filter(
        (c) => has(c.name) || has(c.company) || has(c.notes) || has(c.roleTitle),
      );
    }
    return list;
  }, [contacts, search, statusFilter]);

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const created = await create.mutateAsync({
      name: form.name.trim(),
      company: form.company.trim() || null,
      relationship: form.relationship || null,
    });
    setForm({ name: "", company: "", relationship: "" });
    setShowNew(false);
    setExpanded(created.id);
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {rows.length} networking contact{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          + New contact
        </button>
      </header>

      {showNew && (
        <form
          onSubmit={submitNew}
          className="card mb-4 flex flex-wrap items-end gap-2 p-3"
        >
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Name *
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Company
            </label>
            <input
              value={form.company}
              onChange={(e) =>
                setForm((f) => ({ ...f, company: e.target.value }))
              }
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Relationship
            </label>
            <select
              value={form.relationship}
              onChange={(e) =>
                setForm((f) => ({ ...f, relationship: e.target.value }))
              }
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">—</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!form.name.trim() || create.isPending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name, company, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All statuses</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-[var(--text-muted)]">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <div className="card p-10 text-center text-[var(--text-muted)]">
          No contacts yet. Add the people you're networking with.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((c) => (
          <ContactCard
            key={c.id}
            contact={c}
            expanded={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ContactCard({
  contact: c,
  expanded,
  onToggle,
}: {
  contact: Contact;
  expanded: boolean;
  onToggle: () => void;
}) {
  const update = useUpdateContact();
  const del = useDeleteContact();
  const addInteraction = useAddInteraction();
  const delInteraction = useDeleteInteraction();
  const { data: apps } = useApplications();

  const save = (patch: Partial<Contact>) =>
    update.mutate({ id: c.id, patch });

  const [logKind, setLogKind] = useState("follow-up");
  const [logNote, setLogNote] = useState("");
  const [logDate, setLogDate] = useState(todayStr());
  const [logAppId, setLogAppId] = useState("");

  const statusColor = STATUS_COLORS[c.status] ?? "#6b7280";
  const appsById = new Map((apps ?? []).map((a) => [a.id, a]));

  return (
    <div className="card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">{c.name}</div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {[c.company, c.relationship].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        {c.nextAction && (
          <div className="hidden max-w-40 truncate text-right text-xs text-[var(--text-muted)] sm:block">
            {c.nextAction}
            {c.nextActionDate && <div>{relativeDays(c.nextActionDate)}</div>}
          </div>
        )}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
          title="Contact status — edit it in the expanded card"
          style={{
            background: `color-mix(in srgb, ${statusColor} 20%, var(--surface))`,
            color: `color-mix(in srgb, ${statusColor} 70%, var(--text))`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: statusColor }}
          />
          {c.status}
        </span>
        <span
          className="w-20 text-right text-xs text-[var(--text-muted)]"
          title="Time since the last logged interaction"
        >
          {c.lastInteractionAt
            ? relativeDays(c.lastInteractionAt.slice(0, 10))
            : "no touches"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] p-4">
          <dl className="mb-4 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            <FieldEdit
              label="Company"
              value={c.company ?? ""}
              onSave={(v) => save({ company: v || null })}
            />
            <FieldOptional
              label="Their role"
              value={c.roleTitle}
              options={CONTACT_ROLES as readonly string[]}
              onSave={(v) => save({ roleTitle: v })}
            />
            <FieldOptional
              label="Relationship"
              value={c.relationship}
              options={RELATIONSHIPS as readonly string[]}
              onSave={(v) => save({ relationship: v })}
            />
            <FieldSelect
              label="Status"
              value={c.status}
              options={CONTACT_STATUSES as readonly string[]}
              onSave={(v) => save({ status: v })}
            />
            <FieldEdit
              label="Email"
              value={c.email ?? ""}
              onSave={(v) => save({ email: v || null })}
            />
            <FieldUrl
              label="LinkedIn"
              value={c.linkedinUrl}
              onSave={(v) => save({ linkedinUrl: v })}
            />
            <FieldOptional
              label="Next action"
              value={c.nextAction}
              options={CONTACT_NEXT_ACTIONS as readonly string[]}
              onSave={(v) => save({ nextAction: v })}
            />
            <FieldDate
              label="By"
              value={c.nextActionDate ?? ""}
              onSave={(v) => save({ nextActionDate: v })}
            />
          </dl>
          <textarea
            defaultValue={c.notes ?? ""}
            onBlur={(e) => save({ notes: e.target.value || null })}
            rows={2}
            placeholder="Notes…"
            className="mb-4 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          {/* Interaction log — the contact's own append-only history. */}
          <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--surface-2)] p-2.5">
            <select
              value={logKind}
              onChange={(e) => setLogKind(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            >
              {INTERACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <select
              value={logAppId}
              onChange={(e) => setLogAppId(e.target.value)}
              className="max-w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              title="Link to an application (optional)"
            >
              <option value="">no application</option>
              {(apps ?? [])
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company} — {a.roleTitle}
                  </option>
                ))}
            </select>
            <input
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder="Note…"
              className="min-w-32 flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => {
                addInteraction.mutate({
                  contactId: c.id,
                  kind: logKind,
                  note: logNote || undefined,
                  occurredAt: isoFromDate(logDate),
                  applicationId: logAppId || null,
                });
                setLogNote("");
                setLogDate(todayStr());
                setLogAppId("");
              }}
              title="Append this interaction to the contact's history"
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Log
            </button>
          </div>

          <ol className="space-y-1.5 text-sm">
            {(c.interactions ?? []).map((it) => {
              const linked = it.applicationId
                ? appsById.get(it.applicationId)
                : undefined;
              return (
                <li key={it.id} className="flex items-baseline gap-2">
                  <span className="w-20 shrink-0 text-xs text-[var(--text-muted)]">
                    {fmtDate(it.occurredAt)}
                  </span>
                  <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    {it.kind}
                  </span>
                  <span className="min-w-0 flex-1">
                    {it.note}
                    {linked && (
                      <Link
                        to={`/application/${linked.id}`}
                        className="ml-1 text-xs text-[var(--accent)] hover:underline"
                      >
                        → {linked.company}
                      </Link>
                    )}
                  </span>
                  <button
                    onClick={() =>
                      delInteraction.mutate({
                        contactId: c.id,
                        interactionId: it.id,
                      })
                    }
                    className="text-xs text-[var(--text-muted)] hover:text-red-600"
                    title="Delete interaction"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
            {(c.interactions ?? []).length === 0 && (
              <li className="text-xs text-[var(--text-muted)]">
                No interactions logged yet.
              </li>
            )}
          </ol>

          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <button
              onClick={() => {
                if (confirm(`Delete contact ${c.name} and their history?`)) {
                  del.mutate(c.id);
                }
              }}
              className="text-xs text-red-600 hover:underline"
            >
              Delete contact
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
