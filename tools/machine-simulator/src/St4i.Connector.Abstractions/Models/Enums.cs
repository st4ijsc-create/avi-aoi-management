namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Which of the three ingest shapes a <see cref="DeviceReading"/> carries. This product's NORMALIZER
/// switches on it to decide which endpoint the reading goes to, and reads only the collection that the
/// chosen kind names.
///
/// <para>🔴 <b>Other consumers do NOT all honour that gate, and a driver author must not generalise it
/// into "the other collections are inert".</b> The path that persists each result to disk reads
/// <see cref="DeviceReading.Metrics"/>, <see cref="DeviceReading.Telemetry"/>,
/// <see cref="DeviceReading.Measurements"/>, <see cref="DeviceReading.Genealogy"/> and
/// <see cref="DeviceReading.Verdict"/> REGARDLESS of this value, and the HTTP surface serves that back;
/// the live-state reader takes three of those five ungated. The UNS/Sparkplug publisher, by contrast,
/// DOES gate — so misplaced content can be recorded without ever being published. The conformance harness
/// a third-party author runs also inspects these without checking this value. See
/// <see cref="DeviceReading"/> and each of its members for which readers gate and which do not.</para>
///
/// <para>On the connector wire format this is written as a camelCase string, never an ordinal — see
/// <see cref="Json.ConnectorJson"/>. That is a property of THAT format, not of every place the value is
/// recorded: this product also persists it as its CLR member name.</para>
/// </summary>
public enum ReadingKind
{
    /// <summary>One completed process/assembly cycle: <see cref="DeviceReading.Metrics"/>, optionally
    /// <see cref="DeviceReading.Waveforms"/>, judged as a whole by <see cref="DeviceReading.Verdict"/>.
    /// Normalizes to this product's <c>/api/v1/ingest/process-result</c> endpoint.</summary>
    ProcessResult,

    /// <summary>Point-in-time device samples: <see cref="DeviceReading.Telemetry"/>. Normalizes to this
    /// product's <c>/api/v1/ingest/telemetry</c> endpoint, whose PAYLOAD carries no pass/fail field at
    /// all. That is a fact about the payload only: this product still reads
    /// <see cref="DeviceReading.Verdict"/> on a reading of this kind in-process, where
    /// <see cref="Verdict.Skip"/> is what keeps it out of the pass-rate tally — see that member's own doc
    /// comment.</summary>
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
/// The coarse category of the machine a driver stands in for. Nothing in THIS assembly reads it, and it
/// is on NO type this assembly's own wire format serializes — it is carried on the host's own machine
/// descriptor and in a mapping profile's <c>deviceClass</c> field, and the host's simulator factory falls
/// back to it when a machine's finer machine-type string is one this build does not recognize.
///
/// <para>Only ONE shipped file actually holds this enum: the fleet roster, whose <c>deviceClass</c> field
/// deserializes to these members. Its loader deliberately pins no naming policy, so any casing matches —
/// the shipped roster uses camelCase (<c>"automation"</c>, <c>"iot"</c>, <c>"aoiAvi"</c>), and a consumer
/// must not assume a casing there.</para>
///
/// <para>🔴 A mapping profile's <c>deviceClass</c> looks like the same thing and is NOT: on the host's
/// mapping profile that field is a plain <see langword="string"/> with no enum converter behind it,
/// checked against nothing. The shipped profiles happen to write these member names, but this product
/// itself also ships <c>"Mixed"</c> there, which is not a member of this enum at all. Do not read a value
/// out of that field as one of these.</para>
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
/// value, so the choice between the two unhealthy members below is operator-visible. It is on no type
/// this assembly's wire format serializes, and in this product it reaches no JSON at all — it is read
/// in-process, off a live driver, and turned into alarms.
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
/// becomes <c>OK</c>.
///
/// <para>Both of those are rules of the NORMALIZER. Away from it this product reads this value on EVERY
/// reading of every kind: it drives the machine's pass-rate tally and its status text unconditionally, it
/// is persisted with each stored result, and it is published as a Sparkplug metric on the process-result
/// and inspection arms. It also backs the spark value, but only as a LAST resort — after a first metric
/// and a numerically-resolvable first telemetry sample have both been found absent. So it is never
/// ignorable on the grounds of <see cref="DeviceReading.Kind"/>; see <see cref="Skip"/> for the member
/// that carries "no judgement" through those readers.</para>
///
/// <para>On the connector wire format this is written as a camelCase string, never an ordinal — see
/// <see cref="Json.ConnectorJson"/>. As with <see cref="ReadingKind"/>, that is a property of THAT
/// format: this product also persists it as its CLR member name.</para>
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
    /// per step, and which names telemetry as that case). It is the member the in-process readers named on
    /// this enum treat specially — it is what keeps a reading OUT of the pass-rate tally rather than
    /// counting as a failure in it, so a telemetry driver that leaves this at its default
    /// (<see cref="Pass"/>, ordinal 0) silently inflates that machine's pass rate instead of abstaining.
    /// Becomes <c>NTF</c> on the inspection endpoint, which that endpoint's worst-wins aggregation ranks
    /// between <c>OK</c> and <c>NG</c>.</summary>
    Skip,
}
