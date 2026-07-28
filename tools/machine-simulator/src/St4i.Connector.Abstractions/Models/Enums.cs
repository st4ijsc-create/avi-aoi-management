namespace St4i.Connector.Abstractions.Models;

public enum ReadingKind { ProcessResult, Telemetry, Inspection }

// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — DriverKind
// used to live here as a closed enum; it is now the free-form string id documented on DriverKinds
// (this same namespace) so a third-party connector can define its own id without touching this
// assembly. See DriverKinds' own doc comment for the built-in constants, the casing/normalization
// rule, and the recommended (not enforced) third-party naming convention.

public enum DeviceClass { Automation, Iot, AoiAvi }

public enum DriverHealthState { Connected, Degraded, Down }

public enum Verdict { Pass, Warn, Fail, Skip }
