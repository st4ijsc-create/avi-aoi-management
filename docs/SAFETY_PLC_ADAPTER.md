# Safety-PLC E-Stop Adapter — Seam, FAT Requirements & Interim Risk

**Status:** SKELETON / SEAM ONLY. Flag `SAFETY_ESTOP_ADAPTER_ENABLED` = **OFF**.
**Docs ref:** doc 38 (T-3, R-3), doc 25 §T1, doc 16 §8.
**Owner action:** hardware procurement + commissioning + FAT before any rated claim.

---

## 1. The safety-critical honesty invariant

Today **every** e-stop / abort in this system travels a **non-safety-rated**
software path: `interlockEngine.evaluateRule → commandDispatcher.dispatch`, and
`foeEngine.abortRun` merely flips a DB status. A blocked Node event loop or a GC
pause can delay that "stop". Machine-safety standards (ISO 13849 Cat 3/4,
IEC 62061 SIL 2/3) require the emergency-stop path to be **independent of the
software layer** — a certified **Safety PLC** (Pilz PNOZmulti/PSS, Sick Flexi
Soft) wired **hard, dual-channel**, executing the stop in **hardware in < 100 ms**.

Until that hardware is installed **and** certified:

- `isRated()` **must stay `false`** — never hard-code `true`.
- `triggerEmergencyStop()` returns `actuated:false, rated:false, ok:false` — it
  does **not** actuate. **Software interlock is the ONLY active stop path.**
- Reads (`readEstopState` / `readZoneState`) **never fabricate** a state — an
  unconfigured or unreachable endpoint returns `quality:"unknown"`.
- The skeleton adapters are **not auto-registered**; the runtime registry stays
  `NullSafetyPlcAdapter` until an explicit commissioning step calls
  `registerVendorAdapter()`. With the flag OFF, nothing changes at runtime.

## 2. Code seam

| Piece | File |
| --- | --- |
| Minimal TRIGGER contract + Null default + registry + `requestEmergencyStop` entry | `server/services/safety/estop/safetyEstopAdapter.ts` |
| Richer `SafetyPlcVendorAdapter` (adds `readEstopState`/`readZoneState`/`selfTest`) + Pilz/Sick skeletons + `registerVendorAdapter` | `server/services/safety/estop/vendorAdapters.ts` |
| READ-ONLY status observer (separate concern/flag `SAFETY_PLC_ADAPTER_ENABLED`) | `server/services/safety/plc/safetyPlcAdapter.ts` |

The vendor skeletons reach the controller's **non-safety diagnostic** interface
through the existing OT driver (`driverRegistry`) — Pilz over **Modbus-TCP**, Sick
over **EtherNet/IP** by default — the same connect/readTags path the read-only
adapter already uses. **No write is issued** by the skeleton; even a non-rated
"soft-stop request" coil is documented but deliberately left unwritten so a soft
write can never be mistaken for a rated stop.

## 3. Factory Acceptance Test (FAT) — gate before `isRated()` may return true

A vendor adapter may return `isRated():true` **only after** all of the following
pass on the installed hardware, witnessed and documented:

1. **Dual-channel** e-stop wiring (independent channels A and B), discrepancy
   detection verified (single-channel fault → safe state + fault latched).
2. **Stop time < 100 ms** measured at the actuator, worst-case load, on the
   Safety PLC's hard-wired output — with the Node software layer intentionally
   stalled to prove independence.
3. Category / SIL rating confirmed (ISO 13849 Cat 3/4 or IEC 62061 SIL 2/3) per
   the risk assessment for each guarded zone.
4. **Reset requires manual action** at the machine; no software auto-reset of a
   tripped safety function.
5. Diagnostic reads (`readEstopState`/`readZoneState`) reconcile with the
   physical circuit state under trip / clear / muting / zone-occupied cases.
6. `selfTest()` all checks pass, including `rated-hardware-certified`, and the
   certificate / FAT report reference is recorded.

Only when 1–6 are signed off does a **real, certified** adapter (not these
skeletons) get registered and `SAFETY_ESTOP_ADAPTER_ENABLED` considered for ON.

## 4. Documented interim risk (temporary, written acceptance)

> **Risk:** Until the Safety PLC hardware is installed and FAT-passed, the
> emergency-stop path is **software-only and NOT safety-rated**. A blocked event
> loop, GC pause, process crash, or dispatcher backpressure can delay or drop a
> stop. There is **no independent, < 100 ms, dual-channel hardware stop** in place.
>
> **Mitigation in force:** software interlock (`interlockEngine` +
> `commandDispatcher` 4-gate + robot-interlock) is the sole active stop path and
> is treated as such operationally. Machines that require a rated stop for their
> risk category **must not** run unattended relying on software alone.
>
> **Resolution:** procure + install Pilz PNOZmulti/PSS or Sick Flexi Soft,
> commission via the seam above, pass the FAT in §3, then register the certified
> adapter and enable the flag. This document is the standing record that the
> software-only interlock is a **known, temporary** condition pending that HW.

