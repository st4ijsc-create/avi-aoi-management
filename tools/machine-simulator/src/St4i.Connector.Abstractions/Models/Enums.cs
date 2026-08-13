namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Which of the three ingest shapes a <see cref="DeviceReading"/> carries. The host switches on this to
/// decide which endpoint the reading normalizes to, and it reads only the collection that the chosen kind
/// names. Serialized as a camelCase string, never an ordinal — see <see cref="Json.ConnectorJson"/>.
/// </summary>
public enum ReadingKind
{
    /// <summary>One completed process/assembly cycle: <see cref="DeviceReading.Metrics"/>, optionally
    /// <see cref="DeviceReading.Waveforms"/>, judged as a whole by <see cref="DeviceReading.Verdict"/>.
    /// Normalizes to this product's <c>/api/v1/ingest/process-result</c> endpoint.</summary>
    ProcessResult,

    /// <summary>Point-in-time device samples: <see cref="DeviceReading.Telemetry"/>. Normalizes to this
    /// product's <c>/api/v1/ingest/telemetry</c> endpoint, whose payload carries no pass/fail field at
    /// all — <see cref="DeviceReading.Verdict"/> is not read for this kind.</summary>
    Telemetry,

    /// <summary>One inspected unit (AOI/AVI): <see cref="DeviceReading.Measurements"/>, one entry per
    /// measured point. Normalizes to this product's <c>/api/v1/ingest/inspection</c> endpoint, which
    /// aggregates the per-point results into one overall result for the unit.</summary>
    Inspection,
}

// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — DriverKind
// used to live here as a closed enum; it is now the free-form string id documented on DriverKinds
// (this same namespace) so a third-party connector can define its own id without touching this
// assembly. See DriverKinds' own doc comment for the built-in constants, the casing/normalization
// rule, and the recommended (not enforced) third-party naming convention.

/// <summary>
/// The coarse category of the machine a driver stands in for. Nothing in THIS assembly reads it — it is
/// carried on the host's own machine descriptor and in a mapping profile's <c>deviceClass</c> field, and
/// the host's simulator factory falls back to it when a machine's finer machine-type string is one this
/// build does not recognize. Serialized as a camelCase string, never an ordinal — see
/// <see cref="Json.ConnectorJson"/>.
/// </summary>
public enum DeviceClass
{
    /// <summary>An automated process/assembly machine. The shipped mapping profiles use it for
    /// screwdriving, dispensing and welding.</summary>
    Automation,

    /// <summary>A sensor/telemetry device. The shipped <c>iot-sensor</c> and <c>mqtt-iot</c> mapping
    /// profiles use it.</summary>
    Iot,

    /// <summary>An AOI/AVI inspection machine. The shipped <c>aoi</c> and <c>hotfolder-aoi</c> mapping
    /// profiles use it.</summary>
    AoiAvi,
}

/// <summary>
/// The value domain of <see cref="IDeviceDriver.Health"/> — see that member's own doc comment for the rule
/// a driver must honour when reporting it. This product raises a driver-health alarm per slot off this
/// value, so the choice between the two unhealthy members below is operator-visible. Serialized as a
/// camelCase string, never an ordinal — see <see cref="Json.ConnectorJson"/>.
/// </summary>
public enum DriverHealthState
{
    /// <summary>The driver's link to its device is up. This is the member
    /// <see cref="IDeviceDriver.Health"/>'s contract constrains: a driver that models a link to something
    /// outside the process must never report it while no such device is actually reachable. It is also the
    /// only member that raises no driver-health alarm — reporting it clears both of the others'.</summary>
    Connected,

    /// <summary>Not connected, and the less severe of the two ways of saying so: this product raises a
    /// HIGH-priority <c>DEGRADED</c> driver-health alarm for it, worded as "check the connection".</summary>
    Degraded,

    /// <summary>Not connected, and the more severe of the two: this product raises a CRITICAL <c>DOWN</c>
    /// driver-health alarm for it, worded as "the device is unreachable".</summary>
    Down,
}

/// <summary>
/// The coarse pass/fail one <see cref="DeviceReading"/> carries for its cycle as a whole, distinct from any
/// per-point result inside <see cref="DeviceReading.Measurements"/>. On a
/// <see cref="ReadingKind.ProcessResult"/> reading it reaches this product's process-result endpoint
/// lower-cased (<c>pass</c>/<c>warn</c>/<c>fail</c>/<c>skip</c>). On a <see cref="ReadingKind.Inspection"/>
/// reading it is consulted ONLY when <see cref="DeviceReading.Measurements"/> is empty, and there
/// <see cref="Fail"/> becomes <c>NG</c>, <see cref="Skip"/> becomes <c>NTF</c>, and every other member
/// becomes <c>OK</c>. Serialized as a camelCase string, never an ordinal — see
/// <see cref="Json.ConnectorJson"/>.
/// </summary>
public enum Verdict
{
    /// <summary>The cycle was judged and met its specification.</summary>
    Pass,

    /// <summary>Judged, but not cleanly. The shared helper this product's metric-judging simulators go
    /// through returns it in three situations that this value alone does not distinguish: a value inside
    /// its limits but hugging one, a value OUTSIDE a limit by no more than a margin derived from the
    /// limits themselves, and a metric with no limits to judge against at all. So it does not by itself
    /// mean the cycle was within specification.</summary>
    Warn,

    /// <summary>The cycle was judged and did not meet its specification. The only member that becomes
    /// <c>NG</c> on the inspection endpoint.</summary>
    Fail,

    /// <summary>No pass/fail was reached for this cycle: the convention for a reading whose kind has no
    /// verdict concept at all (see <see cref="CyclePlanStep.Result"/>'s own doc comment, which mirrors it
    /// per step, and which names telemetry as that case). Becomes <c>NTF</c> on the inspection endpoint,
    /// which that endpoint's worst-wins aggregation ranks between <c>OK</c> and <c>NG</c>.</summary>
    Skip,
}
