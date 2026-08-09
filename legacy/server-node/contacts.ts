import { nanoid } from "nanoid";
import { db } from "./db.js";

// Networking contacts (the sheet's Outreach tab) with an interaction log that
// mirrors the stage_events pattern: interactions are appended, and a contact's
// "last touch" is derived from them.

export interface Interaction {
  id: string;
  contactId: string;
  applicationId: string | null;
  kind: string;
  note: string | null;
  occurredAt: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  roleTitle: string | null;
  relationship: string | null;
  status: string;
  email: string | null;
  linkedinUrl: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Derived:
  lastInteractionAt: string | null;
  interactions?: Interaction[];
}

type ContactRow = {
  id: string;
  name: string;
  company: string | null;
  role_title: string | null;
  relationship: string | null;
  status: string;
  email: string | null;
  linkedin_url: string | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type InteractionRow = {
  id: string;
  contact_id: string;
  application_id: string | null;
  kind: string;
  note: string | null;
  occurred_at: string;
};

function mapInteraction(r: InteractionRow): Interaction {
  return {
    id: r.id,
    contactId: r.contact_id,
    applicationId: r.application_id,
    kind: r.kind,
    note: r.note,
    occurredAt: r.occurred_at,
  };
}

const selectAllContacts = db.prepare<[], ContactRow>(
  `SELECT * FROM contacts ORDER BY updated_at DESC`,
);
const selectContactById = db.prepare<[string], ContactRow>(
  `SELECT * FROM contacts WHERE id = ?`,
);
const interactionsFor = db.prepare<[string], InteractionRow>(`
  SELECT * FROM interactions WHERE contact_id = ?
  ORDER BY occurred_at DESC, id DESC
`);
// Last interaction per contact in one query (same pattern as the application
// list's latest-event lookup).
const lastInteractionPerContact = db.prepare<
  [],
  { contact_id: string; occurred_at: string }
>(`
  SELECT contact_id, MAX(occurred_at) AS occurred_at
  FROM interactions GROUP BY contact_id
`);

function mapContact(
  r: ContactRow,
  lastAt: string | null,
  includeInteractions = false,
): Contact {
  const c: Contact = {
    id: r.id,
    name: r.name,
    company: r.company,
    roleTitle: r.role_title,
    relationship: r.relationship,
    status: r.status,
    email: r.email,
    linkedinUrl: r.linkedin_url,
    nextAction: r.next_action,
    nextActionDate: r.next_action_date,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastInteractionAt: lastAt,
  };
  if (includeInteractions) {
    c.interactions = interactionsFor.all(r.id).map(mapInteraction);
  }
  return c;
}

export function listContacts(): Contact[] {
  const lastByContact = new Map<string, string>();
  for (const row of lastInteractionPerContact.all()) {
    lastByContact.set(row.contact_id, row.occurred_at);
  }
  return selectAllContacts
    .all()
    .map((r) => mapContact(r, lastByContact.get(r.id) ?? null, true));
}

export function getContact(id: string): Contact | undefined {
  const row = selectContactById.get(id);
  if (!row) return undefined;
  const interactions = interactionsFor.all(id);
  return mapContact(row, interactions[0]?.occurred_at ?? null, true);
}

export interface ContactInput {
  name: string;
  company?: string | null;
  roleTitle?: string | null;
  relationship?: string | null;
  status?: string;
  email?: string | null;
  linkedinUrl?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  notes?: string | null;
}

const insertContact = db.prepare(`
  INSERT INTO contacts (
    id, name, company, role_title, relationship, status, email, linkedin_url,
    next_action, next_action_date, notes, created_at, updated_at
  ) VALUES (
    @id, @name, @company, @role_title, @relationship, @status, @email,
    @linkedin_url, @next_action, @next_action_date, @notes, @created_at, @updated_at
  )
`);

export function createContact(input: ContactInput): Contact {
  const now = new Date().toISOString();
  const id = nanoid();
  insertContact.run({
    id,
    name: input.name,
    company: input.company ?? null,
    role_title: input.roleTitle ?? null,
    relationship: input.relationship ?? null,
    status: input.status ?? "Pending",
    email: input.email ?? null,
    linkedin_url: input.linkedinUrl ?? null,
    next_action: input.nextAction ?? null,
    next_action_date: input.nextActionDate ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return getContact(id)!;
}

const CONTACT_EDITABLE: Record<string, string> = {
  name: "name",
  company: "company",
  roleTitle: "role_title",
  relationship: "relationship",
  status: "status",
  email: "email",
  linkedinUrl: "linkedin_url",
  nextAction: "next_action",
  nextActionDate: "next_action_date",
  notes: "notes",
};

export function updateContact(
  id: string,
  patch: Record<string, unknown>,
): Contact | undefined {
  const existing = selectContactById.get(id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, col] of Object.entries(CONTACT_EDITABLE)) {
    if (key in patch) {
      sets.push(`${col} = @${col}`);
      params[col] = patch[key] ?? null;
    }
  }
  if (sets.length > 0) {
    params.updated_at = new Date().toISOString();
    sets.push("updated_at = @updated_at");
    db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = @id`).run(
      params,
    );
  }
  return getContact(id);
}

export function deleteContact(id: string): boolean {
  const res = db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  return res.changes > 0;
}

export interface InteractionInput {
  kind: string;
  note?: string | null;
  occurredAt?: string;
  applicationId?: string | null;
}

const insertInteraction = db.prepare(`
  INSERT INTO interactions (id, contact_id, application_id, kind, note, occurred_at)
  VALUES (@id, @contact_id, @application_id, @kind, @note, @occurred_at)
`);

export function addInteraction(
  contactId: string,
  input: InteractionInput,
): Contact | undefined {
  const existing = selectContactById.get(contactId);
  if (!existing) return undefined;
  insertContactTouch(contactId, () =>
    insertInteraction.run({
      id: nanoid(),
      contact_id: contactId,
      application_id: input.applicationId ?? null,
      kind: input.kind,
      note: input.note ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    }),
  );
  return getContact(contactId);
}

export function deleteInteraction(
  contactId: string,
  interactionId: string,
): Contact | undefined {
  const existing = selectContactById.get(contactId);
  if (!existing) return undefined;
  db.prepare(
    `DELETE FROM interactions WHERE id = ? AND contact_id = ?`,
  ).run(interactionId, contactId);
  return getContact(contactId);
}

function insertContactTouch(contactId: string, write: () => void): void {
  const tx = db.transaction(() => {
    write();
    db.prepare(`UPDATE contacts SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      contactId,
    );
  });
  tx();
}
