# WS-B B2 (bridge inversion) — assessment & recommendation

> Promised "report before diving in." Assessed after pass-2 (P2-1..P2-3) landed clean. TL;DR: **B2 is inherently a replacement of the synchronous ST4I/historian drive path with an async UNS-subscriber path, forcing an ack-timing/historian-semantics redesign that ripples across ~34 files (incl. the WPF app). Recommend DEFER to a dedicated GĐ3 pass bundled with the join/ecosystem work — as the original blueprint already decided.**

## What B2 is
Today (post-GĐ2): the UNS spine is an **additive mirror**. `EdgePipeline.RunAsync` per reading does: normalize → `uns?.PublishReading(...)` (non-blocking) → **`ack = await _transport.SendAsync(env)` (synchronous ST4I ack)** → `Committed?.Invoke(reading, ack)`. `FleetHost.OnPipelineCommitted` threads that synchronous `TransportAck` into `MachineState.ApplyReading(reading, ack)` **and** `HistorianResultRecord.From(descriptor, reading, ack, ...)`.

B2 ("one spine, two bridges") inverts this: the pipeline publishes ONLY to UNS; **new `St4iBridge` + `HistorianUnsBridge` SUBSCRIBE to the UNS spine** and drive ST4I / the historian asynchronously, off the pipeline thread. UNS becomes the single source of truth; ST4I becomes just another subscriber.

## Why it's high-risk (not additive)
- **The ack is synchronous today and load-bearing.** `TransportAck` (success/duplicate/queued + latency) is consumed at pipeline-commit time by `MachineState` (tile ack status), `HistorianResultRecord`/`HistorianModels` (every historian row's ack fields), the inspector stream, and the WPF `FleetService`/`MachineViewModel`/`FleetViewModel`. A grep for the ack surface hits **~34 files** across EdgeCore, EngineApi, EdgeService, and St4iMachineSimulator (WPF).
- **Async subscriber ⇒ no ack at commit time.** If ST4I is driven by an async bridge, the ack arrives LATER (out of band). MachineState + historian would have to: record "queued" at commit, then **correlate the ack back** (by serial/seq) and UPDATE the tile + a two-phase historian write. That's a genuine semantics redesign, not a wiring change.
- **Can't be shipped side-by-side.** Running the existing synchronous ST4I send AND an async `St4iBridge` in parallel would DOUBLE-SEND to ST4I (and double-write the historian). So B2 must REPLACE the sync path — there's no low-risk additive slice of the real inversion.
- **Wide test + UI blast radius.** Many EngineApi/EdgeCore tests assert ack-derived MachineState/historian fields; the WPF app renders ack status. All would move.

## Why the value is limited *right now*
- The middleware's connectable value is **already delivered**: the ecosystem/SYNAPSE Site consumes the **UNS spine** (Sparkplug B + retained semantic mirror + NBIRTH/NDEATH). B2 changes *who drives ST4I internally*, not *what an ecosystem subscriber receives*.
- B2's real payoff (UNS as single source of truth, ST4I fully decoupled, latency off the hot path) is realized **together with the join/site work** (GĐ3) — not standalone.
- Pass-2 is currently clean and mergeable; a sync→async ack redesign is exactly the kind of change that should land in its own dedicated pass with its own review budget, not bolted on here.

## Recommendation
**DEFER B2 to GĐ3**, bundled with the ecosystem join/mDNS work (the blueprint's original decision, decision #5). If a demonstrable "external subscriber consumes the spine" proof is wanted sooner, a small, genuinely-additive **read-only UNS subscriber sample** (verifies/logs spine receipt, drives nothing) can show the connectable path without touching the ack/historian drive path — but that is a demo, not the B2 inversion.

## If the user wants B2 now anyway (scoped path)
A careful B2 would be its own multi-task mini-phase: (1) define async ack-correlation (serial/seq → ack) + the "queued-then-acked" MachineState/historian semantics; (2) `St4iBridge` (UNS→ST4I) replacing the pipeline's sync send behind a flag; (3) `HistorianUnsBridge` (UNS→historian); (4) migrate MachineState/HistorianModels + all ack-derived tests + the WPF ack rendering; (5) whole-branch review. High risk; expect churn across the ~34-file ack surface.
