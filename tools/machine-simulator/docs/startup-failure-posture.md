# Startup failure posture — the rule, and the enumerated set it was checked against

**Owner:** task J-3 (`.superpowers/sdd/startup-failure-posture/`), discharging the item booked at
`FleetCore`'s P5; §2 ceiling 3 and §3.1a re-measured by task M-1
(`.superpowers/sdd/settings-acl-probe/`); **row 36 CHANGED — not merely re-measured — by task Q-1**
(`.superpowers/sdd/third-state-unreadable/`), executing the owner's decision 1 of 2026-08-16.
**Status:** descriptive — this records what the product does, and names where it does something else.

🔴 **Two claims in this paragraph's earlier version are now false, and they are corrected rather than
quietly dropped.** *"Nothing here is enforced by a test"* — **row 36 now is**, by the two suites named at the
end of §3.1a-now, which is the only row of the forty-one that any assertion is indexed on. And *"two rows —
and only two — are backed by something that runs"* named `tools/settings-acl-probe`; the count of rows
backed by an execution is now **three**, by **two** instruments that run. Every other row is still a read.

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

🔴 **Instrument 3 — the five test suites, added by task Q-1, and its reach is ONE row.** Row 36 is the only
member of this set that any assertion is indexed on: `FleetSettingsStoreTests` at the store and
`StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`
through the real composition root, the latter being the one that observes **U** rather than deriving it — it
boots `St4i.EngineApi` and issues a request, which is precisely the thing instrument 2 states it never does.
That is one row of forty-one. **Forty are still a read**, and the reason the suites cannot simply be pointed
at the rest is instrument 2's own: several of these rows can only be provoked by making something on disk
unreadable, and a suite that has to skip when it cannot is a suite whose `Skipped` count is
environment-dependent.

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
| 36 | `settingsStore.Read()` | `fleet-settings.json` | no | **U** — *fixed by Q-1, see §3.1a* | ✓ |
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

**What is still true and still not enforced by a test:** everything else in this file. Q-1 moved one row.

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
