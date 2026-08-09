import { Router } from "express";
import {
  listPendingSuggestions,
  createSuggestion,
  acceptSuggestion,
  dismissSuggestion,
} from "../suggestions.js";
import { isStage, isIsoTimestamp } from "../domain.js";

export const suggestionsRouter = Router();

suggestionsRouter.get("/", (_req, res) => {
  res.json(listPendingSuggestions());
});

// Create a suggestion — the write path for external scanners (e.g. Claude
// reading Gmail). Deduplicates against pending suggestions so re-scans are
// idempotent. Never touches the stage log itself.
suggestionsRouter.post("/", (req, res) => {
  const b = req.body ?? {};
  if (!b.applicationId || !isStage(b.suggestedStage)) {
    return res
      .status(400)
      .json({ error: "applicationId and a valid suggestedStage are required" });
  }
  if (b.occurredAt != null && !isIsoTimestamp(b.occurredAt)) {
    return res.status(400).json({ error: `invalid occurredAt: ${b.occurredAt}` });
  }
  const s = createSuggestion({
    applicationId: String(b.applicationId),
    suggestedStage: b.suggestedStage,
    evidence: b.evidence ?? null,
    source: b.source,
    occurredAt: b.occurredAt ?? null,
  });
  if (!s) return res.status(404).json({ error: "application not found" });
  if (s === "already-recorded") {
    return res
      .status(409)
      .json({ error: "that stage is already in the application's log" });
  }
  res.status(201).json(s);
});

suggestionsRouter.post("/:id/accept", (req, res) => {
  const s = acceptSuggestion(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

suggestionsRouter.post("/:id/dismiss", (req, res) => {
  const s = dismissSuggestion(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});
