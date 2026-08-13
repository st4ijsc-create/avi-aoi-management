# Startup failure posture — the rule, and the enumerated set it was checked against

**Owner:** task J-3 (`.superpowers/sdd/startup-failure-posture/`), discharging the item booked at
`FleetCore`'s P5; §2 ceiling 3 and §3.1a re-measured by task M-1
(`.superpowers/sdd/settings-acl-probe/`). **Status:** descriptive — this records what the product does, and
names where it does something else. **Nothing here is enforced by a test**, and two rows — and only two —
are now backed by something that runs: `tools/settings-acl-probe`.

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

**Instrument 1 — a read.** The four composition roots — `src/St4i.EngineApi/Program.cs`,
`src/St4i.EdgeService/Program.cs` + `EdgeWorker`, `src/St4iMachineSimulator/App.xaml.cs`,
`src/St4i.DesktopShell/App.xaml.cs` — plus every store constructor and options factory they reach. It
produced every row below. **Nothing was executed to produce it**, and it was wrong twice in the same
direction before this file existed.

🔴 **Instrument 2 — an execution, added by task M-1: `tools/settings-acl-probe`.** A committed console app
outside the five test suites, for the reason `tools/serial-bench` already carries: making a directory
unreadable cannot be done from a suite without a conditional skip, and a conditional skip makes `Skipped`
environment-dependent, which is what stops the grand total meaning the same thing on every machine. It
answers exactly two of this file's questions — **what curtailed access to the settings root or file actually
does** (§3.1a) and **whether a throwing `ApplicationStarted` handler ends the host** (ceiling 3, row 40) —
and it answers nothing else. **Its reach is two rows out of the set below. Every other row is still a read.**

**Where the two instruments DISAGREED is the useful part**, per §8.1: reading produced two opposite
statements about §3.1a in two successive rounds, and the execution shows that **each described one member of
a population and was written as a claim about the population**. Neither round was careless; the read had no
way to see that "unreadable" is not one state.

**Ceilings, named rather than left to be discovered:**

1. A read cannot see the part of the DI graph resolved **lazily after the host is serving**. A factory that
   throws on first resolution fails a request, not a boot. `SqliteUserStore` is the clearest case — `IUserStore`
   is resolved only per request, via `context.RequestServices` — and it is **excluded** for that reason.
2. Rows marked **boundary** execute inside `app.Run()` rather than before it. They are listed because they are
   still startup failures to an operator, and marked because they are not before-serving by the property's own
   words.
