# Startup failure posture — the rule, and the enumerated set it was checked against

**Owner:** task J-3 (`.superpowers/sdd/startup-failure-posture/`), discharging the item booked at
`FleetCore`'s P5. **Status:** descriptive — this records what the product does, and names where it does
something else. **Nothing here is enforced by a test.**

This file exists because the rule was previously stated as a **scalar** ("thirty-six sites, thirty-two
agree") in five places with **the members enumerated nowhere the tree could reach**. An independent
re-derivation then returned a different number and found two sites the scalar had silently absorbed. That is
§8.1's standing class — *"một con số vô hướng tóm tắt một tập không đồng nhất"*, remedy *"liệt kê thay vì
đếm"*. **The list is the artefact; the counts below are counts of rows in it and carry no authority of their
own.**

---

## 1. The rule

> **A host refuses to start over a bad configuration only when starting would be the QUIETER failure.**

**The test — and it is one test, not two:**

> **Would continuing HIDE the loss?** If the thing that stopped working would go on being presented as
> working — a record acknowledged but never made durable, a boundary reported but not enforced, a store whose
> absence nothing announces — then stopping is the only channel left and the host stops. If the loss can be
> named on a surface somebody reads, and nothing left running claims the lost thing still works, the host
> comes up and reports.

**Provenance is the REASON, not a second test.** Where the value came from — an environment variable or an
ACL an operator set, versus a file the product itself wrote — is what an operator needs in order to repair
either arm, and it is why the two headline sites *feel* like opposite rulings. It is **not** a second
conjunct, and the reason is measured rather than argued:

- Across the whole set below, the test above reproduces **every** compliant member and every divergence
  except one. Adding provenance as a second conjunct changes exactly **one** prediction in the whole set.
- The one it changes is `ConnectorConfigStore` (§3.2), which is independently visible as a symmetry defect
  with no rule at all — a guarded structural twin plus a false completeness claim.
- And at the settings replay, provenance and repairability **come apart**: that arm's own remedy string tells
  the operator to *"edit/delete fleet-settings.json … and restart"*, so the value **can** be corrected
  without the process even though the product wrote it. A conjunct stated as *"correctable without this
  process"* is therefore **satisfied** there, not failed — which is why the earlier "fails both conditions
  independently / over-determined" framing was withdrawn.

**What survives, and it is the narrower true claim:** `PUT /v1/settings` is the only *in-product* correction
for that file, and a dead service says nothing about which of three fields is wrong. That is a real
difference between the two arms. It is a **reason**, and it is recorded as one.

### Why the two headline sites are the same rule

| Site | Would continuing hide the loss? | Outcome |
|---|---|---|
| `wal.EnsureDir()` — WS-C | **Yes.** The only alternative is a null queue path, and an in-memory queue keeps returning successful acks for records that die with the process. Invisible *in the outcome*. | **STOPS** |
| the startup settings replay — H-1a | **No.** The failure is named at `Error`, and `GET /v1/settings` goes on truthfully reporting the triple this process holds. Nothing claims the Live transport was rebuilt. | **COMES UP** |

Both choose the louder failure. Neither ruling needs revisiting.

### The strongest evidence the rule is descriptive rather than invented

The product **manufactures** the test's falsity whenever it intends to come up:
`NotificationStartupNotices.Describe` (the exhaustively-asserted invariant "if nothing will be delivered, at
least one Warning is produced"), `ConnectorConfigVisibilitySeeder` plus the rule that no roster descriptor is
seeded for a connector that failed to register, and product-mode `FleetCore.ResolveFleet` refusing to
substitute the demo fleet. None of those is a logging convenience; each is machinery whose only purpose is to
*earn* the right to come up.

---

## 2. The domain, the granularity rule, and the instrument

**Domain — startup-path configuration decisions.** Every statement a composition root executes before its
host begins serving, at which a value obtained from outside the running program — an environment variable, a
file, a directory's existence or ACL, a command-line argument, a store the product previously persisted — can
fail to be usable, and where the code at that point determines whether the process continues or ends.

🔴 **This is NOT a rule about relocatable roots.** Roughly a third of the set below is roots; the rest is
argument vectors, a bind address, register and node maps, `connectors.json`, `fleet.json`, `products.json`,
`recipes.json`, the ecosystem catalogues, persisted connector rows, a broker port, an ACL hardening step,
five `FromEnvironment` factories and the settings replay itself. README §15.9 presents a **view** of this set
projected onto roots, because that is the register an operator relocating a directory reads. **The view is
not the domain, and the root table is not this list.**

**Granularity rule, stated because it is where two independent derivations disagreed by more than membership
did:** one row per **statement** in a composition root that can fail on an external value. A single store's
distinct failure **arms** get their own rows only when their postures differ (which is why the identity store
has three rows and the historian one). An `X.FromEnvironment()` factory that validates is its own row,
separate from the store call it feeds.

**Instrument:** a read of the four composition roots — `src/St4i.EngineApi/Program.cs`,
`src/St4i.EdgeService/Program.cs` + `EdgeWorker`, `src/St4iMachineSimulator/App.xaml.cs`,
`src/St4i.DesktopShell/App.xaml.cs` — plus every store constructor and options factory they reach. **Nothing
was executed.**

**Ceilings, named rather than left to be discovered:**

1. A read cannot see the part of the DI graph resolved **lazily after the host is serving**. A factory that
   throws on first resolution fails a request, not a boot. `SqliteUserStore` is the clearest case — `IUserStore`
   is resolved only per request, via `context.RequestServices` — and it is **excluded** for that reason.
2. Rows marked **boundary** execute inside `app.Run()` rather than before it. They are listed because they are
   still startup failures to an operator, and marked because they are not before-serving by the property's own
   words.
3. One row is **unsettled** and says so: whether an exception from an `ApplicationStarted` handler ends the
   host depends on whether `HostApplicationLifetime.NotifyStarted` wraps handler execution in its own
   try/catch. Framework behaviour says it does — which would make that row **U** — but this was read, not run.
   *The experiment that settles it: throw from an `ApplicationStarted` handler and report whether the host
   serves.*

---

## 3. The set

**S** = the process ends. **U** = the host comes up and the failure is reported. **✓** = matches the rule.
**✗** = divergence, named and deliberately not fixed (flipping any is an operator-observable startup change).

### 3.1 `St4i.EngineApi` — `Program.cs`, in execution order

| # | Statement | External value | Hides the loss? | Posture | |
|---|---|---|---|---|---|
| 1 | `ServiceInstallVerbs.TryHandle` | argv | — | exit by design | n/a |
| 2 | `AdminRecoveryVerbs.TryHandle` | argv + `security.db` | — | exit by design | n/a |
| 3 | `UseUrls` / `ASPNETCORE_URLS` | env, argv | yes | **S** (boundary — Kestrel, inside `app.Run()`) | ✓ |
| 4 | `Directory.CreateDirectory(securityDir)` | `ST4I_SECURITY_DIR` | yes | **S** | ✓ |
| 5 | `SecurityDirAcl.Apply` | filesystem ACL | no | **U** | ✓ |
| 6 | `Directory.CreateDirectory(securityKeysDir)` | same root | yes | **S** | ✓ |
| 7 | `WalOptions.FromEnvironment()` → `Validate` | `ST4I_WAL_MAX_BYTES` | **yes** (unparseable → silent) | **S** on range, **silent** on parse | **✗ §3.4** |
| 8 | `wal.EnsureDir()` | `ST4I_WAL_DIR` | yes | **S** — *posture A* | ✓ |
| 9 | `NotificationConfigStore` ctor + `ListAsync` | `ST4I_NOTIFICATIONS_DIR` | no | **U** | ✓ |
| 10 | `UnsOptions.FromEnvironment()` | `ST4I_UNS_PORT` | **yes** | **silent** | **✗ §3.4** |
| 11 | UNS broker bind | `ST4I_UNS_PORT` | no | **U** | ✓ |
| 12 | `DeviceIdentityStore` ctor — creates the dir | `ST4I_IDENTITY_DIR` | no | **S** | **✗ §3.3** |
| 13 | `LoadOrCreate` → `MintPfxBytes` (outside `Create`'s `try`) | CNG / crypto provider | n/a — no continue-arm exists | **S**, uncaught | **✗ §3.3** |
| 14 | `LoadOrCreate` → `Persist` | same dir, writability | no | **U** | ✓ |
| 15 | `BridgeSpoolOptions.FromEnvironment()` | `ST4I_BRIDGE_SPOOL_MAX_BYTES`, `…_MAX_AGE_HOURS` | **yes** | **silent** ×2 | **✗ §3.4** |
| 16 | `BridgeSpool` ctor | `ST4I_BRIDGE_SPOOL_DIR` | no | **U** | ✓ |
| 17 | `new SiteLinkStore()` — creates the dir; **only when UNS is enabled** | `ST4I_SITELINK_DIR` | yes | **S** | ✓ |
| 18 | `siteBridgeManager.ApplyAsync` | sitelink contents | no | **U** | ✓ |
| 19 | `ModbusOptions.FromEnvironment()` | `ST4I_MODBUS_PORT` | **yes** | **silent** | **✗ §3.4** |
| 20 | Modbus register-map load | `ST4I_MODBUS_MAP` | no | **U** | ✓ |
| 21 | `OpcUaOptions.FromEnvironment()` | `ST4I_OPCUA_*` | — | no failure arm (no parse, no I/O) | n/a |
| 22 | OPC-UA node-map load | `ST4I_OPCUA_MAP` | no | **U** | ✓ |
| 23 | `ConnectorsConfig.Load` | `connectors.json` | no | **U** | ✓ |
| 24 | `ConnectorConfigStore` ctor — dir + schema | `ST4I_CONNECTOR_CONFIG_DIR`, `connector-config.db` | yes | **S** | ✓ by the rule; **see §3.2** |
| 25 | `connectorConfigStore.LoadAllAsync()` | same db | no | **U** | ✓ |
| 26 | visibility-seeding block | same db | no | **U** (both seeders never throw) | ✓ |
| 27 | `FleetSettingsStore` ctor — creates the dir | `ST4I_SETTINGS_DIR` | yes | **S** | ✓ |
| 28 | `Directory.CreateDirectory(webRootPath)` | install layout | yes | **S** | ✓ |
| 29 | `GetRequiredService<FleetHost>()` → `SqliteHistorianStore` ctor | `ST4I_HISTORIAN_DIR` | yes | **S** | ✓ |
| 30 | → `AssetRegistryStore` ctor | `ST4I_ASSETS_DIR` | yes | **S** | ✓ |
| 31 | → `MachineConfigStore` ctor | `ST4I_MACHINE_CONFIG_DIR` | yes | **S** | ✓ |
| 32 | → **`ProductConfigStore` ctor + `Load()`** | `products.json`, `recipes.json` beside the binary | **no** | **S** | **✗ §3.5** |
| 33 | → **`SimulatedEcosystem` ctor + `Load()`** | `ecosystem\*.json` beside the binary | **no** | **S** | **✗ §3.5** |
| 34 | → `ConnectorRegistry` factory | rows, `connectors.json` | no | **U** per entry (every arm is a `Try*`) | ✓ |
| 35 | → `FleetCore.ResolveFleet` | `fleet.json`, `--fleet` | no | **U** | ✓ |
| 36 | `settingsStore.Load()` | `fleet-settings.json` | no | **S** | **✗ §3.1a** |
| 37 | the startup settings replay | that triple | no | **U** — *posture B* | ✓ |
| 38 | the seed-arm discard | same file | no | **U** (own try/catch) | ✓ |
| 39 | `AlarmThresholds.FromEnvironment()` | four `ST4I_ALARM_*` knobs | **yes** | **silent** ×4 | **✗ §3.4** |
| 40 | `ApplicationStarted` callback — binding notice + `system.startup` audit | bind addresses, `security.db` | no | **UNSETTLED** — S or U, see §2 ceiling 3 | — |
| 41 | hosted services (inside `app.Run()`) → `AlarmStore` ctor | `ST4I_ALARMS_DIR` | yes | **S** (boundary) | ✓ |

**Excluded, with the reason, because an exclusion is a decision:**
`builder.Build()` — the failing value is the DI graph, which is not from outside the program.
`GetRequiredService<WalFlushPump>()` — no external value.
`SqliteUserStore` / `SqliteAuditStore` at first request — beyond ceiling 1.

**Other hosts:** `EdgeWorker.BuildTransport` → `wal.EnsureDir()` (**S**);
`St4iMachineSimulator/App.xaml.cs` → `wal.EnsureDir()` (**S**); `St4i.DesktopShell/App.xaml.cs` — no startup
decisions. `TransportCoordinator.RebuildLive` → `wal.EnsureDir()` is the **same call at runtime**, which is
how a WAL failure reaches the settings replay's guard, and is why the two headline sites are coupled rather
than merely adjacent.

### 3.1a — Divergence: `fleet-settings.json` is READ unguarded

`Program.cs:1801`, 104 lines above the guard built so that file can never take the host down.
`FleetSettingsStore.Load()` catches only `JsonException`, so a *corrupt* file is tolerated and an
*unreadable* one is not: `File.ReadAllText` propagates `IOException` out of the composition root.

**The reachable vector is a deny-share lock** — an editor or an AV scanner holding the file — including the
editor the RESTORE-arm remedy string tells the operator to open it with.

🔴 **An ACL is NOT the vector, and getting this right sharpens the finding rather than weakening it.**
`Load()` gates on `File.Exists`, which returns **false** when the caller lacks permission. So a permission
failure that reaches attribute lookup returns `null` and **selects the SEED arm today, with no guard at all**
— which is exactly the outcome this entry says the obvious guard would introduce. **The inversion is already
reachable.** And an ACL severe enough to fail `Directory.CreateDirectory` stops the host 224 lines earlier at
row 27, never reaching row 36.

**The obvious guard is itself a defect, and the harm is worse than an overwrite.** Wrapping the read so it
yields null makes an unreadable file indistinguishable from *no* file, selecting the seed arm. Then:
the environment floor is applied; `UpdateSettings` persists unconditionally; **and `Program.cs:2006` runs
`settingsStore.Delete()`**, logging *"Nothing an operator wrote was deleted — no settings file existed before
this start."* With a present-but-unreadable file that sentence is **false and the operator's file is gone**,
not merely overwritten.

**What is missing is a third state — "a file exists and could not be read"** — which neither the composition
root nor `FleetSettingsStore` expresses. Building it changes what an operator observes at startup.

### 3.2 — `ConnectorConfigStore`: a symmetry defect that does NOT need this rule

The constructor creates a directory and runs a four-rung SQLite migration ladder, unguarded, while its
structural twin `NotificationConfigStore` — same shape, same file, same "opened synchronously before the host
is built" — is wrapped, and the comment at that wrap claims the posture is shared by *"every other startup
config load here"*. It is not.

🔴 **This is recorded as an §8.1(h4) symmetry finding, not as a yield of the rule.** By the test in §1 this
row **agrees**: a connector store that never opened is an absence nothing announces, so stopping is correct.
It was previously presented as a rule divergence, which required provenance as a second conjunct — and that
conjunct changes no other prediction in this table. The finding stands on the asymmetry and the false
completeness claim alone, which is checkable by reading and does not depend on the rule being right.

**The reason for the asymmetry is the useful part:** `NotificationEndpoints` resolves its store with
`GetService` and answers honestly when it is absent; `ConnectorEndpoints` takes its store as a **non-nullable
handler parameter** (7 such parameter sites in `src/`, 4 of them route handlers), so minimal-API metadata
requires the type to always be registered. **There is no "absent" state for this store to fail into.**
Guarding the constructor means building that state first.

**Second instance of the same false-completeness shape, found by the sibling scan and named here rather than
rewritten:** `Program.cs:1716` claims the *"one bad source disables only itself"* posture is one
*"every other startup config load in this file already has"* — false in the same way, and rows 7, 12, 24, 27,
32, 33 and 36 all contradict it. Neither claim is rewritten: doing so would settle a rule this task is not
authorised to settle.

### 3.3 — Divergence: the identity store decides one variable's failure three ways

- **Row 12** — the constructor's `Directory.CreateDirectory` is unguarded, so a root that cannot be
  **created** ends the process.
- **Row 14** — a root that exists but cannot be **written** comes up on an in-memory identity with an
  `Error`, and the class says in as many words that *"an unwritable identity directory is an operational
  problem to fix on disk, not a reason the device can't come up at all."*
- **Row 13** — `MintPfxBytes` is called **outside** `Create`'s `try`, so a CNG/crypto-provider failure at
  first mint is an uncaught **S** out of `LoadOrCreate`, whose class doc promises it *"never lets a bad file
  crash the caller"*. This third arm was missed by the first two rounds of this analysis; the rule does not
  decide it, because no continue-arm exists to evaluate.

Three adjacent statements, three outcomes, nothing saying so.

### 3.4 — Divergence class: nine silent parse-ignores, not one site

The shape is *"unparseable → silent fallback, with **no warning channel at all**"*. The sibling scan
(§8.1 principle 3: *"mọi bản sửa kèm một lệnh grep tìm anh em của nó"*) was run and returns **nine** sites in
five files, none of which has a `logWarning` parameter to thread:

| File | Knobs |
|---|---|
| `St4i.EdgeCore/Transport/WalOptions.cs` | `ST4I_WAL_MAX_BYTES` |
| `St4i.EdgeCore/Uns/UnsOptions.cs` | `ST4I_UNS_PORT` |
| `St4i.EdgeCore/Drivers/Modbus/ModbusOptions.cs` | `ST4I_MODBUS_PORT` (its own doc says *"silently ignored"*) |
| `St4i.EdgeCore/Site/BridgeSpoolOptions.cs` | `ST4I_BRIDGE_SPOOL_MAX_BYTES`, `…_MAX_AGE_HOURS` |
| `St4i.EngineApi/Alarms/AlarmThresholds.cs` | `ST4I_ALARM_NGRATE_THRESHOLD`, `…_MINSAMPLE`, `…_EVAL_INTERVAL_MS`, `ST4I_IDENTITY_EXPIRY_WARN_DAYS` |

Each is a breach of the test in §1 in the **come-up** direction: an operator's typo takes effect as a default
with nothing said anywhere. The *validated* arm of the same factories throws and stops the host, which is the
internal asymmetry.

🔴 **The earlier framing pointed this class's "structural twin" at `ModbusRegisterMap.FromJson` — the site
that behaves CORRECTLY** (it takes a `logWarning` and surfaces a tolerated fallback). That was the domain
inherited from where the author stood, inside the WAL vocabulary: the correct comparison is not one good
neighbour but the eight siblings that share the defect.

### 3.5 — Divergence: two operator-editable catalogues end the process, and their twins do not

`ProductConfigStore` and `SimulatedEcosystem` both do `Directory.CreateDirectory(...)` then `Load()` in the
constructor, and `Load()` deserializes JSON from beside the binary with **no `catch` of any kind**. Both are
`FleetHost` constructor parameters, so both are built by the unguarded `GetRequiredService<FleetHost>()` that
rows 29–31 already pass through. A malformed `products.json` — hand-editable, beside the exe, with no schema
published to whoever edits it — ends the process. (Both also call `Save()` on first run when a file is
missing, so a read-only install directory is a second fatal arm.)

**They are structural twins of two members that are tolerated:** `connectors.json` (row 23, guarded) and
`fleet.json` (row 35, guarded via `FleetConfigException`, with a per-entry skip added precisely so *"one
operator typo destroys the whole fleet"* stopped being true). All four are operator-editable JSON beside the
binary. Two are tolerated; two are fatal.

By the test in §1 these predict **U**: nothing claims a product catalogue is loaded that is not, and the
failure is nameable. Actual: **S**. **These two were absorbed by a scalar in the first two rounds of this
analysis and surfaced by an independent re-derivation** — which is the whole argument for publishing the list
rather than the count.

---

## 4. Where two independent derivations disagreed

Both this list and an independent re-derivation return **41 rows**. 🔴 **Treat that as a coincidence, not a
confirmation** — §8.1: *"bằng chứng cho tính đầy đủ … là CHỖ BẤT ĐỒNG giữa các dụng cụ độc lập, không phải
chỗ chúng đồng thuận."* The memberships differ, and the differences decompose:

| Kind | Effect |
|---|---|
| **Genuinely missed** — `ProductConfigStore`, `SimulatedEcosystem` (§3.5); the identity mint (§3.3, row 13); eight of the nine parse-ignores (§3.4) | Real. Two new divergences and one new arm. The first derivation's number absorbed them. |
| **Granularity** — the five `FromEnvironment` factories now counted as their own rows, at the same granularity row 7 always had | Neither derivation was wrong; the rule for splitting arms was unstated, which is why it is now stated in §2. |
| **Over-counted before** — `builder.Build()`, `WalFlushPump`, `SqliteUserStore` | Removed with reasons; `SqliteUserStore` was a double-count of a root **and** beyond the stated ceiling. |
| **Still unsettled** — row 40 | Marked, with the experiment that settles it. |

**A number this list previously stated and which is now withdrawn: "thirteen of them are roots."** It is
refuted by README §15.9's own two tables without any re-derivation — that section's thirteen machine-wide
roots include `creds` and `opcua-pki`, which the outcome table itself declares to have *no startup decision*,
while `machine-config` is a member here and is **not** one of the thirteen (it defaults beside the binary,
which is why `PerHostDataRootsTests` puts it in population two). A summary contradicting the list it
summarises, in the artefact written to end an ambiguity. **No replacement scalar is offered. Count the rows.**
