# Giai đoạn 2 — Xương sống middleware & sẵn sàng kết nối (SYNAPSE-connect) — Blueprint

> Large phase (≈ GĐ1). "UNS cục bộ = xương sống; ST4I + SYNAPSE = 2 bridge." Code-grounded by code-architect. Branch feat/machine-simulator (GĐ1+FF @ 338f01ff). NEEDS user scoping decisions before execute.

## Key code-grounded findings
- **MQTTnet + MQTTnet.Server 5.2.0.1603 already referenced** (St4i.EdgeCore.csproj:12-13); `Drivers/Mqtt/InProcessBroker.cs` is a test-only loopback shim → **embedded UNS broker = ZERO new NuGet**, evolve InProcessBroker.
- **`mapping/*.json` per-class profiles are DEAD** — `MappingProfile.FromJson` implemented + tested (PackagingFleetJsonTests.cs:85) but NEVER called from a production root; FleetHost.StartLocked:423 hardcodes one "fleet-mixed" profile → activating them is a surgical **quick win**.
- **One EdgePipeline for the WHOLE fleet** (FleetHost.cs:414-424) → one flaky real PLC would kill every machine's pipeline. **Per-driver-pipeline fault-isolation refactor is a load-bearing PREREQUISITE before any real OT driver** (T1-R6).
- **`FleetHost.EstopEngaged` is a SOFTWARE latch, NOT a safety device.** Nothing models an independent SafetyState. `getSafetyStatus` must be **read-only, no write path** (XC-R40 hard boundary — enforce in review).
- Ack timing: `AckSuccess/Duplicate/Queued` on MachineState + every HistorianRecord derive from the SYNCHRONOUS ST4I ack (FleetHost.cs:526-530, HistorianModels.cs:63-65) → converting ST4I to an async UNS subscriber (B2) requires an ack-timing/historian-semantics redesign → **defer B2**.
- OPC-UA license signals CONFLICTING (RCL/GPLv2 vs MIT for OPCFoundation.NetStandard.Opc.Ua.*) — **gate behind a licensing spike**. SparkplugNet depends on MQTTnet v4 (repo pins v5, breaking) → **hand-roll a minimal Sparkplug protobuf encoder** via Google.Protobuf runtime (no protoc build step).
- Reuse idioms: optional-trailing-`null` ctor param (additive, keeps ~360 tests green); HistorianWriter bounded-channel-never-throws (for UnsPublisher/alarm sink); WalOptions %ProgramData%\ST4I\sim\<leaf> + EnsureDir; SqliteAuditStore single-writer-lock; CredentialStore DPAPI+SecurityDirAcl (device identity).

## WS-B — UNS spine (the pivot): dual-topic "one spine, two bridges"
Sparkplug's topic ns is spec-fixed → publish TWO families from one `UnsPublisher`: (1) Sparkplug wire `spBv1.0/{site}.{area}.{line}/NBIRTH|DBIRTH|NDATA|DDATA|.../{cell}[/{equipment}]`; (2) semantic mirror `syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}` (retained JSON = CanonicalEnvelope + schemaVersion/seq/sourceTs; aspect from ReadingKind result/telemetry/inspection). New `src/St4i.EdgeCore/Uns/{UnsOptions,UnsTopicBuilder,UnsBroker,UnsPublisher, Sparkplug/{SparkplugPayload,SeqTracker,AliasTable}}.cs`.
- **B0 (first slice, additive, ~0 risk):** EdgePipeline gets optional `IUnsPublisher? uns=null`; after Normalize, `uns?.PublishReadingAsync(...)` (non-blocking channel). _transport.SendAsync + Committed UNCHANGED. Satisfies "every reading on UNS".
- **B1:** NBIRTH/NDEATH at FleetHost Start/Stop/Estop (same guarded operator-transition sites as historian run-events).
- **B2 (DEFER — high risk):** move ST4I send + historian feed to UNS subscribers (St4iBridge/HistorianUnsBridge) → the ack-timing redesign. Bundle with GĐ3 join.

## WS-J — Canonical model + Asset Registry
6 entities: Asset (MachineDescriptor+roster, needs URN+lifecycle+persist), Tag (MappingProfile, needs sourceAddress/deadband/quality), Telemetry (ok), Event (HistorianRunEvent, ok), Health (DriverHealthState, needs persist+endpoint), Command/Ack (TransportAck ST4I-shaped, need UNS-native), **SafetyState (NOTHING — net-new, read-only)**. New `AssetRegistry/{AssetRecord,AssetLifecycleState,IsaUrnBuilder,AssetRegistryStore}.cs` (SQLite, %ProgramData%\ST4I\sim\assets, URN `urn:isa95:{site}:{area}:{line}:{cell}:{equipment}`, lifecycle Provisioned→Commissioning→Active→Maintenance→Decommissioned, drift via existing ConfigChecksum). RegisterMachine should UpsertAsync (survive restart). Endpoints + web/routes/AssetRegistry.tsx.

