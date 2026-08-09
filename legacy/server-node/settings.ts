import { db } from "./db.js";

// Tiny key/value settings store. Known keys and their defaults live here so
// every consumer sees the same shape.

export interface Settings {
  weeklyTarget: number; // applications-per-week goal
}

const DEFAULTS: Settings = {
  weeklyTarget: 10,
};

export function getSettings(): Settings {
  const rows = db
    .prepare<[], { key: string; value: string }>(`SELECT key, value FROM settings`)
    .all();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const target = Number(raw.weeklyTarget);
  return {
    weeklyTarget:
      Number.isFinite(target) && target > 0 ? target : DEFAULTS.weeklyTarget,
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  if (patch.weeklyTarget !== undefined) {
    upsert.run("weeklyTarget", String(patch.weeklyTarget));
  }
  return getSettings();
}
