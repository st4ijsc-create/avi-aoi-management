using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// <see cref="IConnectorFactory"/> adapter that lets OPC-UA register itself into a host's
/// <see cref="St4i.EdgeCore.Fleet.ConnectorRegistry"/> instead of needing its own dedicated
/// <c>FleetHost</c> constructor parameter. Mirrors <see cref="Modbus.ModbusConnectorFactory"/>
/// exactly: turns the opaque configuration string a registry hands it into a validated
/// <see cref="OpcUaNodeMap"/> without throwing, then delegates actual driver construction to a
/// freshly-built <see cref="OpcUaDriverFactory"/>, reusing its existing <see cref="OpcUaDriverFactory.Create"/>
/// rather than duplicating <c>new OpcUaDriver(...)</c> here.
///
/// <para><c>pkiDir</c> (NOT part of the node map JSON) is supplied once, at this adapter's own
/// construction, by whatever wires it into a registry (<c>Program.cs</c>, mirroring exactly how it
/// constructs <see cref="OpcUaDriverFactory"/> today) — <see cref="TryCreate"/>'s <c>config</c> parameter
/// is the node-map JSON text alone, exactly the string <c>File.ReadAllText(OpcUaOptions.MapPath)</c>
/// already produces.</para>
///
/// <para><b>DI disambiguation, resolved:</b> <see cref="OpcUaDriverFactory"/> used to be registered in DI
/// as ITSELF (a distinct concrete type) purely so it would never collide with Modbus's own
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton registration — see that class's own now-historical "DI
/// disambiguation" remarks. This adapter is never itself registered in DI at all (Program.cs constructs it
/// with a plain <see langword="new"/>, the same way it already constructs
/// <see cref="Modbus.ModbusConnectorFactory"/>) — the ONLY DI singleton either connector kind needs now is
/// the one <c>ConnectorRegistry</c> itself, so the collision this workaround existed to avoid cannot occur
/// even in principle: there is exactly one registered type, not two.</para>
/// </summary>
public sealed class OpcUaConnectorFactory : IConnectorFactory
{
    private readonly string? _pkiDir;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Captures the certificate-store root and the two optional log sinks that every driver this
    /// adapter later builds will share. The endpoint is NOT captured here — unlike
    /// <see cref="Modbus.ModbusConnectorFactory"/>, which owns a host and port, an OPC-UA endpoint URL
    /// travels inside the node-map text <see cref="TryCreate"/> is handed, so one instance of this adapter
    /// can serve maps pointing at different servers.
    ///
    /// <para>🔴 <b>This constructor rejects NOTHING, and that is a real difference from its Modbus twin.</b>
    /// All three arguments are optional and nullable and are stored exactly as handed over — there is no
    /// <see cref="ArgumentNullException"/> anywhere in it, where <see cref="Modbus.ModbusConnectorFactory"/>
    /// throws on a null options. <c>new OpcUaConnectorFactory()</c> is a legal, fully functional adapter with
    /// no logging and no explicit PKI root.</para>
    ///
    /// <para><paramref name="pkiDir"/> null is not "no certificates": the driver resolves it through
    /// <c>OpcUaPkiPaths.ResolveRoot</c>, which falls back to the <c>ST4I_OPCUA_PKI_DIR</c> environment
    /// variable and only then to a built-in root — so passing null hands the choice to the process
    /// environment rather than disabling the store. The two delegates are stored and forwarded and never wrapped, and — unlike the Modbus
    /// adapter, whose parse step takes a warning sink — <see cref="OpcUaNodeMap.FromJson"/> takes no logger,
    /// so neither delegate is invoked anywhere inside <see cref="TryCreate"/>. They are first called by the
    /// driver, after this adapter has returned.</para></summary>
    public OpcUaConnectorFactory(
        string? pkiDir = null,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _pkiDir = pkiDir;
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>Always <see cref="DriverKinds.OpcUa"/>, read from the constant rather than spelled — which
    /// is how <see cref="IConnectorFactory.Kind"/>'s "MUST match the <see cref="IDeviceDriver.Kind"/> every
    /// driver <see cref="TryCreate"/> produces reports back" obligation is kept: the
    /// <see cref="OpcUaDriver"/> built below reads the same constant, so it holds because there is one
    /// constant rather than two spellings. The two sides are pinned separately rather than as a pair —
    /// <c>OpcUaConnectorFactoryTests.Kind_ReportsTheOpcUaBuiltInId</c> and
    /// <c>OpcUaDriverLoopbackTests</c> each assert their own side equals the constant, and no test compares
    /// a factory's value with the value of the driver it just built.
    ///
    /// <para>Unlike <see cref="Modbus.ModbusConnectorFactory.Kind"/>, this id maps to exactly one driver
    /// type — <see cref="OpcUaDriver"/> is the only class in this tree that reports it — so there is no
    /// second transport hidden behind the same value.</para>
    ///
    /// <para>The registry reads this through <c>DriverKinds.Normalize</c>, which folds the five built-in ids
    /// case-insensitively; a getter that threw, or a blank value, would make
    /// <c>ConnectorRegistry.Register</c> return false rather than propagate. Neither is reachable from a
    /// non-empty compile-time constant.</para></summary>
    public string Kind => DriverKinds.OpcUa;

    /// <summary><paramref name="config"/> is the OPC-UA node-map JSON text (see the class doc comment) —
    /// parsed fresh on every call via <see cref="OpcUaNodeMap.FromJson"/>, whose exceptions are caught here
    /// and translated into the non-throwing <see cref="IConnectorFactory.TryCreate"/> contract: today's
    /// exact "a malformed node map file disables OPC-UA for this run without crashing the host" behavior,
    /// now expressed structurally instead of via an ad hoc try/catch at the call site.
    ///
    /// <para>Review note (fix round 1): this method only ever parses a small in-memory JSON blob and
    /// constructs a driver object (never opens the OPC-UA session itself — that happens lazily inside
    /// <c>OpcUaDriver.ReadAsync</c>), so it already satisfies <see cref="IConnectorFactory.TryCreate"/>'s
    /// "MUST return promptly and MUST NOT perform I/O" contract without any change here.</para>
    /// </summary>
    public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
    {
        try
        {
            var map = OpcUaNodeMap.FromJson(config);
            driver = new OpcUaDriverFactory(map, _pkiDir, _logWarning, _logError).Create();
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            driver = null;
            error = ex.Message;
            return false;
        }
    }
}
