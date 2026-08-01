/**
 * Client-side record of which machine codes THIS BROWSER has stored an `mk_` credential for.
 *
 * `CredentialStore` (St4i.EdgeCore.Infrastructure) is the actual source of truth — it DPAPI-encrypts
 * each key to `%ProgramData%\ST4I\sim\creds\<code>.bin` on the engine's own machine — but EngineApi
 * exposes no `GET` endpoint to list or inspect what's in that directory (only `POST
 * /v1/onboarding/paste-key` writes to it, via `OnboardingService.PasteKey`/`ClaimAsync`/`EnrollAsync`).
 * Task 7 is web-only (no C# changes), so Settings' "known credentials" list is this localStorage-backed
 * log of codes this browser has successfully claimed/enrolled/pasted THIS session or a past one — a
 * client-side memory aid, not an authoritative directory listing. Copy in the UI should say so.
 */
export interface CredentialRecord {
  code: string
  savedAt: string
}

const STORAGE_KEY = "st4i-sim-credentials-v1"
const MAX_RECORDS = 25

function isRecord(value: unknown): value is CredentialRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CredentialRecord).code === "string" &&
    typeof (value as CredentialRecord).savedAt === "string"
  )
}

function readAll(): CredentialRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  } catch {
    // Private-browsing/storage-disabled or corrupt JSON — degrade to "no history" rather than throw.
    return []
  }
}

/** Records `code` as having just received an `mk_` key (moves it to the front if already present). */
export function recordCredential(code: string): CredentialRecord[] {
  const trimmed = code.trim()
  if (!trimmed) return readAll()

  const next = [
    { code: trimmed, savedAt: new Date().toISOString() },
    ...readAll().filter((r) => r.code !== trimmed),
  ].slice(0, MAX_RECORDS)

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota exceeded or storage disabled — the in-memory return value below still lets the caller
    // update its own UI for this session even though the write didn't persist.
  }
  return next
}

export function listCredentials(): CredentialRecord[] {
  return readAll()
}
