# WS-D — Local Security (auth + RBAC + audit hash-chain) — Blueprint (code-grounded)

> Local single-machine auth for a same-origin SPA+API on one box. NOT OIDC/mTLS/X.509 (ecosystem scope). 9 TDD tasks, subagent-driven.

## Grounding (verified)
- NO auth today: `Program.cs:204-252` pipeline `UseDefaultFiles→UseStaticFiles→UseCors→UseWebSockets→[10 MapXxxEndpoints]→MapFallbackToFile`; no AddAuthentication/Authorization/UseHttps*/Hsts anywhere. `HistorianEndpoints.cs:78` says "auth is WS-D".
- Bind already loopback: `Program.cs:23-27` pins `http://localhost:5199` (localhost=loopback). Gap: operator can override to LAN over http, no warning.
- CORS: `Program.cs:34-42` origins `http://localhost:5173` + `tauri://localhost`, AnyHeader/AnyMethod, NO AllowCredentials.
- verifyTls default is ALREADY ON in code (`FleetHost.cs:143`, `Program.cs:81,136`). Gap: `PUT /v1/settings` (`SettingsEndpoints.cs:13`) lets ANYONE flip it false at runtime (→ `LiveConfigSyncBackend.cs:95-106` accept-any-cert), unaudited.
- Free-text `by` (untrusted): `MachineSettingsEndpoints.cs:87` (`body.By`) → `MachineConfigStore.SetAdjustment(...by...)` (`MachineConfigStore.cs:180`); DTOs `MachineSettingsDtos.cs:47,53,59`. `ConfigEndpoints`/`ConfigSyncEngine` have NO actor field. Fix = server-derived identity.
- Storage idiom: copy `SqliteHistorianStore` shape (raw Microsoft.Data.Sqlite, PRAGMA user_version ladder, WAL, %ProgramData%\ST4I\sim\<subdir>). CredentialStore = DPAPI (reversible, for mk_) — passwords must be one-way HASH, never DPAPI.
- NO auth/hashing NuGet in repo, BUT `St4i.EngineApi` uses `Sdk.Web` → implicit FrameworkReference to Microsoft.AspNetCore.App → `PasswordHasher<TUser>` (PBKDF2) + Cookie auth available at ZERO new package cost. Auth subsystem must live in St4i.EngineApi (EdgeCore has no ASP.NET FrameworkReference).
- DesktopShell readiness probe hits `/v1/fleet` (`MainWindow.xaml.cs:132-145`) → MUST repoint to `/v1/health` (kept anonymous) or shell hangs.
- Playwright engine boots with `ST4I_DEMO_ENABLED=true` (`playwright.config.ts:114`), workers:1; all 16 specs + engine.ts helpers call Engineer/Admin-gated routes unauthenticated today.
- Test convention: no Mvc.Testing/TestServer; handler unit tests via hand-built DefaultHttpContext (InternalsVisibleTo). → need Mvc.Testing (TEST-ONLY pkg) for the few real-pipeline 401/403 tests.
- DemoModeGate (`ST4I_DEMO_ENABLED`) + CapabilitiesDto(DemoEnabled,Mode) — reuse these seams.

## Decisions
1. **Auth = HttpOnly SameSite=Lax cookie session** (ASP.NET Core AddCookie) + `PasswordHasher<AppUser>` (PBKDF2, in-box). SQLite user store. ZERO new product NuGet. Session 8h sliding; SecurePolicy=SameAsRequest. OnValidatePrincipal re-reads user row each request (security_stamp) → same-request revocation, no session table. Pin DataProtection key ring to `%ProgramData%\ST4I\sim\security\keys` + SetApplicationName (survives run/service/publish). OIDC seam kept (add 2nd scheme later), not built.
2. **First-run bootstrap**: `GET /v1/auth/bootstrap-status {needsBootstrap}` (anon); `POST /v1/auth/bootstrap` (anon, first account=Admin, locked check-count==0-then-insert, 409 after); SPA shows Bootstrap screen when needsBootstrap.
3. **RBAC roles Operator<Engineer<Admin**, default-deny `FallbackPolicy=RequireAuthenticatedUser`, 3 policies. Per-route `.RequireAuthorization(Policies.X)`/`.AllowAnonymous()`.
4. **Audit hash-chain in SEPARATE `%ProgramData%\ST4I\sim\security\security.db`** (users + audit_log tables), NOT historian.db (prune must be structurally unable to touch audit). audit_log: id(seq) PK, at_utc, actor_username, actor_role (at-time, denormalized), action, target_type/id, old_value/new_value (JSON), correlation_id(=TraceIdentifier), client_ip, prev_hash, row_hash (SHA256 of \x01-joined fields; genesis prev=64×'0'). Write under in-process lock (read-last→compute→insert). VerifyChainAsync walks seq recomputing. AuditRecorder.RecordAsync(ctx, action, targetType, targetId, old, new) pulls actor/role from ctx.User.
5. **verifyTls**: `PUT /v1/settings` Engineer-reachable for url/code/lang, but `VerifyTls==false` requires **Admin** (403 for Engineer) + writes distinct `settings.verifyTls_disabled` audit action; web shows persistent banner when saved verifyTls==false.
6. **Loopback guard**: pure `DescribeBindingRisk(boundUrls)` + startup LogWarning + `system.startup` audit row if bound non-loopback over http. NOT a hard block (isolated VLAN LAN HMI is legit). Do NOT add UseHttpsRedirection/Hsts by default.
7. **Exhibition/kiosk (LOAD-BEARING)**: when `DemoModeGate.Enabled`, middleware after UseAuthentication auto-provisions + auto-signs-in a REAL disable-able audited `demo-admin` (Admin role) on first unauthenticated request → keeps ALL ~360 xUnit + 16 Playwright specs green (they run against the Demo-flagged engine). Product build (flag unset) never does this. New WS-D specs explicitly logout first to test the 403 boundary.
8. **Dev same-origin fix**: SameSite cookies don't flow cross-origin JS fetch, so add Vite `server.proxy` `/v1/*`→:5199 + change `api.ts:33-35` dev BASE_URL fallback to `""` (relative, VITE_ENGINE_URL still checked first). Add `credentials:"include"` to `request<T>`. CORS gains AllowCredentials (for tauri path).

