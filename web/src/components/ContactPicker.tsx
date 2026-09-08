import { useState } from "react";
import { useContacts } from "../api";
import type { Contact } from "../types";

// "Referred by", backed by the contact list. It replaced two free-text fields
// that both duplicated data the app already held: a contact name retyped from
// the Contacts tab, and a referral source that only ever repeated what the
// `source` dropdown says. One field, linked to the real record where possible.
//
// A plain input over a <datalist> rather than a custom dropdown: you can type a
// name that isn't in your contacts (a recruiter you just met) and it is kept as
// text, while a name that does match links to that contact's record. No modes,
// no "add new" step.

/** The contact whose name is exactly what's typed, if exactly one matches. */
export function matchContact(
  name: string,
  contacts: Contact[] | undefined,
): Contact | null {
  const typed = name.trim().toLowerCase();
  if (!typed) return null;
  const hits = (contacts ?? []).filter(
    (c) => c.name.trim().toLowerCase() === typed,
  );
  return hits.length === 1 ? hits[0] : null;
}

export function ContactPicker({
  name,
  contactId,
  onChange,
  onCommit,
  className,
}: {
  name: string;
  contactId: string;
  /** Live, per keystroke — for a form whose state is submitted later. */
  onChange?: (name: string, contactId: string) => void;
  /** On blur — for an inline field that saves, so typing isn't one PATCH per
   *  character. Exactly one of these two is expected. */
  onCommit?: (name: string, contactId: string) => void;
  className?: string;
}) {
  const { data: contacts } = useContacts();
  // Only meaningful in onCommit mode, where the prop lags the input by design.
  const [draft, setDraft] = useState(name);
  const shown = onCommit ? draft : name;
  const match = matchContact(shown, contacts);
  const linked =
    match ?? (contacts?.find((c) => c.id === contactId) ?? null);
  // What the link is worth showing: enough to confirm it's the right person.
  const subtitle = [linked?.company, linked?.relationship]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <input
        list="contact-names"
        className={className}
        value={shown}
        placeholder="Name, or leave blank"
        onChange={(e) => {
          const typed = e.target.value;
          setDraft(typed);
          onChange?.(typed, matchContact(typed, contacts)?.id ?? "");
        }}
        onBlur={() => {
          if (!onCommit || draft === name) return;
          onCommit(draft, matchContact(draft, contacts)?.id ?? "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(name);
        }}
      />
      <datalist id="contact-names">
        {(contacts ?? []).map((c) => (
          <option key={c.id} value={c.name}>
            {[c.company, c.relationship].filter(Boolean).join(" · ")}
          </option>
        ))}
      </datalist>
      {linked ? (
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          Linked to <span className="text-[var(--accent)]">{linked.name}</span>
          {subtitle ? ` — ${subtitle}` : ""}
        </div>
      ) : shown.trim() ? (
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          Not in your contacts — kept as a name
        </div>
      ) : null}
    </div>
  );
}
