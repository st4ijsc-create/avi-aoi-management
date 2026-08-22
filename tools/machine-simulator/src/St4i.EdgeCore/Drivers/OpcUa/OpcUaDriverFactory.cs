using St4i.Connector.Abstractions;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — builds a fresh <see cref="OpcUaDriver"/> per <c>FleetCore.StartLocked</c> call: a
/// driver owns a live OPC-UA session torn down (best-effort) whenever its pipeline slot stops/restarts, so
/// each pipeline (re)start needs a BRAND NEW instance, never a reused one — same reasoning
/// <see cref="Modbus.ModbusDriverFactory"/> already documents for itself.
///
/// <para><b>DI disambiguation, now historical (GP-4 update):</b> this class used to be registered in DI as
/// ITSELF (a distinct concrete type) purely so it would never collide with Modbus's own
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton registration, and <c>FleetHost</c>'s ctor took a dedicated
/// <c>OpcUaDriverFactory?</c> parameter for the same reason. GP-4
/// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) removed both: this
/// type is no longer registered in DI at all (<c>OpcUaConnectorFactory</c>, an
/// <c>St4i.Connector.Abstractions.IConnectorFactory</c> adapter, constructs one internally with a plain
/// <see langword="new"/>), and <c>FleetHost</c> no longer has an OPC-UA-specific constructor parameter —
/// only one <c>ConnectorRegistry</c> singleton, so the collision this workaround existed to avoid cannot
/// occur even in principle anymore.</para>
///
/// <para><b>Testability, now also historical:</b> before GP-4, <c>FleetHost</c>'s ctor took this concrete
/// type directly, so <c>St4i.EngineApi.Tests.FleetHostOpcUaSlotTests</c> substituted a fake driver by
/// subclassing this class and overriding a <see langword="virtual"/> <see cref="Create"/>. That seam has
/// moved: a test now registers a plain <c>IConnectorFactory</c> test double (returning a fake driver from
/// <c>TryCreate</c>) into a <c>ConnectorRegistry</c> instead — no subclass of THIS class is needed, or
/// exists, anymore. <see cref="Create"/> is therefore no longer <see langword="virtual"/> and this class
/// is <see langword="sealed"/>, matching <see cref="Modbus.ModbusDriverFactory"/>'s own shape exactly.</para>
/// </summary>
public sealed class OpcUaDriverFactory
{
    private readonly OpcUaNodeMap _map;
    private readonly string? _pkiDir;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Captures the ALREADY-VALIDATED node map, the certificate-store root and the two optional log
    /// sinks every driver this instance builds will share. <paramref name="map"/> is the only argument
    /// checked — null raises <see cref="ArgumentNullException"/> — which makes this the stricter of the two
    /// OPC-UA types: <see cref="OpcUaConnectorFactory"/>'s own constructor rejects nothing at all.
    ///
    /// <para>The endpoint is not a parameter here because it is carried by the map:
    /// <see cref="OpcUaNodeMap.EndpointUrl"/> is <see langword="required"/> and, per that class's own
    /// precedence note, is the only source the driver reads. So the map decides WHICH server, and
    /// <paramref name="pkiDir"/> decides which certificate store is used to reach it — null does not
    /// disable the store, it hands the choice to <c>OpcUaPkiPaths.ResolveRoot</c>, which reads the
    /// <c>ST4I_OPCUA_PKI_DIR</c> environment variable before falling back to a built-in root.</para>
    ///
    /// <para>No validation is repeated here and no I/O is performed: node-map validation lives entirely in
    /// <see cref="OpcUaNodeMap.FromJson"/>, and a map assembled around that method arrives unchecked.</para>
    ///
    /// <para>🔴 <b>Nothing keeps an instance of this type alive.</b> Measured over every <c>*.cs</c> in the
    /// tree at commit <c>5e194ab0</c>, there is exactly ONE <c>new OpcUaDriverFactory(...)</c> — inside
    /// <see cref="OpcUaConnectorFactory.TryCreate"/>, constructed, asked for one driver and dropped in a
    /// single expression, with no test construction and no other production one. The "one factory, many
    /// restarts" shape the class remarks describe therefore no longer matches how the type is used: the
    /// per-restart freshness comes from the registry calling
    /// <see cref="OpcUaConnectorFactory.TryCreate"/> again. <see cref="Modbus.ModbusDriverFactory"/> is in
    /// exactly the same position, which is consistent with the two classes being deliberate mirrors of one
    /// another.</para></summary>
    public OpcUaDriverFactory(
        OpcUaNodeMap map, string? pkiDir = null,
        Action<string>? logWarning = null, Action<Exception, string>? logError = null)
    {
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _pkiDir = pkiDir;
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>Returns a BRAND NEW <see cref="OpcUaDriver"/> on every call — no caching and no reuse, which
    /// is the whole reason this type exists (see the class remarks). It performs no I/O: the driver's
    /// constructor only stores its arguments and resolves the PKI root as a path, and the OPC-UA session is
    /// established lazily the first time its <c>ReadAsync</c> is enumerated. That is what lets
    /// <see cref="OpcUaConnectorFactory.TryCreate"/> keep <see cref="IConnectorFactory"/>'s "MUST return
    /// promptly and MUST NOT perform I/O" rule while calling straight through to here.
    ///
    /// <para><b>The argument order is not the same as this class's own constructor order</b> — the driver
    /// takes <c>(map, logWarning, logError, pkiDir)</c> with the PKI root LAST, while the constructor above
    /// takes it second. Worth noticing because all four are reference types and two of them are delegates,
    /// so a transcription slip between the two orders would not be caught by the compiler.</para>
    ///
    /// <para>Ownership passes to the caller with the return value: this factory keeps no reference to what
    /// it produced and nothing here disposes a driver or notices one that was never torn
    /// down.</para></summary>
    /// <returns>A new, sessionless OPC-UA driver bound to this factory's node map and PKI root.</returns>
    public IDeviceDriver Create() => new OpcUaDriver(_map, _logWarning, _logError, _pkiDir);
}
