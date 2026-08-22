using St4i.Connector.Abstractions;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — builds a fresh <see cref="ModbusTcpDriver"/> per <c>FleetCore.StartLocked</c> call: a
/// driver owns a live TCP connection torn down (best-effort) whenever its pipeline slot stops/restarts, so
/// each pipeline (re)start needs a BRAND NEW instance, never a reused one (same reasoning
/// <c>SimulatorFactory.Create</c> already applies to the simulated fleet's own drivers).
///
/// <para>🔴 <b>THE SENTENCE THAT USED TO CLOSE THIS BLOCK IS STALE AND IS RETRACTED HERE, NOT DELETED.</b>
/// It read: <i>"Program.cs constructs exactly one of these (when <see cref="ModbusOptions.Enabled"/> and the
/// register map loads) and registers its <see cref="Create"/> method as the
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton St4i.EngineApi's <c>FleetHost</c> optional ctor param
/// resolves."</i> Measured at commit <c>5e194ab0</c>: <c>St4i.EngineApi/Program.cs</c> contains no
/// <c>Func&lt;IDeviceDriver&gt;</c> registration at all — the three occurrences of that type name in it are
/// comments describing the arrangement as historical, and its own words are that GP-4 "removed BOTH
/// registrations: neither <c>ModbusDriverFactory</c>/<c>OpcUaDriverFactory</c> nor their new
/// <c>ModbusConnectorFactory</c>/<c>OpcUaConnectorFactory</c> adapters are ever registered in DI at all
/// anymore". <see cref="OpcUa.OpcUaDriverFactory"/> already carries that correction from its own side; this class
/// did not, and kept asserting the pre-GP-4 shape.</para>
///
/// <para>What replaces it, measured rather than assumed: every construction of this type in the tree is a
/// plain <see langword="new"/> — one inside <see cref="ModbusConnectorFactory.TryCreate"/>, per call, and
/// none anywhere else under <c>src/</c>. So today this type has exactly one production caller and it is the
/// connector adapter, not a DI container.</para>
/// </summary>
public sealed class ModbusDriverFactory
{
    private readonly ModbusOptions _options;
    private readonly ModbusRegisterMap _map;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Captures the endpoint, the ALREADY-VALIDATED register map and the two optional log sinks
    /// that every driver this instance later builds will share. <paramref name="options"/> and
    /// <paramref name="map"/> are both rejected when null (<see cref="ArgumentNullException"/>); the
    /// delegates are optional and stored as handed over.
    ///
    /// <para><b>Nothing is re-checked here.</b> Register-map validation lives entirely in
    /// <see cref="ModbusRegisterMap.FromJson"/> — that is where bad JSON, a blank required field and an
    /// empty register list are rejected — and this constructor performs no second validation and no I/O. It
    /// is the one caller's job to have gone through that method; a map assembled around it arrives
    /// unchecked and is handed to the driver as-is.</para>
    ///
    /// <para>🔴 <b>Nothing keeps an instance of this type alive.</b> Measured over every <c>*.cs</c> in the
    /// tree at commit <c>5e194ab0</c>, there is exactly ONE <c>new ModbusDriverFactory(...)</c> — inside
    /// <see cref="ModbusConnectorFactory.TryCreate"/>, where it is constructed, asked for one driver and
    /// dropped in a single expression. There is no test construction and no other production one. So the
    /// "one factory, many restarts" shape the class remarks describe is no longer how this type is used:
    /// per-restart freshness now comes from the registry calling
    /// <see cref="ModbusConnectorFactory.TryCreate"/> again, and this type's remaining job is to hold the
    /// four values that one <see cref="Create"/> call needs.</para></summary>
    public ModbusDriverFactory(
        ModbusOptions options, ModbusRegisterMap map,
        Action<string>? logWarning = null, Action<Exception, string>? logError = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>Returns a BRAND NEW <see cref="ModbusTcpDriver"/> on every call — no caching, no pooling and
    /// no reuse, which is the whole reason this type exists (see the class remarks). The four captured
    /// values are passed straight through, so every driver from one factory would share one endpoint, one
    /// register map and one pair of log sinks; as the constructor's own note records, the single caller in
    /// this tree calls it once per instance, so "every driver from one factory" is a set of size one
    /// today.
    ///
    /// <para><b>It performs no I/O and cannot fail on the network.</b> The constructor it calls only stores
    /// its arguments; the TCP socket is opened lazily the first time the driver's <c>ReadAsync</c> is
    /// enumerated. That is what lets <see cref="ModbusConnectorFactory.TryCreate"/> satisfy
    /// <see cref="IConnectorFactory"/>'s "MUST return promptly and MUST NOT perform I/O" rule while calling
    /// straight through to here.</para>
    ///
    /// <para><b>Ownership passes to the caller with the return value.</b> This factory keeps no reference to
    /// what it produced, so nothing here disposes a driver, counts them, or notices one that was never torn
    /// down; a caller that calls this twice and drops the first result leaks whatever that instance had
    /// opened.</para></summary>
    /// <returns>A new, unconnected Modbus TCP driver bound to this factory's endpoint and map.</returns>
    public IDeviceDriver Create() => new ModbusTcpDriver(_options.Host, _options.Port, _map, _logWarning, _logError);
}