3. ~~One row is **unsettled**~~ — 🔴 **SETTLED by task M-1, and the answer was the predicted one.** The
   question was whether an exception from an `ApplicationStarted` handler ends the host.
   **Measured: it does not.** `tools/settings-acl-probe`'s fourth pass registers a throwing handler exactly
   as the composition root registers its own — `app.Lifetime.ApplicationStarted.Register(...)` before
   `app.Run()` — and the host **serves**: `GET` answered `200`, `app.Run()` did not return, and the
   throw was reported by the framework itself at **`Critical`** on
   `Microsoft.Extensions.Hosting.Internal.ApplicationLifetime` (*"An error occurred starting the
   application"*, carrying the `AggregateException`). A control arm whose handler returns normally serves
   identically and logs **nothing** at Warning or above, which is what makes the Critical line evidence
   about the throw rather than about the rig. Row 40 is therefore **U**, and ✓ by the rule in §1: the loss is
   named on a surface an operator reads. On this product that level reaches the console and the Windows
   Event Log without configuration — §10.4's own reason, that no `appsettings.json` ships, so the
   framework's default minimum applies.
   *Two ceilings on that measurement, stated rather than left to be found:* it was run on a minimal host on
   ASP.NET Core 10, not on `St4i.EngineApi` itself, so it is evidence about `NotifyStarted`'s contract and
   not about this product's own callback body; and it says nothing about the **audit row** that callback
   exists to write, which a throw before `RecordSystemAsync` would still silently omit.

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
| 40 | `ApplicationStarted` callback — binding notice + `system.startup` audit | bind addresses, `security.db` | no | **U** — *measured*, M-1; see §2 ceiling 3 | ✓ |
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

The site is the `settingsStore.Load()` call in `St4i.EngineApi/Program.cs`, above the
`TryReplayStartupSettings` guard built so that file can never take the host down.
`FleetSettingsStore.Load()` catches only `JsonException`, so a *corrupt* file is tolerated and an
*unreadable* one is not: `File.ReadAllText` propagates `IOException` out of the composition root.

🔴 **Every citation in this file names a SYMBOL, never a line number or a line distance** — deliberately, and
it is the same discipline §3.1a's own neighbour argues for at `Program.cs`'s stale `~1550` pointer. A position
is a pointer that decays without anyone touching it, and this file exists to replace an unfalsifiable scalar
with something checkable; citing positions would have reintroduced the defect in the artefact written to end
it. Find each site by its symbol.

**A deny-share lock is A reachable vector** — an editor or an AV scanner holding the file — including the
editor the RESTORE-arm remedy string tells the operator to open it with. It is **not the only one**, and it
depends on the share mode the holder asked for: measured, `FileShare.None` reaches the read and
`FileShare.Read` does not.

🔴 **MEASURED — task M-1, `tools/settings-acl-probe`, every row below RUN rather than reasoned. It refutes
BOTH of this entry's earlier statements.** Round one said an ACL reaches the read; round two said an ACL is
*not* the vector because `File.Exists` answers false on a permission failure. **Each is true of one member of
the population, and each was written as a claim about the population.** "Unreadable" is not one state: a
Windows ACL withholds rights individually, and the store's two surfaces answer differently depending on
**which** right is withheld and on **what object**.

| What is withheld, and on what | ctor | `File.Exists` | `Load()` | The arm that follows |
|---|---|---|---|---|
| all four read rights + `Traverse` on the settings **directory**, that object only | ok | true | the triple | **RESTORE — nothing changes at all** |
| the same rights on the settings **directory**, **propagated to its children** | ok | **false** | **null** | **SEED — with the operator's file present** |
| all four read rights on the **file** | ok | **true** | **throws `UnauthorizedAccessException`** | **the process ends at the read** |
| `ReadData` alone on the **file** | ok | **true** | **throws `UnauthorizedAccessException`** | **the process ends at the read** |
| `ListDirectory` alone, `ReadAttributes` alone, or `Traverse` alone on the **directory** | ok | true | the triple | RESTORE — none of these bite |
| `ReadAttributes` alone on the **file** | ok | true | the triple | RESTORE |
| all four read rights + `Traverse` on the settings root's **parent** | ok | true | the triple | RESTORE |
| a handle held with `FileShare.None` | ok | true | **throws `IOException`** | **the process ends at the read** |
| a handle held with `FileShare.Read` | ok | true | the triple | RESTORE |
| `Write` on the **parent**, with the settings root ABSENT | **throws `UnauthorizedAccessException`** | — | — | the process ends at the ctor (row 27) |

**Two Windows mechanisms decide the whole table, and the probe measures both rather than asserting them:**

1. **A deny on a directory does not reach a file inside it.** The `Traverse`-only row opens the file with
   traverse denied on the file's own parent, which is what traverse-check bypass
   (`SeChangeNotifyPrivilege`) looks like from outside. 🔴 **The bypass itself was NOT measured — the
   mechanism is an inference from the outcome**, taken on ONE token: a non-elevated interactive logon, the
   identity the probe prints in its own header. A service account whose policy withholds that privilege is
   outside every row of this table, and the probe would have to be re-run under it to say anything.
2. **`File.Exists` answers off the file, not off the directory.** It returns **true** through every
   file-scoped deny above, which is exactly why the read is reached and throws. It returns **false** only
   where the deny landed **on the file**, as an inherited ACE.

**What this settles, item by item:**

- **The ACL vector is real and it reaches the read.** A deny on the file — `ReadData` alone is enough —
  makes `Load()` throw out of the unguarded call at the composition root. Row 36's **S** and its ✗ stand,
  and the divergence now has a measured vector that is not a lock.
- **The seed-arm inversion is also real, and it takes a DIFFERENT ACL** — one propagated to the file, which
  is what the folder-properties dialog writes by default. Round two's conclusion survives for the inherited
  shape only, and it was stated for a shape that produces the opposite outcome.
- **None of the six read-denying shapes above stops the host at the constructor.**
  `Directory.CreateDirectory` on an existing but unreadable directory succeeded in every one. The
  constructor arm is real — it throws when the root must be
  **created** and the parent withholds `Write` — but that is a write-permission arm, so *"an ACL severe
  enough to fail `Directory.CreateDirectory` stops the host earlier still, never reaching row 36"* holds for
  no shape this entry is about.

🔴 **The harm was measured too, and it is not the harm this entry claimed.** On the one ACL shape that selects
the seed arm, `Save` throws `FileNotFoundException` out of the atomic write's rename and **`Delete()` is a
no-op**, because it gates on the same `File.Exists` that already answered false. **The operator's file
survives.** What is left in the directory is that file plus an orphaned `fleet-settings.json.tmp-<guid>`
nothing ever looks at again. So *"Nothing an operator wrote was deleted — no settings file existed before
this start"* is **false in its premise and true in its effect**.

**Where the operator's file IS deleted is the CORRUPT-file arm, which this entry never named.** A malformed
`fleet-settings.json` yields null through the documented `JsonException` tolerance, `Save` then succeeds,
`Delete` then succeeds, and the file is gone. That arm is gated on the replay ALSO failing to activate, and
the note at the seed-arm block in `Program.cs` enumerates why no env-var-only route reaches an activation
throw today — so this harm is one contract away rather than live, and the contract is `_onLiveSettingsRebuilt`.

**The obvious guard is still a defect, for a narrower reason.** Wrapping the read so it yields null makes an
unreadable file indistinguishable from *no* file and moves the three throwing rows above onto the seed arm,
where the environment floor is applied and `UpdateSettings` persists unconditionally. **What is missing is
still a third state — "a file exists and could not be read"** — which neither the composition root nor
`FleetSettingsStore` expresses. Building it changes what an operator observes at startup.

**Re-running any of this:** `dotnet run --project tools/settings-acl-probe`. It builds its own temp sandbox,
points the store at it through `FleetSettingsStore.EnvVarDir` — the same seam the composition root reads —
refuses every path outside that sandbox before issuing a syscall, and verifies each ACL back by SDDL
comparison. It never touches `%ProgramData%\ST4I`, and it proves the refusal rather than promising it.

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
rewritten:** the doc block on `LogIfRegisterMachineCollided` in `Program.cs` claims the *"one bad source
disables only itself"* posture is one *"every other startup config load in this file already has"* — false in
the same way, and rows 7, 12, 24, 27, 32, 33 and 36 all contradict it. Neither claim is rewritten: doing so would settle a rule this task is not
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
| ~~**Still unsettled** — row 40~~ | 🔴 **Run, by M-1's probe.** The predicted **U** was correct. That is one row of forty-one; the number of rows produced by an instrument that executes is now **two**. |
| 🔴 **Where the two instruments disagree — §3.1a** (M-1) | The read produced two **opposite** statements in successive rounds and the execution refutes both, because each described one member and was written about the population. This is the disagreement §8.1 asks for, and it is the only place this file has one. |

**A number this list previously stated and which is now withdrawn: "thirteen of them are roots."** It is
refuted by README §15.9's own two tables without any re-derivation — that section's thirteen machine-wide
roots include `creds` and `opcua-pki`, which the outcome table itself declares to have *no startup decision*,
while `machine-config` is a member here and is **not** one of the thirteen (it defaults beside the binary,
which is why `PerHostDataRootsTests` puts it in population two). A summary contradicting the list it
summarises, in the artefact written to end an ambiguity. **No replacement scalar is offered. Count the rows.**