## RBAC matrix (compact)
- **Anonymous**: GET /v1/health, GET /v1/capabilities, POST /v1/auth/{login,bootstrap}, GET /v1/auth/bootstrap-status, MapFallbackToFile (explicit .AllowAnonymous — it's an endpoint, would inherit fallback policy).
- **Operator+**: GET fleet/machines, POST fleet start/stop/estop/estop-reset, GET mode, GET/POST settings-probe(read), GET config products/points/recipes + machine-config check/diff/history, GET machine-settings + history, GET scenario, all historian GET, auth logout/me/change-password.
- **Engineer+**: POST sync-config, PUT mode, GET/PUT settings, all onboarding, product/point/recipe upsert/delete, machine-config pull/push, machine-settings PUT/DELETE/pull/push, scenario apply/preset/burst, PUT historian/oee/settings, WS /v1/inspector/stream.
- **Admin**: PUT settings when VerifyTls=false (in-handler gate), POST historian/prune, all /v1/users*, GET /v1/audit + /v1/audit/verify.

## Audit coverage: mode.switch, settings.update(+verifyTls_disabled), onboarding.* (mk_ fingerprint only, never raw), product/point/recipe.*, machine.config.pull/push, machine.settings.* (replaces body.By with ctx.User.Name into existing store `by` param + hash-chain row), scenario.*, fleet.start/stop/estop/estop_reset, historian.prune, historian.oee_settings.update, auth.login_success/failed/logout/bootstrap/change_password, user.create/role_change/disable/enable/password_reset, system.startup.

## Web: auth.ts (AuthProvider/useAuth, GET /v1/auth/me retry:false); App.tsx top gate (loading→splash; needsBootstrap→Bootstrap.tsx; user null→Login.tsx; else Shell). api.ts: credentials:"include" + onUnauthorized registry (401→bounce to Login). Sidebar minRole filter + Users(/users Admin) + Audit(/audit Admin) entries. TopBar user menu (needs a new dropdown/popover ui primitive — none exists). Login.tsx, Bootstrap.tsx, Users.tsx (RequireRole), Audit.tsx (table+filters+Verify button). i18n auth.*/users.*/audit.* both vi+en.

## 9 TDD tasks
- **D1** Backend auth core: IUserStore/SqliteUserStore/AppUser (security.db, ladder, PasswordHasher), Roles.cs, AuthEndpoints (bootstrap-status/bootstrap/login/logout/me/change-password), cookie wiring in Program.cs (AddCookie, pinned DataProtection, OnValidatePrincipal revocation, default-deny fallback, AllowAnonymous on health/capabilities/auth/fallback), fix DesktopShell probe→/v1/health. Add Mvc.Testing (TEST-ONLY) for real-pipeline 401/200 tests; rest plain xUnit on SqliteUserStore.
- **D2** RBAC policies onto every existing route per matrix (Policies.cs, .RequireAuthorization/.AllowAnonymous ~40 routes across 9 files + fallback). Tests: endpoint-metadata policy assertions + a few Mvc.Testing 403 (Operator→Engineer route). Existing ~300 handler unit tests stay green.
- **D3** Audit hash-chain store + read/verify: IAuditStore/SqliteAuditStore (security.db), AuditRecorder, AuditEndpoints. Tests: append→verify OK; raw-SQL tamper→detected at right seq; concurrent appends ordered.
- **D4** Wire audit into every sensitive mutation + replace free-text `by` (ctx.User.Name into MachineConfigStore by-param + hash row). Per-file xUnit with authenticated ClaimsPrincipal on DefaultHttpContext.User.
- **D5** verifyTls Admin-gate + settings.verifyTls_disabled action + DescribeBindingRisk pure fn + startup warn + system.startup audit. Tests xUnit.
- **D6** Web: auth.ts, Login.tsx, Bootstrap.tsx, App.tsx gate, api.ts credentials+onUnauthorized, vite proxy + BASE_URL fix, i18n. Playwright: demo-admin happy path + explicit logout→Login.
- **D7** Web: Users.tsx (Admin) + UserEndpoints (if not in D1) + Sidebar entry + i18n. Playwright: create Operator as demo-admin → that user 403 on Engineer action.
- **D8** Web: Audit.tsx (Admin, table+filters+Verify button) + Sidebar entry + i18n. Playwright: mutate→row appears with actor→Verify green.
- **D9** E2E hardening + full-suite regression (16 PW + ~360 xUnit green under new layer) + README update + `/security-review` (master-plan merge gate).

## Risks/deferred: offline admin-reset CLI verb (`--reset-admin-password`, physical-possession recovery) + nudge ≥2 admins; pin DataProtection keys; kiosk demo-admin=Admin acceptable for booth not LAN-exposed; Tauri cross-origin cookie limitation (path not built); single-writer security.db lock (ok, only EngineApi writes); no audit retention (by design, deferred); OIDC/MFA/mTLS/X.509/SPIFFE/Vault = ecosystem, NOT here; NU1903 + SDK-side verifyTls = device-to-ecosystem leg, not this local API.
