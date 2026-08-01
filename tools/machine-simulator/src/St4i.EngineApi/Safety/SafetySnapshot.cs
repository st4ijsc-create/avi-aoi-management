namespace St4i.EngineApi.Safety;

/// <summary>XC-R40 — a read-only snapshot of the SUPERVISORY software halt state. <see cref="EstopEngaged"/>
/// (also referred to as the HALT latch in operator-facing text — SM-4) is a software latch, NOT an
/// independent safety-rated device: it can supervise/annunciate but must never be relied on as a
/// protective safety function, and the latch itself has no write path to any physical machine — <c>Estop()</c>/
/// <c>ResetEstop()</c> only ever flip this one bit, never call a driver. That is narrower than "this
/// codebase has no write path to a device" (false since B-4/B-5 — see <c>St4i.EngineApi.Endpoints.MachineWriteEndpoints</c>
/// for the real one, Modbus/OPC-UA setpoints and commands, unrelated to this snapshot). There is exactly
/// ONE write path to the underlying latch (<c>FleetHost.Estop()</c>/<c>ResetEstop()</c>); this type only
/// ever READS it.</summary>
public sealed record SafetySnapshot(bool EstopEngaged, bool IsRunning);
