namespace St4i.EngineApi.Safety;

/// <summary>XC-R40 — a read-only snapshot of the SUPERVISORY software safety state. <see cref="EstopEngaged"/>
/// is a software latch, NOT an independent safety-rated device: it can supervise/annunciate but must never be
/// relied on as a protective safety function. There is exactly ONE write path to the underlying latch
/// (<c>FleetHost.Estop()</c>/<c>ResetEstop()</c>); this type only ever READS it.</summary>
public sealed record SafetySnapshot(bool EstopEngaged, bool IsRunning);
