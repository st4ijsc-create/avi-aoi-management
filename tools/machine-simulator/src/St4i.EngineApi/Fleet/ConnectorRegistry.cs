using System.Collections.Concurrent;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// connector-id-keyed registry that replaces <see cref="FleetHost"/>'s old per-driver-kind hardcoding: one
/// dedicated optional constructor parameter (<c>Func&lt;IDeviceDriver&gt;? modbusDriverFactory</c>,
/// <c>OpcUaDriverFactory? opcUaDriverFactory</c>) and one copy-pasted <see cref="FleetHost.StartLocked"/>
/// block per driver kind. Onboarding a new connector kind used to mean editing three files (FleetHost's
/// ctor, StartLocked, and Program.cs's wiring); with this registry it means calling <see cref="Register"/>
/// once, with no <see cref="FleetHost"/> change at all — <see cref="FleetHost"/> only ever asks this
/// registry "what connector ids are configured" and "build me a driver for this one."
///
/// <para><b>Why this lives in St4i.EngineApi, not St4i.EdgeCore:</b> <see cref="FleetHost"/> is this
/// registry's ONLY consumer today (verified: neither <c>St4i.EdgeService</c>'s <c>EdgeWorker</c> nor the
/// WPF <c>St4iMachineSimulator</c>'s <c>FleetService</c> ever touch Modbus/OPC-UA or any driver-factory
/// concept — both only ever drive the plain simulated fleet). <c>St4i.EdgeCore</c> is the right home for
/// REUSABLE driver logic consumed by any host (<c>ModbusDriverFactory</c>, <c>OpcUaDriverFactory</c>, and
/// this task's new <c>ModbusConnectorFactory</c>/<c>OpcUaConnectorFactory</c> adapters all stay there,
/// exactly where the driver types they wrap already live) — but THIS registry is a host COMPOSITION-ROOT
/// concept, not driver logic: it is how one specific host (<c>Program.cs</c>) answers "which connectors
/// did I configure" for its own <see cref="FleetHost"/>. Adding it to <c>St4i.EdgeCore</c> (a
/// <c>net10.0-windows</c> assembly with a much heavier dependency surface — DPAPI, the vendored device
/// client SDK) for a type with exactly one real consumer would be speculative generality, not reuse.
/// Should a future host (GP-5's <c>connectors.json</c>, or beyond) need the same registry shape, moving it
/// is a one-file relocation with no design change — this class has zero dependency on anything
/// EngineApi-specific (no ASP.NET Core, no <see cref="FleetHost"/> type reference) precisely so that move
/// stays cheap if it's ever warranted.</para>
///
/// <para><b>Id comparison semantics:</b> every id this class is given (via <see cref="Register"/> or
/// looked up via <see cref="TryCreateDriver"/>) is folded through <see cref="DriverKinds.Normalize"/> —
/// the SAME rule GP-3 established (a case-insensitive fold for the five built-in ids only; a third-party
/// id is left byte-for-byte alone, so <c>"vendor.acme.weld"</c> and <c>"Vendor.Acme.Weld"</c> stay two
/// distinct entries). This registry does not invent a second casing rule — a registry that treated
/// <c>"modbus"</c> and <c>"Modbus"</c> as different entries would be exactly the nasty debugging
/// experience GP-3's own rule exists to prevent, and reusing <see cref="DriverKinds.Normalize"/> here
/// (rather than, say, an <see cref="StringComparer.OrdinalIgnoreCase"/> dictionary, which would ALSO fold
/// two different third-party ids that merely happen to share a casing) is what keeps that guarantee in
/// exactly one place in the codebase.</para>
///
/// <para><b>Unknown-id behavior:</b> <see cref="TryCreateDriver"/> returns <see langword="false"/> with a
/// descriptive <c>error</c> for an id nothing was ever <see cref="Register"/>ed under — never throws, and
/// never silently no-ops without a way for the caller to notice. This is deliberately the SAME shape as a
/// registered connector whose own <see cref="IConnectorFactory.TryCreate"/> rejects its configuration —
/// from <see cref="FleetHost"/>'s point of view "no factory for this id" (an operator typo, or a plugin
/// that failed to load) and "a factory rejected its own config" are the same class of problem: this
/// connector cannot start right now, log it, and do not let it stop any sibling connector or the
/// simulated fleet from starting.</para>
/// </summary>
public sealed class ConnectorRegistry
{
    private sealed record Entry(IConnectorFactory Factory, string Config);

    /// <summary>Keyed by the NORMALIZED id (see the class doc comment) — <see cref="StringComparer.Ordinal"/>
    /// deliberately, not <see cref="StringComparer.OrdinalIgnoreCase"/>: casing tolerance is
    /// <see cref="DriverKinds.Normalize"/>'s job alone, applied once on the way in and once on the way out,
    /// never re-applied a second time by this dictionary's own comparer.</summary>
    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);

    /// <summary>Registers (or replaces) the factory + configuration for <see cref="IConnectorFactory.Kind"/>.
    /// <paramref name="config"/> is stored verbatim and opaque — this method never parses it, only hands it
    /// back to <paramref name="factory"/> unchanged on every future <see cref="TryCreateDriver"/> call for
    /// this id. Re-registering the same id replaces the previous entry (last write wins) rather than
    /// throwing — a host is free to reconfigure a connector and register again.</summary>
    public void Register(IConnectorFactory factory, string config)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var id = DriverKinds.Normalize(factory.Kind);
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("IConnectorFactory.Kind must not be null/blank.", nameof(factory));
        }

        _entries[id] = new Entry(factory, config ?? string.Empty);
    }

    /// <summary>Every currently-registered connector id, normalized. A point-in-time snapshot — safe to
    /// enumerate even if another thread is concurrently <see cref="Register"/>ing (this task never removes
    /// entries once added, so there is no torn-read hazard to guard against).</summary>
    public IReadOnlyList<string> RegisteredIds => _entries.Keys.ToList();

    /// <summary>
    /// Attempts to build a fresh <see cref="IDeviceDriver"/> for <paramref name="id"/> — called anew every
    /// time <see cref="FleetHost.StartLocked"/> needs one (never cached/reused; see
    /// <see cref="IConnectorFactory.TryCreate"/>'s own remarks on why a fresh instance every restart is
    /// required). Never throws: an id nothing was <see cref="Register"/>ed under is reported the same way a
    /// registered factory rejecting its own configuration is (see the class doc comment's "Unknown-id
    /// behavior" section) — <see langword="false"/> plus a descriptive <paramref name="error"/>, never an
    /// exception, and never a silent no-op.
    /// </summary>
    public bool TryCreateDriver(string id, out IDeviceDriver? driver, out string? error)
    {
        var normalized = DriverKinds.Normalize(id);
        if (!_entries.TryGetValue(normalized, out var entry))
        {
            driver = null;
            error = $"No connector factory is registered for connector id '{id}'.";
            return false;
        }

        return entry.Factory.TryCreate(entry.Config, out driver, out error);
    }
}