## 5. Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `SAFETY_ESTOP_ADAPTER_ENABLED` | **OFF** | Arms the TRIGGER entry (`requestEmergencyStop`). OFF → absolute no-op. |
| `SAFETY_PLC_ADAPTER_ENABLED` | **OFF** | Arms the READ-ONLY status observer (separate concern; enabling monitoring must not "arm" actuation). |

## 6. Background poller — short e-stop presses (doc 81 Đợt 9 Group U)

The background poller (`SAFETY_PLC_POLLER_ENABLED`, `server/services/safety/plc/safetyPlcPoller.ts`) only **observes**
the safety PLC's non-safety-rated status and records advisory events. It never writes to the PLC. A plain poll cannot
see an e-stop that is pressed **and** released between two reads. Two features close that gap.

### 6.1 Modbus: the e-stop latch bit (U2)

Add an optional latch tag to the config, e.g. `statusMap.estopLatch = { "address": "coil:3" }`.

- **PLC side.** The PLC program **sets** the latch bit on every e-stop press. It **holds** the bit until the PLC
  program or an operator clears it.
- **Server side.** The poller **reads** the latch on every poll and never clears it (the poller stays read-only).
- **Press never seen live.** If the latch rises and the live e-stop tag was never seen pressed, the press happened
  between two reads. The poller then records `estop` (transition `latched`). If the live tag now reads released, it
  also records `estop_released`.
- **Press already seen live.** A press the poller has already seen live adds nothing.
- **Latch unreadable.** An unreadable latch makes the PLC `plc_offline`. It is never read as "not latched".
- **Approval.** The latch tag is part of the maker-checker approval digest. Adding, changing or removing it clears the
  approval, so a second person must approve again.
- **Preflight.** The latch is **not** used by the actuation preflight, which judges the live e-stop tag only.
- **Clearing.** Clearing the latch is a PLC-side or operator action. A latch that is cleared and set again before the
  next poll counts as one press, so keep it set long enough (see `T_HOLD` below).

Sample latch program, IEC 61131-3 Structured Text. Map `ESTOP_LATCH` to the Modbus coil named in
`statusMap.estopLatch`.

```iecst
(* E-stop latch for the monitoring system. NON-safety-rated: the rated stop is done by the safety program itself.
   ESTOP_OK   : the e-stop circuit status (TRUE = not pressed), as already mapped for statusMap.estop (activeWhen falsy)
   LATCH_RST  : operator reset (HMI button / key switch) — never written by the monitoring server
   ESTOP_LATCH: the coil the poller reads (statusMap.estopLatch)                                                    *)
VAR
  ESTOP_OK    : BOOL;
  LATCH_RST   : BOOL;
  ESTOP_LATCH : BOOL;
  HoldTimer   : TON;
END_VAR
VAR CONSTANT
  T_HOLD : TIME := T#3S;   (* >= 2 x the poller interval (statusMap.pollIntervalMs) + one read timeout *)
END_VAR

IF NOT ESTOP_OK THEN
  ESTOP_LATCH := TRUE;                    (* set on every press, however short *)
END_IF;
HoldTimer(IN := ESTOP_LATCH, PT := T_HOLD);
IF LATCH_RST AND ESTOP_OK AND HoldTimer.Q THEN
  ESTOP_LATCH := FALSE;                   (* cleared only by the operator, only after T_HOLD, only when released *)
END_IF;
```

The same logic in ladder:

```text
|  ESTOP_OK                                   ESTOP_LATCH |
|----|/|---------------------------------------(S)--------|
|  ESTOP_LATCH                  +--TON HoldTimer--+       |
|----| |------------------------|IN            Q |-------|
|                       T_HOLD -|PT              |       |
|  LATCH_RST   ESTOP_OK   HoldTimer.Q          ESTOP_LATCH|
|----| |---------| |--------| |------------------(R)------|
```

### 6.2 OPC-UA: subscription with a queue (U1)

OPC-UA configs are read through a subscription instead of a poll. The monitored items use
`queueSize > 1` and `discardOldest = false`. Every queued value change becomes its own transition, so a press and a
release inside one publishing interval give both events.

- **Lost values.** A queue overflow on the server (the OPC-UA overflow bit) or a gap in the notification sequence
  numbers is recorded as one `plc_events_lost` marker. The net state is still re-detected.
- **Silent subscription.** If the subscription goes quiet (no data and no keep-alive within the bound), the PLC reads
  `plc_offline` and the poller re-subscribes. A silent subscription is never shown as healthy.
- **Fallback to polling.** If the server refuses a subscription, revises the queue size below 2, or revises the
  sampling interval above 250 ms (it would not see a short press), the poller falls back to polling. The safety
  source panel then shows **"polling (short presses may be missed)"**. The poller retries the subscription every 60 s.
- **Modbus without a latch.** It is polled too, so the panel shows the same "polling" note for it. Map a latch (6.1).
- **Connections.** The subscription keeps one session open per PLC. The actuation preflight still opens its own, so
  each PLC needs room for at least 2 clients.
