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