## WS-H — Adapter SDK + protocols
Extend IDeviceDriver via default-interface no-ops: Connect/Disconnect/Describe/ExecuteCommand(Policy-gated)/GetSafetyStatus(RO)/Drain. **Per-driver-pipeline refactor FIRST (fault isolation).** Mapping-activation quick win (FromJson + ForClass fallback). Modbus TCP via **NModbus (MIT)** first. OPC-UA **gated behind licensing spike**. Serial via System.IO.Ports (in-box).

## WS-G — Policy + Line Controller + Alarm (safety-critical)
**XC-R40 in bold: EstopEngaged = software latch not safety device; getSafetyStatus read-only, no write path — enforce in review.** Thin C# Policy engine (`Policy/{PolicyDecision(Permit/Deny+ReasonCode: NOT_READY/SAFETY_BLOCKED/POLICY_DENIED/INVALID_ARGS/UNSUPPORTED/BUSY),IPolicyRule,PolicyEngine}.cs`), default-deny, sits INSIDE the RBAC+audit boundary (one extra check+audit per mutating endpoint). Rules: EstopGuard (promote silent no-op→audited SAFETY_BLOCKED), RoleObligation (evaluatable, "no back-door" for future UNS NCMD), RecipeLock (P1). LineController PackML SM (IDLE→READY→PRODUCING⇄HELD→...). AlarmEngine ISA-18.2 (priority+runbook, sources: Policy DENYs, NG-rate presets, DriverHealth) + AlarmStore + AlarmCenter.tsx.

## WS-D-field — device identity
X.509 device identity via CredentialStore idiom (DPAPI LocalMachine + SecurityDirAcl, %ProgramData%\ST4I\sim\identity, zero new crypto dep). Local P0 only; EST/SCEP + Site CA = GĐ3.

## Sequenced 11-task plan (size/risk)
1. WS-H mapping-activation quick win (S/Low, no deps) 2. WS-B B0 UNS publish (M/Low) 3. WS-B B1 Birth/Death (S/Low) 4. WS-J asset registry (M/Low-Med) 5. WS-G Policy core Estop/Role (S-M/Low) 6. WS-H per-driver-pipeline refactor (M/Med, MUST precede #7) 7. WS-H Modbus (M/Med) 8. WS-G LineController+Alarm (M/Low-Med) 9. WS-D-field identity (S-M/Low) 10. WS-H OPC-UA (L/HIGH — licensing spike first) 11. WS-B B2 bridge-inversion (L/HIGH — defer, bundle GĐ3).

## RECOMMENDED first pass: #1 mapping-quick-win + #2/#3 WS-B B0+B1 + #5 WS-G Policy-core + #6 per-driver-refactor → UNS spine + guardrail + fault-isolated drivers, small reviewable diff. Defer Modbus/OPC-UA/LineController-Alarm/identity/B2 to a 2nd GĐ2 pass or GĐ3.

## DECISIONS LOCKED (27/07/2026)
1. Broker = **MQTTnet.Server** (evolve InProcessBroker, loopback-only, 0 new dep). ✅
2. Sparkplug codec = **hand-roll minimal protobuf** via Google.Protobuf runtime (no protoc; avoids SparkplugNet↔MQTTnet-v5 conflict). ✅
3. Protocols = **Modbus-first (NModbus, MIT)**, NO real hardware yet → test via loopback/sim Modbus server; OPC-UA deferred behind a licensing spike. ✅
4. Policy depth = **thin C# rule engine** (not OPA). ✅
5. **B2 (bridge-inversion) + mDNS/join wizard DEFERRED to GĐ3.** ✅
6. Footprint OK: MQTTnet.Server (loopback) + **Asset+Alarm consolidated into ONE SQLite file**. ✅
7. First-pass scope = **6 tasks**: G2-1 mapping-quick-win + G2-2 UNS-B0 + G2-3 UNS-B1 + G2-4 Policy-core + G2-5 per-driver fault-isolation refactor + G2-6 Modbus TCP (NModbus, loopback test). ✅

## FIRST-PASS EXECUTION ORDER (deps)
G2-1 (mapping, indep) → G2-2 (UNS B0: UnsBroker/UnsOptions/UnsTopicBuilder + hand-rolled Sparkplug codec + UnsPublisher + EdgePipeline optional publish) → G2-3 (B1 Birth/Death at Start/Stop/Estop) → G2-4 (Policy-core: PolicyEngine default-deny + EstopGuard/RoleObligation + reason codes + XC-R40 safety-boundary formalization, wired into mutating endpoints) → G2-5 (per-driver-pipeline fault-isolation refactor — MUST precede G2-6) → G2-6 (Modbus TCP via NModbus + a minimal register→canonical tag map extension to MappingProfile; loopback/sim Modbus server test). Deferred (2nd pass / GĐ3): WS-J full asset registry, OPC-UA (license spike), LineController+Alarm UI, WS-D-field identity, B2, join/mDNS.
