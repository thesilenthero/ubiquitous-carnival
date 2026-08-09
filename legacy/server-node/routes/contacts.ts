import { Router } from "express";
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  addInteraction,
  deleteInteraction,
  type ContactInput,
} from "../contacts.js";
import { isIsoDate, isIsoTimestamp } from "../domain.js";

export const contactsRouter = Router();

contactsRouter.get("/", (_req, res) => {
  res.json(listContacts());
});

contactsRouter.get("/:id", (req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json(c);
});

contactsRouter.post("/", (req, res) => {
  const b = req.body ?? {};
  if (!b.name || typeof b.name !== "string" || !b.name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (b.nextActionDate && !isIsoDate(b.nextActionDate)) {
    return res
      .status(400)
      .json({ error: `invalid nextActionDate: ${b.nextActionDate}` });
  }
  const input: ContactInput = {
    name: b.name.trim(),
    company: b.company ?? null,
    roleTitle: b.roleTitle ?? null,
    relationship: b.relationship ?? null,
    status: b.status,
    email: b.email ?? null,
    linkedinUrl: b.linkedinUrl ?? null,
    nextAction: b.nextAction ?? null,
    nextActionDate: b.nextActionDate ?? null,
    notes: b.notes ?? null,
  };
  res.status(201).json(createContact(input));
});

contactsRouter.patch("/:id", (req, res) => {
  const b = req.body ?? {};
  if (
    "nextActionDate" in b &&
    b.nextActionDate != null &&
    !isIsoDate(b.nextActionDate)
  ) {
    return res
      .status(400)
      .json({ error: `invalid nextActionDate: ${b.nextActionDate}` });
  }
  const updated = updateContact(req.params.id, b);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

contactsRouter.delete("/:id", (req, res) => {
  const ok = deleteContact(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Append an interaction to a contact's log.
contactsRouter.post("/:id/interactions", (req, res) => {
  const { kind, note, occurredAt, applicationId } = req.body ?? {};
  if (!kind || typeof kind !== "string") {
    return res.status(400).json({ error: "kind is required" });
  }
  if (occurredAt !== undefined && !isIsoTimestamp(occurredAt)) {
    return res.status(400).json({ error: `invalid occurredAt: ${occurredAt}` });
  }
  const updated = addInteraction(req.params.id, {
    kind,
    note,
    occurredAt,
    applicationId,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

contactsRouter.delete("/:id/interactions/:interactionId", (req, res) => {
  const updated = deleteInteraction(req.params.id, req.params.interactionId);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});
