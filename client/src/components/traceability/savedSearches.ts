/**
 * doc 46 FE-W3.4 — saved forward/recall searches.
 *
 * PERSISTENCE (honest): there is NO server store for saved traceability
 * searches in this backend. These are a CLIENT-SIDE convenience persisted to
 * this browser's localStorage only — they do not sync across devices/users and
 * are not audited. The UI states this plainly next to the saved list.
 */

export type ForwardMode = "lot" | "serial" | "component";

export interface SavedSearch {
  id: string;
  name: string;
  mode: ForwardMode;
  value: string;
  createdAt: string; // ISO
}

const STORAGE_KEY = "synapse.trace.savedForwardSearches.v1";

function safeParse(raw: string | null): SavedSearch[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is SavedSearch =>
        s && typeof s.id === "string" && typeof s.name === "string" &&
        (s.mode === "lot" || s.mode === "serial" || s.mode === "component") &&
        typeof s.value === "string",
    );
  } catch {
    return [];
  }
}

export function loadSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

function persist(list: SavedSearch[]): SavedSearch[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* quota / private mode — best-effort only */
    }
  }
  return list;
}

export function addSavedSearch(input: { name: string; mode: ForwardMode; value: string }): SavedSearch[] {
  const list = loadSavedSearches();
  const entry: SavedSearch = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || input.value.trim(),
    mode: input.mode,
    value: input.value.trim(),
    createdAt: new Date().toISOString(),
  };
  // De-dupe identical mode+value (keep the newest name).
  const deduped = list.filter((s) => !(s.mode === entry.mode && s.value === entry.value));
  return persist([entry, ...deduped]);
}

export function removeSavedSearch(id: string): SavedSearch[] {
  return persist(loadSavedSearches().filter((s) => s.id !== id));
}
