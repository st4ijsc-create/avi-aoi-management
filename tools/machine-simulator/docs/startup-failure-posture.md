# Startup failure posture — the rule, and the enumerated set it was checked against

**Owner:** task J-3 (`.superpowers/sdd/startup-failure-posture/`), discharging the item booked at
`FleetCore`'s P5; §2 ceiling 3 and §3.1a re-measured by task M-1
(`.superpowers/sdd/settings-acl-probe/`); **row 36 CHANGED — not merely re-measured — by task Q-1**
(`.superpowers/sdd/third-state-unreadable/`), executing the owner's decision 1 of 2026-08-16;
**§3 gained a third posture symbol and §3.6 was added by task V-1**
(`.superpowers/sdd/one-unreadable-posture/`), executing the owner's decision 5 of 2026-08-17.
**Status:** descriptive — this records what the product does, and names where it does something else.

🔴 **One claim in this paragraph's earlier version is now false, and it is corrected rather than quietly
dropped.** *"Nothing here is enforced by a test"* — **rows 36 and 18 now are**, by the suites named at the
end of §3.1a-now and §3.1b.

🔴 **Two COUNTS this file briefly carried are withdrawn, and the second withdrawal is the more useful one.**

1. **The count of rows backed by an execution has now been wrong THREE times — "three", then "two" — and
   the third correction is to stop offering a total.** Both earlier numbers were derived by naming members
   and then reporting the result as a total, which is the one thing naming members cannot establish.

   **What is derivable on this tree, and how:**
   - **Instrument 2's reach IS enumerable**, because it is one committed program whose passes are named in
     its own source and in §2: `tools/settings-acl-probe` answers **{36, 40}** and says so.
   - **Instrument 3's reach is NOT enumerable from this file.** "The five test suites" is an open
     population. Q-1 deliberately indexed witnesses on **36** and **18**; rows **37** and **38** are pinned
     by `StartupSettingsReplayHardeningTests` assertions that predate Q-1 (that is what refuted the
     withdrawn denial in point 2 below). Nobody has run the census that would find the rest.
   - **So: at least FIVE rows — 18, 36, 37, 38, 40 — are backed by an execution, and NO TOTAL IS
     OFFERED.** *"At least"* is doing real work rather than hedging: naming members establishes a **lower
     bound** and nothing else. A total is an upper bound too, and that needs the census point 2 withdrew a
     number for.

   🔴 **The "two" this replaces was itself produced by the mechanism this file exists to end**, and it is
   worth recording because it happened *inside the correction of the same defect*: it was derived from
   instrument 3's **declared** reach ({36, 18}) at a moment when point 2 had already established that
   instrument 3's declared reach was understated. **Instruments that execute: three. Rows: unbounded above,
   five named below.** Those are different numbers and every earlier version conflated them.
2. *"row 36 is the only row of the forty-one that any assertion is indexed on"* / *"forty are still a
   read"* is **withdrawn outright, not re-fitted.** It is a universal denial and it was refuted by the very
   file Q-1 added its witness to: `StartupSettingsReplayHardeningTests.AnUnactivatablePersistedTriple_…`
   pins **row 37** and `…AFailedEnvFloorSeed_LeavesNoFile_…` pins **row 38**, both predating Q-1. **No
   replacement number is offered.** Producing one honestly needs a census that maps assertions onto rows,
   and no such census exists; a universal negative is only checkable by an instrument that could refute it,
   never by looking at the members it happens to name. Same disposition, and the same reason, as the
   withdrawn *"thirteen of them are roots"* at the end of this file.

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

🔴 **And inside those two rows its reach stops at the STORE.** No arm of the probe starts `St4i.EngineApi`,
so **S** versus **U** is never observed — it is read off the composition root's control flow and mapped onto
a measured store outcome. Instrument 2 supplies the outcome; instrument 1 supplies the posture. A table that
said otherwise would be making the exact substitution this file exists to stop.

🔴 **Instrument 3 — the five test suites, and what Q-1 pointed at this set with them.** Q-1's own witnesses
are indexed on **row 36** (`FleetSettingsStoreTests` at the store, and
`StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`
through the real composition root) and on **row 18** (`SiteLinkStoreTests`, and
`SiteEndpointsTests.AMalformedSiteLinkFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`). The two
composition-root witnesses **observe** rather than derive: each boots `St4i.EngineApi` and issues a request,
which is precisely the thing instrument 2 states it never does.

🔴 **No count of "how many rows are witnessed" is offered here, and the refusal is the point.** An earlier
version of this paragraph said row 36 was the only such row and that forty were still a read. That is a
universal denial, and it was refuted by the same test file Q-1 added a witness to — rows 37 and 38 are each
pinned by an assertion that predates Q-1. Nobody has run the census that would map assertions onto rows, so
the honest statement is that **most** of this set is still a read and that the number is unmeasured.
**Note what that does to any count of rows-backed-by-an-execution: it makes this instrument's reach a LOWER
BOUND and nothing more** — see the header, which names five and offers no total. A number derived from
*this paragraph's* declared reach would be a total derived from a set this paragraph says it cannot
enumerate, and that error has been made twice already. The
reason the suites cannot simply be pointed at the rest is instrument 2's own: several of these rows can only
be provoked by making something on disk unreadable, and a suite that has to skip when it cannot is a suite
whose `Skipped` count is environment-dependent.

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

🔴 **THE LEGEND ABOVE DECLARED TWO POSTURE SYMBOLS AND THE POSTURE COLUMN HAS ALWAYS CARRIED MORE — task
V-1, and it is checkable by reading the column rather than by trusting this paragraph.** Rows **7, 10, 15,
19 and 39** are marked **silent**, and rows **1, 2 and 21** carry *exit by design* / *no failure arm*. So
the column has used **three** markers the legend never declared, and the one that matters — because it is a
FAILURE the rule has a verdict on, where the other two are "no failure arm" — is **silent**. It is declared
now:

> 🔴 **Q** *(the quieter arm)* **= the host comes up and the failure is NOT reported.** Never **✓**, and the
> reason needs no separate argument: §1's rule says a host refuses to start *only when starting would be the
> QUIETER failure*, so **Q** is by construction the outcome the rule exists to forbid. Where a row already
> reads **silent**, that word is this symbol; the word is left in place because those rows are cited by
> §3.4 under it.

