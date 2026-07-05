# SYNAPSE Local Agent — hardware sidecar — spec/scaffold

> doc 33 W5 / ADR-006 §3.3. **Spec only.** The Local Agent is where everything native lives so the
> UI stays web-only. Runs as a background service on the machine's IPC alongside the app.

## Responsibility
Bridge machine-local hardware the browser can't reach → normalize → publish to the **local UNS**
(`syn/{site}/…`). The app + Control Tower consume the UNS, never the hardware.

| Need | Local Agent handles | UI does NOT |
|---|---|---|
| RS-232/485, USB, I/O card | serial/USB read → UNS telemetry | touch COM/USB |
| Vendor SDK (C#/C++ DLL, e.g. FOCAS) | sidecar process links the DLL, speaks the Connector gRPC contract | link the DLL |
| USB license dongle | read dongle → license service | read dongle |
| Fullscreen/auto-start/offline | (Tauri shell does this) | — |

## Contract
The Local Agent implements the **Device Connector** extension point (F2/F3): it registers a
plugin manifest (`apiVersion` gate + `configSchema` → auto-form + signed) and runs **out-of-process**
under the F3 supervisor (watchdog + backoff + circuit-break + quota). It speaks the same
JSON-lines-over-stdio (→ gRPC/unix-socket) contract as any other connector — the platform sees only
the contract, never the vendor code.

## Implementation note
Go (per SYNAPSE) or Node (to reuse the existing OT drivers) — a small resident process. The F3
`pluginSupervisor` already models spawn/watchdog/quota; the Agent is a first-party connector plugin.
Building it requires the target hardware + vendor SDKs (deferred — hardware step, doc 33 §7 C2).
