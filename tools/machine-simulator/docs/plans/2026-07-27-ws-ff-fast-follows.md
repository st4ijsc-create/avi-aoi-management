# WS-FF — Fast-follows (post-Giai-đoạn-1 cleanup)

> Small, well-understood items deferred during WS-A/C/D/F1. 2 TDD tasks, subagent-driven. Branch feat/machine-simulator.

## Doable now (this workstream)
- **FF-1 — Settings persistence to disk.** Today `FleetHost` serverUrl/machineCode/verifyTls are in-memory only (reset on restart); WS-F1 added env-var seeding but a runtime `PUT /v1/settings` change is still lost on restart. Persist these to an atomic JSON file (reuse the `MachineConfigStore`/`OeeSettingsStore` atomic-write idiom) under `%ProgramData%\ST4I\sim\` (relocatable via env), load at startup. Layering: persisted-file value < env-var override? Decide: env should be the FLOOR/initial default, and a persisted runtime change overrides it (so an operator's PUT sticks); OR env always wins. RECOMMEND: on startup, load persisted settings if present, else fall back to the env-derived initial values (WS-F1), else FleetHost defaults; a `PUT /v1/settings` writes to the persisted file. Document the precedence clearly. NEVER persist secrets (mk_ stays in CredentialStore; verifyTls/url/machineCode only).
- **FF-2 — CredentialStore → LocalMachine DPAPI + NU1903.**
  - `CredentialStore` uses `DataProtectionScope.CurrentUser` → a mk_ onboarded interactively can't be decrypted after converting to a service under a different account. Change to `DataProtectionScope.LocalMachine` (machine-scoped; the security-dir ACL from WS-D provides the confidentiality boundary against local non-admins, same rationale as WS-D's key-ring `protectToLocalMachine:true`). NOTE: this is a BREAKING change for any EXISTING CurrentUser-encrypted `.bin` — the product isn't deployed, so acceptable, but add a graceful fallback: on `Unprotect` failure, treat as "no stored key" (forces a re-claim) rather than throwing. Test: round-trip under LocalMachine; corrupt/foreign blob → null not throw.
  - NU1903: `Microsoft.Data.Sqlite 10.0.10` pins transitive `SQLitePCLRaw.bundle_e_sqlite3 2.1.11` (NU1903 advisory). Attempt an explicit transitive PackageReference to a PATCHED `SQLitePCLRaw.bundle_e_sqlite3` (check NuGet for a ≥ version that clears NU1903) in `St4i.EdgeCore.csproj`; if none clears it, add a documented `<NoWarn>NU1903</NoWarn>` (or a targeted NuGetAudit suppression) WITH a code comment + README note explaining why it's accepted for a local-file-only SQLite use (no untrusted DB input, not remotely reachable). Report which path was taken.

## Deferred (need external resources — NOT this workstream)
- MSI code-signing: needs an OV/EV code-signing certificate → document as a pre-GA release step.
- Clean-VM install/uninstall/service-start/MajorUpgrade smoke + ≤30-min timing: needs a disposable Windows VM → pre-GA gate.
- Full auto-update/LTS delivery, License/Edition (GĐ3), settings-persist for products beyond the machine sim.

## Constraints: .NET/C# only; reuse existing atomic-store idioms; no shared-SDK edit; TDD; per-task review; full dotnet suites green. Commit `feat(...)`/`fix(...)` with the Co-Authored-By trailer.
