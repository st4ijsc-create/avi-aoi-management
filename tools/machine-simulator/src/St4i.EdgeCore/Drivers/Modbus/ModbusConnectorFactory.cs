using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// <see cref="IConnectorFactory"/> adapter that lets Modbus register itself into a host's
/// <see cref="St4i.EdgeCore.Fleet.ConnectorRegistry"/> instead of needing its own dedicated
/// <c>FleetHost</c> constructor parameter. Deliberately a thin wrapper, NOT a replacement, for
/// <see cref="ModbusDriverFactory"/>: this class owns exactly one job — turn the OPAQUE configuration
/// string a registry hands it into a validated <see cref="ModbusRegisterMap"/> without throwing — and then
/// delegates the actual driver construction to a freshly-built <see cref="ModbusDriverFactory"/>, reusing
/// its existing <see cref="ModbusDriverFactory.Create"/> rather than duplicating
/// <c>new ModbusTcpDriver(...)</c> here.
///
/// <para><see cref="ModbusOptions"/> (host/port — NOT part of the register map JSON) is supplied once, at
/// this adapter's own construction, by whatever wires it into a registry (<c>Program.cs</c>, mirroring
/// exactly how it constructs <see cref="ModbusDriverFactory"/> today) — <see cref="TryCreate"/>'s
/// <c>config</c> parameter is the register-map JSON text alone, i.e. exactly the string
/// <c>File.ReadAllText(ModbusOptions.MapPath)</c> already produces, so a host that already loaded that
/// file for its own purposes (e.g. to build a roster seed descriptor) can hand this adapter the very same
/// text with no re-reading, re-formatting, or wrapping.</para>
/// </summary>
public sealed class ModbusConnectorFactory : IConnectorFactory
{
    private readonly ModbusOptions _options;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Binds this adapter to ONE Modbus endpoint for its whole life. Everything
    /// <see cref="TryCreate"/> is later handed is register-map text; the host and port are fixed here and
    /// there is no path to change them afterwards (<see cref="ModbusOptions.Host"/> and
    /// <see cref="ModbusOptions.Port"/> are <see langword="init"/>-only).
    ///
    /// <para><b>The registry consequence a caller can get wrong.</b>
    /// <c>ConnectorRegistry.Register</c> keys on the normalized <see cref="Kind"/> unless an explicit
    /// instance id is supplied, and a repeat key REPLACES the earlier entry rather than being refused. So
    /// registering a second <see cref="ModbusConnectorFactory"/> for a second endpoint without giving it its
    /// own instance id silently retires the first endpoint — and the same is true across the two Modbus
    /// adapters, because <see cref="ModbusRtuConnectorFactory"/> reports the same <see cref="Kind"/> and so
    /// defaults to the same key.</para>
    ///
    /// <para><paramref name="options"/> is the only argument checked — null raises
    /// <see cref="ArgumentNullException"/>. The two delegates are stored exactly as handed over and are
    /// never wrapped: <paramref name="logWarning"/> reaches two places (<see cref="ModbusRegisterMap.FromJson"/>
    /// during a parse, and the driver afterwards) while <paramref name="logError"/> reaches only the driver.
    /// Because the parse call sits inside <see cref="TryCreate"/>'s <see langword="catch"/>, a
    /// <paramref name="logWarning"/> that THROWS does not escape — it turns into a failed
    /// <see cref="TryCreate"/> whose <c>error</c> string is the logger's own exception message, i.e. a
    /// logging fault presented to an operator as a bad register map.</para></summary>
    public ModbusConnectorFactory(
        ModbusOptions options,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>Always <see cref="DriverKinds.Modbus"/>, read from the constant rather than spelled — which
    /// is how <see cref="IConnectorFactory.Kind"/>'s "MUST match the <see cref="IDeviceDriver.Kind"/> every
    /// driver <see cref="TryCreate"/> produces reports back" obligation is kept here: the
    /// <see cref="ModbusTcpDriver"/> built below reads the same constant, so the two cannot drift. The two
    /// sides are pinned separately rather than as a pair —
    /// <c>ModbusConnectorFactoryTests.Kind_ReportsTheModbusBuiltInId</c> and
    /// <c>ModbusTcpDriverLoopbackTests</c> each assert their own side equals the constant, and no test
    /// compares a factory's value with the value of the driver it just built.
    ///
    /// <para>🔴 <b>That id is not one-to-one with a transport, and it is not unique to this factory
    /// either.</b> <see cref="DriverKinds.Modbus"/> is deliberately ONE id for the protocol:
    /// <see cref="ModbusRtuDriver"/> reports it, and so does <see cref="ModbusRtuConnectorFactory"/>. So an
    /// entry backed by THIS adapter always yields a TCP driver and never a serial one, while a registry
    /// holding both adapters under the default key holds only the one registered last — the two are
    /// distinguishable only by the explicit instance id described on the constructor.</para>
    ///
    /// <para>The registry reads this property through <c>DriverKinds.Normalize</c> and guards it the same
    /// way it guards <see cref="TryCreate"/>: a getter that threw, or a blank value, makes
    /// <c>ConnectorRegistry.Register</c> return false rather than propagate. Neither is reachable from this
    /// implementation, which returns a non-empty compile-time constant.</para></summary>
    public string Kind => DriverKinds.Modbus;

    /// <summary><paramref name="config"/> is the Modbus register-map JSON text (see the class doc
    /// comment) — parsed fresh on every call via <see cref="ModbusRegisterMap.FromJson"/>, whose exceptions
    /// (bad JSON, a missing/blank required field, an empty register list — see that method's own doc
    /// comment) are caught here and translated into the non-throwing
    /// <see cref="IConnectorFactory.TryCreate"/> contract: today's exact "a malformed map file disables
    /// Modbus for this run without crashing the host" behavior, now expressed structurally instead of via
    /// an ad hoc try/catch at the call site.
    ///
    /// <para>Review note (fix round 1): this method only ever parses a small in-memory JSON blob and
    /// constructs a driver object (never opens the TCP socket itself — that happens lazily inside
    /// <c>ModbusTcpDriver.ReadAsync</c>), so it already satisfies <see cref="IConnectorFactory.TryCreate"/>'s
    /// "MUST return promptly and MUST NOT perform I/O" contract without any change here.</para>
    /// </summary>
    public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
    {
        try
        {
            var map = ModbusRegisterMap.FromJson(config, _logWarning);
            driver = new ModbusDriverFactory(_options, map, _logWarning, _logError).Create();
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
