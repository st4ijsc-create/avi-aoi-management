# Giai đoạn 3 — Sub-project 3: OPC-UA driver — Blueprint/Spec

> APPROVED (brainstorming + licensing spike, 27/07/2026). Branch feat/machine-simulator (GĐ3 mDNS @ 59cf2ffe). Mirrors the Modbus path (G2-6 driver+slot → P2-3 roster visibility) — same `IDeviceDriver` seam + G2-5 per-slot fault isolation.

## Licensing spike result (the roadmap gate) — BLOCKER REMOVED
`OPCFoundation.NetStandard.Opc.Ua.Client` was **relicensed GPLv2/RCL → MIT on 2025-12-04** (verified: repo LICENSE.txt, source headers, current nuspec, relicense commit + OPC Foundation issue tracker). Current `1.5.378.156` is MIT with native **net10.0** support. A closed-source commercial product may ship it with no copyleft/membership/fee. **Decision: proceed with the OPC Foundation MIT stack, PIN the exact version** (never float below the Dec-2025 relicense). Fallback (documented): `nauful-LibUA-core` (Apache-2.0) if legal ever rejects the stack.

## Goal
Read tags from an OPC-UA server (PLC) via an OPC-UA CLIENT, run it as an isolated FleetHost pipeline slot, and make the OPC-UA machine a first-class UI-visible roster member. Additive + env-gated OFF by default (no real hardware yet → loopback OPC-UA server test).

## Locked decisions
1. **Lib = `OPCFoundation.NetStandard.Opc.Ua.Client` (MIT, pin `1.5.378.156`, net10.0).** ONE new NuGet (+ its OPC Foundation transitives, all MIT). Fallback LibUA (Apache-2.0) only if the stack is intractable on net10.
2. **Client-only** (read/subscribe tags); no OPC-UA server hosting in production (a minimal in-process server is TEST-only, for the loopback proof).
3. **MVP security = SecurityMode None + anonymous** (loopback test), with optional username/password auth via config. **Cert-based app auth** (Basic256Sha256 + trusted app-instance certificates) = DEFERRED follow-up. Telemetry readings carry `Verdict.Skip` (the Modbus-KPI lesson — never inflate FPY).
4. **Full scope** = driver + isolated slot (OU-1) + roster/Snapshot/web visibility (OU-2), mirroring Modbus G2-6 + P2-3.

## Tasks
### OU-1 — OPC-UA driver + node map + isolated slot (G2-6 parity)
- **DE-RISK GATE FIRST:** add the NuGet + prove a loopback OPC-UA session works on net10.0-windows (stand up a minimal in-process OPC Foundation server with a couple of variable nodes, connect a client session, read a value). OPC-UA client/server config (ApplicationConfiguration, auto-generated app-instance cert, endpoint selection, SecurityMode None) is fiddlier than Modbus — get the loopback round-trip green BEFORE building the driver. If the stack is intractable on net10, STOP + report BLOCKED (consider the LibUA fallback).
- `src/St4i.EdgeCore/Drivers/OpcUa/OpcUaDriver.cs` (`: IDeviceDriver`): non-blocking ctor (background connect, like `ModbusTcpDriver`/`MqttDriver`); `Kind => DriverKind.OpcUa`; Health Down→Connected→Degraded. **Poll** the configured node ids on `PollIntervalMs` (a `Session.Read` of the node set each interval — simpler + deterministic than subscriptions for MVP; note subscriptions as a follow-up), map each node's value → `TelemetrySample(metric, value, unit)`, yield ONE `DeviceReading { Kind = ReadingKind.Telemetry, Verdict = Verdict.Skip, MachineCode = map.MachineCode, Telemetry = samples, Timestamp = now }` per poll. Resilient (reconnect on session fault; a poll error → Degraded + reconnect, does NOT throw out of ReadAsync — `yield` OUTSIDE try/catch). Clean idempotent `DisposeAsync` (close session, dispose). Values: cover the common OPC-UA scalar types you emit (Bool/Int/UInt/Float/Double/String) → boxed into the telemetry value; document what's covered.
- `OpcUa/OpcUaNodeMap.cs`: `{ MachineCode, EndpointUrl (opc.tcp://…), SecurityMode (default "None"), Auth {anonymous | username/password}, PollIntervalMs, Nodes[{ NodeId (e.g. "ns=2;s=Temperature"), Metric, Unit? }] }` + `FromJson`. Validate non-blank MachineCode/EndpointUrl + non-empty Nodes (fail in FromJson → the Program.cs try/catch disables OPC-UA for the run, same as Modbus).
- `OpcUa/OpcUaOptions.cs`: `FromEnvironment()` — `ST4I_OPCUA_ENABLED` (default **false**), `ST4I_OPCUA_ENDPOINT`, `ST4I_OPCUA_MAP` (node-map JSON path). Mirror `ModbusOptions`.
- `OpcUa/OpcUaDriverFactory.cs`: builds a fresh driver per FleetHost.StartLocked (a session per (re)start).
- FleetHost slot: add `DriverKind.OpcUa` to the enum; wire an OPC-UA slot in `StartLocked`'s `groups` when the factory is present (like the Modbus slot); Program.cs env-gated factory registration (like the Modbus block). Default-off ⇒ byte-identical.
- Tests: loopback OPC-UA server (in-process) + driver round-trip (dynamic port, bounded polling, Verdict.Skip asserted); node-map FromJson unit; health-on-fault; the driver runs as an isolated slot (reuse the FleetHost multi-slot fault-isolation harness). If the in-process OPC-UA server proves too heavy/flaky in the sandbox, document + fall back to a thinner proof (but the loopback session de-risk gate must be met at least once).

### OU-2 — OPC-UA roster/Snapshot/web visibility (P2-3 parity)
- `FleetHost.StartLocked`: exclude `DriverKind.OpcUa` from the simulated `effectiveFleet` (like Modbus — not double-driven); `Program.cs` seed an OPC-UA `MachineDescriptor` (Code = map.MachineCode, DriverKind.OpcUa, DeviceClass.Automation, MachineType "OPC_UA", CycleSeconds ≈ pollMs/1000) via `RegisterMachine` after FleetHost resolves + map loads (hoisted, like Modbus P2-3) → tile + historian + auto-asset.
- Web: add `"OpcUa"` to the `DriverKind` union (`api.ts`) + `KNOWN_DRIVER_KINDS` + `driverKind.OpcUa` i18n (vi+en, e.g. "OPC-UA").
- README §: document `ST4I_OPCUA_*` + the node-map JSON + OPC-UA as a delivered driver (MIT stack) — and update the §12 roadmap (OPC-UA no longer "licensing-spike-gated future").
- Tests: OPC-UA machine appears in Snapshot with a MachineState, NOT double-simulated (like Modbus); web build clean.

## Global constraints
.NET/C# (backend) + React/i18n (web). ONE new NuGet (`OPCFoundation.NetStandard.Opc.Ua.Client`, MIT, pinned exact). Do NOT edit the shared SDK. Additive + default-off (OPC-UA disabled ⇒ byte-identical). Reuse the Modbus/G2-5/Map*Endpoints idioms. TDD; per-task review (OU-1 loopback de-risk first); full `St4i.EdgeCore.Tests` + `St4i.EngineApi.Tests` green + web build clean; deterministic tests. Commit `feat(opcua):` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Deferred
OPC-UA subscriptions (vs poll); cert-based app auth (Basic256Sha256 + trusted certs); complex/structured-type decoding; browsing the server address space; the other GĐ3 sub-projects (LineController+Alarm). LibUA fallback (only if the OPC Foundation stack is rejected).
