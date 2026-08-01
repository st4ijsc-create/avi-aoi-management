namespace St4i.EdgeCore.Models;

// GP-1 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-1-brief.md) — ReadingKind,
// DriverKind, DeviceClass, DriverHealthState, and Verdict moved to
// St4i.Connector.Abstractions.Models.Enums (the driver contract). TransportMode stays here: it is a host
// transport concern (Live/Demo/Auto — which transport EdgeCore's own pipeline talks to), not part of what
// a third-party driver author needs.
public enum TransportMode { Live, Demo, Auto }