**And the cost of not having declared it is measured, not hypothetical.** `site-link.json` — **row 18** —
was **U ✓** before Q-1's fix round, and §3.1b's own table records that the failed read produced **no log
line at all** (`Save` *succeeded*, so `SiteBridgeManager`'s error path never fired). **U** is a conjunction —
*comes up* **and** *the failure is reported* — and nothing in this table forced the second half to be
checked, so a row satisfying only the first half was recorded as compliant and stayed that way through two
rounds of this file. That is a stronger finding than "the behaviour had no symbol": it **had** one, and the
symbol was wrong. Row 18 is **U ✓** today because Q-1 gave it the `Error` line, not because its posture
moved.

🔴 **AND THE RESIDUAL, WHICH BELONGS HERE RATHER THAN IN A REPORT (fix round, review I-5).** Declaring **Q**
invites re-checking the second conjunct of **every** row marked **U**, and **task V-1 did not do that.** It
checked exactly one — row 18 — because row 18 is the only **U** row whose *reporting* half anything ever
measured (§3.1b's own comparison table). **Every other U row's "and the failure is reported" half is
unverified today**, and the number of them is deliberately not given here: counting them would be a scalar
over a set nobody has swept, which is the defect this file exists to end.

**Why declaring rather than sweeping was the decision.** §2 says most of this set is a **read**, and a
read-based sweep of *"is this failure actually reported?"* would manufacture precisely the population claim
this file was written to stop — an unfalsifiable assertion about forty rows, produced by the instrument that
has already been wrong twice in the same direction. **What would close it** is an instrument, not a
re-reading: something that boots a host into each failure and observes the log, which is the shape Q-1's two
composition-root witnesses already have for rows 36 and 18 and nothing has for the rest.

🔴 **`Q` is declared and no row is marked with it, and that is deliberate (review M-6).** The five rows that
carry this posture already spell it **silent**, and §3.4 cites them under that word; re-spelling the posture
column would edit rows of a published census in a task that changed no row of it, and *"none of those is
fixed"* has to keep meaning what it meant. So one posture has two published spellings today. **What would
end it** is a task authorised to rewrite the posture column, which would mark rows 7, 10, 15, 19 and 39 as
**Q** and reduce `silent` to prose.

🔴 **One row has now been flipped on purpose** — row 36, by task Q-1, under the owner's decision 1; the
change to what an operator observes is the point of it rather than a side effect. The legend still holds of
every remaining **✗**: none of those is fixed. See §3.1a-now.

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
| 18 | `siteBridgeManager.ApplyAsync` | sitelink contents | no | **U** | ✓ — **both halves checked**, see §3.1b |
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
| 36 | `settingsStore.Read()` | `fleet-settings.json` | no | **U** — *fixed by Q-1, see §3.1a-now* | ✓ |
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

### 3.1a — ~~Divergence: `fleet-settings.json` is READ unguarded~~ 🔨 **FIXED by task Q-1 — this entry is now history plus one live paragraph**

🔴 **Read this heading before the tables below.** Everything in this entry was **measured**, and every
measurement in it stands as a record of what the product did up to commit `dd4a3e68`. What has changed is
the product: the owner's decision 1 of 2026-08-16 (`docs/owner-decisions.md`) ruled **FIX**, and task Q-1
executed it. The entry is kept rather than deleted because it is the derivation of the rule that was
applied, and because deleting the evidence for a fix is how the next round loses the reason. **What is
still live is §3.1a-now at the end.**

**The site was** the `settingsStore.Load()` call in `St4i.EngineApi/Program.cs`, above the
`TryReplayStartupSettings` guard built so that file can never take the host down.
`FleetSettingsStore.Load()` caught only `JsonException`, so a *corrupt* file was tolerated and an
*unreadable* one was not: `File.ReadAllText` propagated `IOException` out of the composition root.

🔴 **Every citation in this file names a SYMBOL, never a line number or a line distance** — deliberately, and
it is the same discipline §3.1a's own neighbour argues for at `Program.cs`'s stale `~1550` pointer. A position
is a pointer that decays without anyone touching it, and this file exists to replace an unfalsifiable scalar
with something checkable; citing positions would have reintroduced the defect in the artefact written to end
it. Find each site by its symbol.

**A deny-share lock is A reachable vector** — an editor or an AV scanner holding the file — including the
editor the RESTORE-arm remedy string tells the operator to open it with. It is **not the only one**, and it
depends on the share mode the holder asked for: measured, `FileShare.None` reaches the read and
`FileShare.Read` does not.

🔴 **MEASURED — task M-1, `tools/settings-acl-probe`. It refutes BOTH of this entry's earlier statements.**
Round one said an ACL reaches the read; round two said an ACL is *not* the vector because `File.Exists`
answers false on a permission failure. **Each is true of one member of the population, and each was written
as a claim about the population.** "Unreadable" is not one state: a Windows ACL withholds rights
individually, and the store's two surfaces answer differently depending on **which** right is withheld and
on **what object**.

🔴 **The first four columns below are RUN. The last one is READ** — a mapping from the measured outcomes
onto the composition root's own control flow (`settingsStore.Load()` is unguarded top-level code, and the
`persistedSettings is not null` ternary immediately below it is the RESTORE/SEED fork). **No arm of the
probe starts `St4i.EngineApi`.** Instrument 1 does that column's work, inside a table produced by
instrument 2, and saying so is the point of naming instruments at all.

| What is withheld, and on what | ctor | `File.Exists` | `Load()` | The arm that follows *(derived)* |
|---|---|---|---|---|
| all four read rights + `Traverse` on the settings **directory**, that object only | ok | true | the triple | **RESTORE — nothing changes at all** |
| the same rights on the **directory**, **propagated to its children** | ok | **false** | **null** | **SEED — with the operator's file present** |
| those rights on the **directory** AND all four read rights on the **file**, neither propagated | ok | **false** | **null** | **SEED — with the operator's file present** |
| all four read rights on the **file** | ok | **true** | **throws `UnauthorizedAccessException`** | **the process ends at the read** |
| `ReadData` alone on the **file** | ok | **true** | **throws `UnauthorizedAccessException`** | **the process ends at the read** |
| `ListDirectory` alone, `ReadAttributes` alone, or `Traverse` alone on the **directory** | ok | true | the triple | RESTORE — none of these bite |
| `ReadAttributes` alone on the **file** | ok | true | the triple | RESTORE |
| all four read rights + `Traverse` on the settings root's **parent** | ok | true | the triple | RESTORE |
| a handle held with `FileShare.None` | ok | true | **throws `IOException`** | **the process ends at the read** |
| a handle held with `FileShare.Read` | ok | true | the triple | RESTORE |
| `Write` on the **parent**, with the settings root ABSENT | **throws `UnauthorizedAccessException`** | — | — | the process ends at the ctor (row 27) |

**The rule the `File.Exists` column obeys, stated as the rows state it:** every shape that withholds the
rights on **only one** of the two objects answers **true** — including the one that denies `ReadAttributes`
**directly on the file**. The only shapes answering **false** are the two where the deny reached **both** the
directory **and** the file, plus the control where there is genuinely no file.

🔴 **So it is NOT the inheritance flag, and that was tested rather than assumed.** An earlier draft of this
paragraph said `File.Exists` "answers off the file, not off the directory" and attributed the false to the
ACE being *inherited* — which its own table already falsified, since a direct deny of the same rights on the
same file answers true and an access check never consults `INHERITED_ACE`. A **discriminating row** was
added: both objects denied by two **explicit, non-propagating** rules. It answers **false**. Inheritance is
merely the usual way an operator produces the combination — the folder-properties dialog propagates by
default — and it is not the mechanism.

**Two explanations, both marked as what they are:**

1. *(inferred)* **A deny on a directory does not reach a file inside it.** The `Traverse`-only row opens the
   file with traverse denied on the file's own parent, which is what traverse-check bypass
   (`SeChangeNotifyPrivilege`) looks like from outside. **The bypass itself was not measured**, and it was
   taken on ONE token: a non-elevated interactive logon, the identity the probe prints in its own header. A
   service account whose policy withholds that privilege is outside every row here.
2. *(inferred)* **The attribute lookup is answered from the parent's directory entry while the parent
   permits it, and falls back to a parent enumeration that the parent must also permit** — which is why
   denying either object alone leaves it answerable and denying both does not. Consistent with every row;
   the discriminating row rules out the rival "the inherited flag matters" explanation, and **nothing here
   rules out a third**.

**What this settles, item by item:**

- **The ACL vector is real and it reaches the read.** A deny on the file — `ReadData` alone is enough —
  makes `Load()` throw out of the unguarded call at the composition root. Row 36's **S** and its ✗ stand,
  and the divergence now has a measured vector that is not a lock.
- **The seed-arm inversion is also real, and it takes a DIFFERENT ACL** — one that reaches the file as well
  as the directory. Round two's conclusion survives for those two shapes only, and it was stated for a shape
  that produces the opposite outcome.
- **None of the six read-denying shapes above stops the host at the constructor.**
  `Directory.CreateDirectory` on an existing but unreadable directory succeeded in every one. The
  constructor arm is real — it throws when the root must be
  **created** and the parent withholds `Write` — but that is a write-permission arm, so *"an ACL severe
  enough to fail `Directory.CreateDirectory` stops the host earlier still, never reaching row 36"* holds for
  no shape this entry is about.

🔴 **The harm was measured too, and the two seed-arm ACL shapes DO NOT AGREE — which is the third time in
this entry that one word covered two outcomes.** Running the seed arm's own two calls, `Save(floor)` then
`Delete()`, against a file that is present:

| The seed-arm shape | `Save(floor)` | `Delete()` | What is on disk afterwards |
|---|---|---|---|
| directory deny **propagated** | throws `FileNotFoundException` | **no-op** | the operator's file **survives**, beside an orphaned `fleet-settings.json.tmp-<guid>` |
| directory **and** file denied, not propagated | **ok** | **ok** | **the operator's file is GONE; the directory is empty** |
| a **malformed** file, nothing denied | ok | ok | **the operator's file is GONE; the directory is empty** |

**So this entry's original claim — *"the operator's file is deleted while the log says nothing was
deleted"* — is TRUE, on a shape it never named.** The withdrawal of it in round two was as over-general as
the claim had been. The propagating shape is self-limiting for a reason worth writing down: the deny is
inherited by the **temp file the atomic write creates**, so `File.Move` cannot resolve its own source. Where
the deny does not propagate, nothing protects the file — read rights were withheld, **write and delete
rights were not**, and neither `Save` nor `Delete` needs to read anything.

On the propagating shape the sentence *"Nothing an operator wrote was deleted — no settings file existed
before this start"* is **false in its premise and true in its effect**. On the other two it is **false
outright, and the operator's configuration is gone.**

**The likeliest vector is not an ACL at all: it is a MALFORMED file, which this entry never named.** It
yields null through the documented `JsonException` tolerance and lands on the same arm with nothing withheld
at all. **All three of the DELETIONS above are gated on the replay ALSO failing to activate** — the discard
block runs only under `!replaySucceeded && !replayRestoredAFile` — and the note at that block enumerates why
no env-var-only route reaches an activation throw today. So the deletion is **one contract away rather than
live**, and the contract is `_onLiveSettingsRebuilt`, which that site itself describes as an arbitrary host
callback.

🔴 **BUT THERE IS A SHAPE UNDERNEATH ALL THREE THAT IS GATED ON NOTHING, AND IT IS LIVE.** Everything above
asks what happens when the replay FAILS. Measured for the case where the replay **SUCCEEDS** — no discard
block, no callback, no log line of any kind:

| The shape | `Load()` | `Save(floor)` | On disk afterwards |
|---|---|---|---|
| a **malformed** file, nothing withheld | null | **ok** | the file is intact and now holds **the ENVIRONMENT FLOOR**. The operator's content is **gone** |
| both objects denied, not propagated | null | **ok** | same — **the ENVIRONMENT FLOOR** |
| directory deny **propagated** | null | throws | the operator's content survives (the temp file inherits the deny) |

**This is a silent overwrite on an ordinary successful start.** `FleetCore.UpdateSettings` performs its
`Save` in a `finally` inside `if (rebuildNeeded)`, so it is reached whether the activation throws **or
returns** — and on the seed arm the value being persisted is the environment floor merged with
`FleetHost`'s built-in defaults. Nothing logs it: the `Error` line belongs to a failed replay and the
`Warning` line belongs to the discard block, and on this path neither runs.

**Its one precondition, stated because a claim of live data loss must carry it.** `rebuildNeeded` is set
only when at least one of `serverUrl` / `verifyTls` / `machineCode` arrives non-null, and on the seed arm all
three come from the environment — `initialLiveVerifyTls` is a `bool?` that stays null unless
`ST4I_VERIFY_TLS` is set. **With none of the three variables set, nothing is written and the file survives.
With any one of them set, it is overwritten** — and those variables exist precisely for the headless
Windows-Service install that has no UI to type a triple into, which is WS-F1 fix F1's own stated reason.

*(Measured half: what a `Save` with no `Delete` leaves on disk when `Load()` returned null with a file
present. Read half, cited by symbol rather than executed: that the composition root reaches that `Save` on
the success path — the `finally` inside `if (rebuildNeeded)` in `FleetCore.UpdateSettings`, and the
`rebuildNeeded` assignment just above it. Driving that call for real would construct a `CredentialStore` and
a transport, which is how a probe reaches roots it has no business reaching.)*

**Severity ordering, which was the useful output for whoever took the decision:** the overwrite was
**live**; the three deletions were **one contract away**. All four were the same missing third state — *"a
file exists and could not be read"* — plus, for the malformed case, the fact that the tolerated-corrupt path
and the no-file path were the same `null`. **The owner was choosing a justification, not a design**: one
guard and one new state answers all four.

**The obvious guard would still have been a defect, for a narrower reason, and this is the paragraph Q-1
had to answer.** Wrapping the read so it yields null makes an unreadable file indistinguishable from *no*
file and moves the three throwing rows above onto the seed arm, where the environment floor is applied and
`UpdateSettings` persists unconditionally. So the fix could not be a `try`/`catch`. **What was missing was a
third state — "a file exists and could not be read"** — which neither the composition root nor
`FleetSettingsStore` expressed.

**Re-running any of this:** `dotnet run --project tools/settings-acl-probe`. It builds its own temp sandbox,
points the store at it through `FleetSettingsStore.EnvVarDir` — the same seam the composition root reads —
refuses every path outside that sandbox before issuing a syscall, and verifies each ACL back by SDDL
comparison. It never touches `%ProgramData%\ST4I`, and it proves the refusal rather than promising it.
🔴 **Its outcomes are still true of the STORE calls it drives** (`Save`, `Delete`, `File.Exists`, the ACL
shapes) — but its *derived* last column, "the arm that follows", is read off a composition root Q-1 has
changed, so read that column against §3.1a-now rather than against the tables above.

### 3.1a-now — what the code does after Q-1, and what that costs

**One read, three outcomes.** `FleetSettingsStore.Read()` returns `Loaded` / `Absent` / `Unreadable`.
`Load()` survives as `Read().Settings` — it answers *"is there a triple to apply"*, which is still a fair
question and still the only one its two callers ask, and it is documented as **not** the read anything may
branch a write on.

🔴 **The existence probe is gone, and that is the mechanism rather than a tidy-up.** `Read()` opens the
file and classifies what the open says. The only answers that mean *there is nothing here* are the
filesystem's own `FileNotFoundException` / `DirectoryNotFoundException`; everything else is `Unreadable`.
That is what closes the row above where **`File.Exists` answered `false` with the operator's file present** —
the seed arm was never selected by tolerating a failure, it was selected by asking a *second surface* a
question the read itself could answer, and two surfaces can disagree. The catch is of `Exception` rather
than of an enumerated list, deliberately: an enumeration is a closed claim about a set nobody controls, and
the cost of it being wrong is falling through to the one outcome that licenses an overwrite.

**What the composition root does on `Unreadable`:** it does not replay, so `FleetHost.UpdateSettings` is
never called, so the `finally` that persists is never reached; it does not enter the discard block, whose
condition is now `Status == Absent && !replaySucceeded` rather than `!replayRestoredAFile && …`; and it logs
at **`Error`**, naming the file, saying the file was not applied and was **not overwritten or deleted by
this start**, and saying the host is up.

**All four measured harms are answered by that one change, and the argument is checkable rather than
asserted.** The overwrite is answered directly: no replay, no `Save`. The three deletions are answered
because every one of them is gated on reaching the **seed arm**, and the seed arm is now selected only on
`Absent` — an outcome a present file cannot produce, because the read is an open attempt. The narrowing is
strictly one-directional (`Absent` implies the old `!replayRestoredAFile`, never the reverse), so no arm
that used to be excluded is now included.

**What it costs, stated rather than glossed.** A host with an unreadable settings file comes up on
`FleetHost`'s built-in defaults and does **not** apply the `ST4I_*` floor either — FF-1's precedence says
the file wins whenever there is one, and there is one; applying the floor would report a triple to the
operator that they never set. `GET /v1/settings` therefore reports the defaults, truthfully, as what this
process holds. That is the same honest divergence the failed-restore arm already carries.

🔴 **Where it is visible, and where it deliberately is not.** The boot line at `Error` reaches the console
and, under `AddWindowsService`, the Windows Event Log — the channel that matters for the headless install,
which is the deployment this defect destroyed data on and the one with no UI to retype a triple into.
**Nothing was added to `GET /v1/settings`**: that response is a published shape the browser client and
third-party callers read, and widening it is the class of change the owner reserved to himself in decisions
3 and 4. A field on the operating surface naming this condition is worth having and is a decision, not an
implementation detail — recorded here rather than taken.

**What witnesses it.** `FleetSettingsStoreTests` asserts the three outcomes at the store, with the
unreadable population asserted **member by member** (malformed, empty, legal-JSON-yielding-nothing, and a
`FileShare.None` handle) rather than through one example — the same "written from one member, stated about
the population" failure this entry records twice against its own earlier rounds. The end-to-end witness is
`StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`,
which boots the real composition root over a hand-malformed file with the env floor set and reads the bytes
back off disk. **It was run at `dd4a3e68` as well as after the fix**: at the base commit the file on disk
is the environment floor and the operator's bytes are gone; after it, the bytes are byte-for-byte intact.

**What it costs, second half, because the first statement of it was one-sided.** The `ST4I_*` floor is
**operator-supplied configuration too**, not a value the process invented, and this arm now declines to
apply it in memory as well as on disk. Both directions have to be said: for the FILE, refusing the floor is
strictly safer — applying it means `UpdateSettings` persists it, and persistence is the loss. For the
RUNNING MACHINE it can be worse — a headless install whose settings file has gone unreadable comes up on
`DefaultServerUrl = ""` / `DefaultMachineCode = "ENGINE-API-01"` rather than on the triple its service
definition supplies, so it is not merely un-federated, it is un-federated *and* not using the values the
deployment set. **The two only diverge because `UpdateSettings` persists unconditionally**; an
apply-without-persisting path would let this arm honour the floor in memory and still leave the file alone.
That is a change to `FleetCore.UpdateSettings`' contract, shared by `PUT /v1/settings`, and it is recorded
as **item 9 on `docs/owner-decisions.md`** rather than taken here. *(Fix round 2, review N5: this sentence
previously said "recorded as an owner decision" while that file recorded no such item — a cross-reference
that did not resolve. It was made true rather than deleted.)*

### 3.1b — the same defect at `site-link.json`, and it was WORSE (fixed by Q-1's fix round)

**Found by review of Q-1's own scope table, which had excluded it with a false reason.** `SiteLinkStore` is
documented as a deliberate copy of `FleetSettingsStore`'s shape, and it copied the defect with it:
`Load()` answered `null` for *no file* and for *a file that could not be read* alike.

**Why it was worse than row 36's, stated as a comparison because that is what the exclusion got wrong:**

| | `fleet-settings.json` (row 36) | `site-link.json` (row 18) |
|---|---|---|
| what the failed read selects | the env-floor **seed** arm | `new PersistedSiteLink()` — the default record |
| what writes | `FleetHost.UpdateSettings` → `Save` in a `finally` inside `if (rebuildNeeded)` | `SiteBridgeManager.ApplyAsync` → `_store.Save(link)`, **unconditional**, before the `Enabled` check |
| precondition | **one of three `ST4I_*` variables set** | **none** — `UnsOptions.Enabled` defaults `true` |
| what is lost | serverUrl / machineCode / verifyTls | Site broker **host**, **port**, and the pinned **trust anchor** |
| log line | none | none — `Save` *succeeded*, so the manager's `_logError` never fired |

**The fix, and it is narrower than row 36's.** `SiteLinkStore.Read()` is the same three-outcome read with
the same construction and the same reasoning (no existence probe; the open is the classifier). On
`Unreadable` the composition root simply **does not call `ApplyAsync`** — that call is the writer, and with
a default link it otherwise disposes no bridge, starts no bridge and sets `_current` to a value identical to
the field initializer it already holds, so **the only observable removed is the `Save`**. The device is
standalone either way; now it says so at `Error` and the file survives. Row 18's posture is **unchanged at
U ✓** — it always came up. What changed is that it no longer destroys the file on the way.

🔴 **ROW 18'S `U` IS A CONJUNCTION AND ONLY ONE HALF OF IT WAS EVER CHECKED HERE — CORRECTED BY TASK Z-1,
2026-08-18.** §1 defines **U** as *the host comes up **and** the failure is reported*. The comparison table
above records this row's log line as **"none"**, and that row is about the **pre-Q-1** tree, where `Save`
succeeded so nothing fired — but nothing on this page said so, and a reader checking row 18 against §1 finds
a published **U ✓** sitting three paragraphs from a published "none". Both halves, at HEAD, named by the
statement that supplies each:

- **comes up** — `Program.cs` wraps the eager apply in its own `try`/`catch`, and `ApplyAsync` never throws
  out of it in the first place.
- **and reports** — on the `Unreadable` arm the composition root does not call `ApplyAsync` at all and logs
  at **`Error`**, naming the file and saying it was not overwritten or deleted by this start. On the arms
  where the link IS applied, the manager's own `_logError` fires for a failed persist and for a bridge that
  could not be constructed.

So the ✓ holds, and it holds because of a statement in `Program.cs` rather than anything inside row 18's own
call. That is the kind of thing a conjunction hides when only its first half is examined.

🔨 **The route this entry NAMED AND DID NOT CLOSE is now closed — task Z-1, on owner decision item 8
(2026-08-18).** `SiteBridgeManager.ReapplyCurrentAsync` (reachable from `POST /v1/site/identity/rotate`)
reached the same unconditional `Save`, with `_current` — which on this arm is the default record the process
invented, not anything read from disk — so a rotation performed while the file was unreadable overwrote it.
It is operator-**initiated** but not operator-**chosen**, and that is the distinction the rule turns on.

**What changed, and it is a contract change rather than a guard, exactly as this entry predicted.**
`ApplyAsync` and `ReapplyCurrentAsync` now share a private body and differ by one thing: whether they
persist. `ApplyAsync` — the operator's `PUT /v1/site` and the startup path — still does.
`ReapplyCurrentAsync` does **not**, on **any** arm, because it establishes no value of its own: it re-applies
the link it is already holding, so it never holds the licence the law grants. The guarantee is therefore
structural rather than conditional, which is the difference between "the rotate path cannot write this file"
and "the rotate path checks something first". **Row 18 does not move**: the startup path's write timing is
untouched, and this closes a route that never ran at startup.

**What it costs, named because it is not free.** On a healthy tree `Current` is what was last applied and the
file already holds it, so the removed write was a no-op in content — with one exception: a rotation used to
RETRY a `Save` that had failed inside an earlier `ApplyAsync` (the one logged as *"active for this run only
and will NOT survive a restart"*), and could silently repair it. That retry is gone. It was never a
documented contract and nobody asked for a write at that moment, which is the whole defect class — but it is
a real behaviour this change removes.

**The other writer, censused rather than asserted (fix round 2, review N3).**
`SiteEndpointsTests.TheSiteLinkFileHasExactlyOneWriterInSrc_AndItIsApplyAsync` measures two populations
apart, because they fail differently: every file in `src/` that names `SiteLinkStore` (a writer must, to
obtain one) is swept for `.Save(` — **one site, `SiteBridgeManager.cs`** — and all of `src/` is swept for
the literal `site-link.json`, which is how a writer that bypasses the store would appear — **one site, the
store's own private `FileName` constant.** Its stated non-reach is the same one the settings census
carries: a writer that never spells the type, or a path composed from fragments. The `Error` message's
preservation claim rests on that census now instead of on inspection.

**What is still true and still not enforced by a test:** everything else in this file. Q-1 moved one row's
posture (36) and one row's data-safety (18).

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
the same way, and rows 7, 12, 24, 27, 32 and 33 all contradict it. Neither claim is rewritten: doing so would settle a rule this task is not
authorised to settle.
🔴 **That list read "7, 12, 24, 27, 32, 33 and 36" until task Q-1, and 36 left it because Q-1 made row 36
TRUE of the claim, not because the sentence was re-scoped.** An unreadable `fleet-settings.json` now does
disable only itself: the host comes up, says so, and every other source is unaffected. The remaining six were
re-checked one at a time rather than carried across — a list is an assertion about each member, so a member
leaving reopens the rest. The false-completeness finding is untouched: six contradictions still falsify
*"every other"*, and one fewer contradiction is not one step towards the claim being true.

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

### 3.6 — 🔴 The law for *"the artefact is present and this process cannot use its bytes"*, and the set it was checked against (task V-1)

**The owner's instruction was three words — *consolidate to one way*.** S-1 had measured three different
behaviours at one situation and item 5 of `docs/owner-decisions.md` offered three different repairs. This
section says what "one way" is, derives it from §1 rather than choosing it, and lists the members it was
checked against.

#### The law

> **A read of a persisted artefact must distinguish *there is nothing here* from *there is something here I
> could not use*. Only the first entitles any caller to establish a value of its own and persist it.**

**How it is derived, and it is §1's own test asked one statement earlier — not a second rule.** §1 offers
two outcomes and both are loud: **S**, the process ends, and **U**, the host comes up *and the failure is
reported*. A read that answers the same value for *absent* and for *present but unusable* can produce
neither. Nothing throws, so not **S**. Nothing distinguished the two cases, so there is nothing for anyone
to report, so not **U**. What it produces is **Q** — the host comes up and says nothing — which is §1's own
definition of the failure the rule exists to forbid. So the law is not a preference about store design; it
is what §1 already says, evaluated at the statement where the information still exists.

**The law yields DIFFERENT postures at different sites, and that is still one way.** A store that **throws**
and a store with a distinct third outcome are both **audible to their caller**; a store that answers
*absent* is not. Which of **S** and **U** the caller then reaches is decided by §1's existing test — *would
continuing hide the loss?* — applied to that site, unchanged. What the law removes is the third thing, which
is not a posture but the absence of one.

🔴 **A draft of that paragraph said "a store that throws hands its caller **S**", and it is FALSE on this
tree — corrected here rather than quietly.** **Row 9** is the refutation: `NotificationConfigStore`'s
constructor throws over a bad artefact (measured, and pinned in `ExpectedPostures`) and `Program.cs` wraps
that construction in a `try`, so the host **comes up** and the row is **U ✓**. Throwing is a property of the
STORE; **S** and **U** are properties of the CALLER. Collapsing the two is the same substitution §2 warns
about when it says instrument 2 supplies the outcome and instrument 1 supplies the posture — and it would
have been a sentence about a population this section cannot observe, since no arm of Reach C starts a host.

🔴 **Where the law is NOT enough on its own, said because a claim of sufficiency is the kind of sentence
this file exists to catch.** It decides *whether a read may conflate the two*. It does **not** decide
whether a given site should be **S** or **U** — §1 does that, and §1's own ✗ rows (§3.3, §3.4, §3.5) are
untouched by V-1. Two catalogues that end the process where §1 predicts they should come up are still
divergent, and still not fixed.

#### The membership rule, stated because the previous count had none

> **A store belongs in the posture set when it owns a persisted artefact this product WRITES and later
> RE-READS.**

That is the only shape at which conflating the two cases can cost anything: it needs a read to misclassify
**and** a write to act on the misclassification. It is stated here because S-1's set of nine had no stated
rule, so nothing could refute it — and applying a rule moved the membership. Provenance is **not** the
membership rule; five product-generated stores were outside S-1's table for a reason never written down, and
four of the five turn out to be compliant, which is information the published table did not carry.

🔴 **THE INSTRUMENT IS NARROWER THAN THE RULE, AND ONE MEMBER OF THE TABLE IS THE PROOF (fix round, review
I-4).** The rule quantifies over *stores that own a persisted artefact*; the instrument sweeps only files
the two enumerations classify, and both enumerations look for **removal-capable** shapes. `SecurityDb` owns
`security.db` and its schema ladder, performs **no removal of its own**, and therefore appears in **neither**
enumeration — it is a row in the posture table **because a human noticed**, which the census's own comment
says in as many words. So a second `SecurityDb`-shaped store — one that owns an artefact and writes it with
a shape outside the nine — **would be invisible to the rule that replaced "nine".** The membership set is
complete **over the enumerations**, not **under the rule**, and the difference is exactly the size of that
blind spot.

**And the partition, stated as the code partitions it rather than as prose summarised it.** The first
statement of this — *"14 + 1 + 3"* — was wrong twice: it counted `CredentialStore` both as one of the three
exclusions and as the store measured apart, and it silently absorbed `SecurityDb`. What the assertions
actually partition:

> **23 enumerated files = 7 `NotAStore` + 16 store-classified**, and **16 = 13 with a posture row + 3
> excluded with a stated reason**. The posture table has **14** rows: those 13 **plus `SecurityDb`**, which
> is in neither enumeration. `CredentialStore` is one of the 3, and it is the one measured apart — the same
> file, not two.

Every number in that block is asserted by `EveryArtifactOwningStore_HasARow_AndTheOnesOutsideAreNamed` and
`EveryEnumeratedRemovalSite_IsClassified_AndEveryMeasuredStoreIsAccountedFor`; it is written out here
because the sentence it replaces was a scalar summarising a set the code partitions differently, which is
the fifth withdrawal on this branch for that shape.

#### The set, measured

The instrument is S-1's, extended: `OperatorDataRemovalCensusTests`, Reach C, one corrupt artefact per store
built in the test run's own temp root. **No total is offered — the list is the artefact**, and every entry
below is pinned by `ExpectedPostures` and asserted by
`EveryOperatorArtifact_HasThePostureRecordedForIt_AtTheOneSituationHeldFixed`.

| Posture | Store | Reason the law yields this one HERE |
|---|---|---|
| **third outcome** | `FleetSettingsStore`, `SiteLinkStore`, `OeeSettingsStore` | the arm a failed read selects **WRITES**. The caller must be able to decline it, and it can then name the loss and keep serving. Throwing instead would end a host, or an endpoint, over a file that is repairable by hand |
| **throws** | `MachineConfigStore`, `ProductConfigStore`, `SimulatedEcosystem`, `ConnectorConfigStore`, `NotificationConfigStore`, `SecurityDb`, `AlarmStore`, `AssetRegistryStore`, `BridgeSpool`, `SqliteHistorianStore` | the read ends the operation, so no arm downstream of it can write. Nothing is destroyed — measured, not read: `TheThrowingStores_ConstructCleanlyOverAnEmptyDirectory_AndLeaveTheUnreadableBytesIntact` reads the bytes back after the throw. **What the caller does with the throw varies and is §1's business, not this column's** — `ConnectorConfigStore` is unguarded (row 24, **S**) and `NotificationConfigStore` is wrapped (row 9, **U**) |
| 🔴 **Q — cannot tell** | `DeviceIdentityStore`, `CredentialStore` | **decided exceptions, not survivors.** See below |

**What moved, and it is one row.** `OeeSettingsStore` was the third-outcome shape's last missing member: its
`Load` caught `JsonException` and started from an empty store, and `Set` — its only mutator, with exactly one
production caller — then wrote that empty state over the file. It now has the same three-outcome `Read` as
Q-1's two, `Set` refuses while the file is unreadable, `PUT /v1/historian/oee/settings` answers **409**
naming the file, and the store reports once at `Error` through a callback `Program.cs` wires.
**It is not a row in the table above in §3.1** — this store is resolved lazily from DI and nothing constructs
it before the host serves, so it is not a startup-path decision and never was.

🔴 **WHEN the refusal is decided, because V-1's FIRST ROUND closed the wrong moment and said nothing about
it (fix round, review I-3).** Round one gated the refusal on a classification the **constructor** had
cached, so what shipped was *"the file was unreadable when this store was built"*. A host running on a good
file, an operator hand-editing that file into invalid JSON — the very repair the refusal message asks for —
and one `PUT` afterwards still overwrote the operator's bytes **silently**: no throw, no 409, no log line.
Same harm, same store, same mutator, one moment later. **No instrument in the tree could see it**, and the
reason is worth keeping: Reach C only ever constructs a store over an *already-corrupt* directory, so the
whole census is blind to corruption that arrives after construction.

`Set` now takes **its own read, under the same lock, immediately before it writes**, so the guarantee is
about the file at the moment of the write. Re-reading alone would have opened a second hole and the fix
carries the guard for it: a file that was unreadable at load and has since been **repaired** reads `Loaded`
while the in-memory table is still **empty**, so writing it would discard the repair — that arm keeps
refusing, and `Reload` is the way out.

🔴 **What V-1 did not reach — and the first statement of that paragraph NAMED THE CEILING TOO SMALL, which
was the second time that had happened in this section (review N-1).** It said the residue was a **lost
update**: a writer slipping between the read and the write. That is a real but narrower thing, and it did
not cover what was actually left. The refusal compares two facts and they can disagree **three** ways. V-1
refused two. The third:

> `_tableBuiltFrom == Absent` **and** `fresh.Status == Loaded` — the store came up with **no file**, a file
> has appeared since **with content**, the read immediately before the write **sees it**, and the write
> proceeds: the empty table plus one machine, over a file just read successfully. No throw, no `409`, no log
> line.

**It needs no concurrency.** The trigger is restoring a backup into `%ProgramData%\ST4I\sim\historian` on a
running host — the workflow that directory is advertised for on the store's own `directory` parameter. **A
ceiling named too small is worth less than no ceiling, because it reads as a sweep**, and that is the whole
reason this section exists.

🔨 **REFUSED SINCE TASK Z-1 (owner decision item 11, 2026-08-18).** `Set` raises
`OeeSettingsFileAppearedException` on exactly that pair, `PUT /v1/historian/oee/settings` answers **409**,
and `Reload` (in production, a restart) is the way out. The store now has **two** refusal types over a shared
base, `OeeSettingsWriteRefusedException`, which the endpoint catches; a second arm was needed rather than a
wider message because on this one **the file reads perfectly**, and a published type named *Unreadable*
saying otherwise is a name asserting something false. **First boot is kept by the second fact rather than by
an exemption**: a clean start leaves the fresh read `Absent` too, so the pair does not match and the write
proceeds.

🔴 **AND THE CEILING NOW, STATED AT ITS FULL SIZE BECAUSE THIS SECTION HAS BEEN CORRECTED TWICE FOR STATING
ONE TOO SMALL.** The decided predicate closes the restore that lands on a host which came up with **no
file**. Two pairs still write, and the first of them is **the same operator action**:

> `_tableBuiltFrom == Loaded` **and** `fresh.Status == Loaded`, **with the two readings of different
> content**. A host comes up on a good file, an operator restores a backup over it, both facts still read
> `Loaded`, and the next `Set` writes the pre-restore table over the restored file. Nothing in the store
> records WHICH bytes the table was built from — only the outcome of that read — so it cannot tell the two
> apart. This is the more ordinary shape of a restore, not the rarer one: a host that has ever had OEE
> settings has a file.

> `_tableBuiltFrom == Loaded` **and** `fresh.Status == Absent` — the file was removed after the load, and
> `Set` re-creates it from the table. Nothing this process read is discarded; what is discarded is the
> removal, if it was deliberate.

Closing either needs a fact this store does not keep, and keeping it changes *when a write is licensed* a
second time — so it is **named, not taken**. The first is pinned LIVE by
`OeeSettingsStoreTests.Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling`,
the way S-1 pinned item 5's defect as a baseline: if a later task closes it, that assertion inverts and the
inversion is the diff. **It is not on the owner's list**, because item 11 is now closed and nobody has been
asked about this one.

#### The two exceptions, and what each one costs

- **`DeviceIdentityStore.TryLoad`** — decided in `docs/owner-decisions.md` item 1's residue 2, before V-1:
  the bytes are a product-minted key, the store DOES report at `Error` and says it will regenerate, and the
  correct repair is to keep the old blob under another name, which is a data **MOVE**. It is now measured
  rather than declared, which is the change: it sits in the pinned posture table, so the exception cannot
  quietly become the rule.
- **`CredentialStore.Load`** — measured by V-1 and booked as item 10. Two facts that were not previously
  written down together: the null it returns for an unusable blob is presented in its own doc comment as a
  *benign* outcome, and the re-claim path it exists to enable calls `Save`, which overwrites. A blob sealed
  under the wrong DPAPI scope or copied from another machine is **readable again once the environment is
  repaired** — while it still exists. That is a recoverable environment fault converted into an
  unrecoverable loss, and the repair is again a data **MOVE**.
  🔨 **The MOVE is now performed — task Z-1, on the owner's decision of 2026-08-18.** `Save` classifies what
  is already at the path in three outcomes and, on *present and this process cannot use it*, renames the old
  blob to `<machine code>.bin.unreadable-<UTC stamp>` beside the live one before writing. The re-claim still
  succeeds; the bytes survive. 🔴 **The `Q` posture is UNCHANGED and that is the decided outcome, not an
  omission**: the owner chose keep-aside over the other repair item 10 named (making `Load` throw), so the
  read still conflates the two cases and this store still needs its exception. What is closed is the
  CONSEQUENCE, not the conflation.

🔴 **Both exceptions had the same repair, V-1 was forbidden to perform it, and the owner has since granted
it at ONE of them.** V-1's brief required that moving operator data in the product be stopped and reported
rather than done, and several tasks stopped on exactly that rule. Item 10 is now executed.
**`DeviceIdentityStore` is NOT exempted by that decision** — item 1's residue 2 stands untouched, and reading
one item's exemption as a general licence is how a constraint dies: not repealed, generalised.

#### What this set does NOT reach

- **`CredentialStore` is measured APART, and the reason is mechanical rather than a judgement.** `Load` is
  static and resolves the process-wide `ST4I_CREDS_DIR` per call with no directory parameter, so it cannot
  join a parallel table whose every other member takes an explicit directory without flipping a global — the
  same "environment-dependent is not measured" ceiling §2 states for instrument 2. S-1 excluded it for a
  *provenance* reason instead, and that reason is arguable: one `CredentialStore.Save` call site is an
  operator pasting an `mk_` key.
- **One situation only**, as S-1 stated: present-and-unparseable. A deny-share lock, a Windows ACL and a full
  volume are not this situation; §3.1a paid for that conflation twice.
- **The `Throws` posture is still not measured where it LANDS.** Whether a `SqliteException` from a
  constructor ends the process or is caught somewhere is a composition-root question, and no arm of Reach C
  starts `St4i.EngineApi` — the same ceiling instrument 2 declares in §2. The **S** column of the table above
  is therefore read off §3.1 for the rows that appear there, and is not observed for the stores that do not.

#### Two other writes S-1 found at these stores, decided one at a time

- **`ProductConfigStore.Load` rewrote `products.json` when only `recipes.json` was missing** — 🔨 **FIXED.**
  Measured on the shape that shows it: with a hand-written `products.json` present and `recipes.json` absent,
  merely constructing the store rewrote `products.json`, reserialised out of the typed model, so an
  operator's own formatting and any field `ProductModel` does not declare were gone — on a start where
  nothing failed and nobody asked for a change. The seed-persist branch now writes only the file it seeded.
  The mutators still write both, deliberately: there the caller asked for a change. Witness:
  `SeedingTheRecipesFile_DoesNotRewriteAHandWrittenProductsFile`, which pins the fix **and** that the
  missing file is still seeded.
- **`ConnectorConfigStore` migration v4 runs a hard-coded `DROP TABLE connector_configs` at startup** —
  ✅ **NO CHANGE, and the reason is an assertion rather than a reading.** It is rung 4 of the
  `PRAGMA user_version` ladder, gated on the stored version, running inside the ladder's single transaction,
  in the create/copy/drop/rename order SQLite's own documentation prescribes for changing a PRIMARY KEY,
  with the `SELECT` list spelled column by column so a positional `SELECT *` cannot silently misalign. That
  the rows survive it is not asserted here: it is asserted by
  `ConnectorConfigStoreTests.MigrationV4_AGenuineVersion3Database_KeepsEveryRow_EveryField_AndGivesEachOneItsKindAsItsInstanceId`,
  which builds a genuine v3 database with raw SQL rather than re-opening one this build wrote.

#### One claim of S-1's that V-1 refutes

S-1's headline assertion was **`classes.Count > 1`** — *the postures diverge* — with the message that item 5
would CLOSE on every store reaching one posture. **That is the wrong guard for the answer.** Under the law
above, a tree where every store threw would be fully compliant and that assertion would be **red**; a tree
where one store quietly conflated the two cases is non-compliant and it would be **green**. It has been
replaced by `NoStoreAnswersAbsentForAnArtifactThatIsPresent_ExceptTheOnesNamedAndDecided`, which reddens in
both directions: a store falling onto **Q**, and a *named exception* leaving **Q** while the decision that
excused it still stands.

🔴 **And the narrower claim is the true one, said here because the paragraph above could be read as a wider
one.** This is not "S-1 had no guard". Its per-store pin
`EveryOperatorArtifact_HasThePostureRecordedForIt_AtTheOneSituationHeldFixed` reddens whenever ANY store's
posture moves, it did so on this very task's diff, and it is untouched. What that pin cannot do is say
whether a move is **compliant** — it only says the table is stale. The replaced assertion was the one that
claimed to answer that, and it answered a different question.

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
| ~~**Still unsettled** — row 40~~ | 🔴 **Run, by M-1's probe.** The predicted **U** was correct. ~~the number of rows produced by an instrument that executes is now **two**~~ — **that scalar is withdrawn** (task Q-1, fix round 2). Instrument 2's reach is enumerable at **{36, 40}**; instrument 3's is not enumerable from this file, and **at least five rows — 18, 36, 37, 38, 40 — are backed by an execution, with no total offered.** The derivation is in the header; read it there rather than trusting a number here. |
| 🔴 **Where the two instruments disagree — §3.1a** (M-1) | The read produced two **opposite** statements in successive rounds and the execution refutes both, because each described one member and was written about the population. This is the disagreement §8.1 asks for, and it is the only place this file has one. |

**A number this list previously stated and which is now withdrawn: "thirteen of them are roots."** It is
refuted by README §15.9's own two tables without any re-derivation — that section's thirteen machine-wide
roots include `creds` and `opcua-pki`, which the outcome table itself declares to have *no startup decision*,
while `machine-config` is a member here and is **not** one of the thirteen (it defaults beside the binary,
which is why `PerHostDataRootsTests` puts it in population two). A summary contradicting the list it
summarises, in the artefact written to end an ambiguity. **No replacement scalar is offered. Count the rows.**
