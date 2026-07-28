namespace St4i.Connector.Abstractions;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the seam a
/// third-party connector implements to be buildable, BY ID, from a host's connector registry (the
/// EngineApi-side <c>ConnectorRegistry</c>) — replacing what used to be one hardcoded
/// <c>FleetHost</c> constructor parameter and one copy-pasted <c>StartLocked</c> block per driver kind
/// (Modbus, OPC-UA). This is the WHOLE public contract a vendor needs to implement; every member here is
/// a permanent commitment, so it is deliberately the smallest shape that still lets a registry (1) find
/// the right factory for a configured connector id and (2) build a fresh driver instance from that
/// connector's own configuration without the registry ever having to understand that configuration's
/// shape.
///
/// <para><b>Why two members, not one:</b> <see cref="Kind"/> is what the registry keys its lookup on (the
/// same free-form connector id <see cref="IDeviceDriver.Kind"/> reports — see
/// <see cref="Models.DriverKinds"/> for the casing/normalization rule a registry is expected to reuse
/// rather than reinvent). <see cref="TryCreate"/> is the one behavior a factory has to provide: given this
/// connector's own configuration, produce a driver or explain why it can't. Nothing else belongs here —
/// lifecycle, disposal, health, and streaming all already live on <see cref="IDeviceDriver"/> itself.</para>
/// </summary>
public interface IConnectorFactory
{
    /// <summary>The connector id this factory builds drivers for. MUST match the <see cref="IDeviceDriver.Kind"/>
    /// every driver <see cref="TryCreate"/> produces reports back — a registry looks this factory up by
    /// this value, normalized the same way <see cref="Models.DriverKinds.Normalize"/> normalizes any other
    /// connector id (a case-insensitive fold for the five built-in ids only; a third-party id is opaque
    /// and case-sensitive, exactly as <see cref="Models.DriverKinds"/> already documents).</summary>
    string Kind { get; }

    /// <summary>
    /// Attempts to build a fresh <see cref="IDeviceDriver"/> instance from <paramref name="config"/>.
    ///
    /// <para><b>Called anew every time a driver instance is needed</b> — a host never reuses a driver
    /// instance across a Stop/restart, because a driver may own a live resource (a TCP socket, a session
    /// handle) that only a brand-new instance can re-acquire (this is exactly why
    /// <c>ModbusTcpDriver</c>/<c>OpcUaDriver</c> already ship their own <c>Create()</c>-per-restart
    /// factory types, which this interface is designed to sit alongside, not replace). A factory is free
    /// to do real work on every call (re-parse <paramref name="config"/>, etc.) — this is deliberately not
    /// a "validate once, cache forever" contract.</para>
    ///
    /// <para><b><paramref name="config"/> is completely opaque</b> to any caller of this method: a
    /// registry that calls this never parses or inspects it, only stores and forwards it — a Modbus
    /// register map and an OPC-UA node map look nothing alike, and a third-party connector's own
    /// configuration can look like anything at all. It is a plain <see langword="string"/> (not, say, a
    /// <see cref="System.Text.Json.JsonElement"/> or a settings dictionary) specifically because a plain
    /// string is (1) exactly what an operator-authored config file already is on disk — every existing
    /// map-loading call site already starts from <c>File.ReadAllText</c> — and (2) the one representation
    /// that survives an IPC/process boundary with zero adaptation once a connector becomes an
    /// out-of-process sidecar, with no assumption baked in about what serializer either side uses. A
    /// factory that wants JSON is free to parse <paramref name="config"/> as JSON itself (as every
    /// built-in factory in this codebase does); this interface does not require that.</para>
    ///
    /// <para><b>MUST NOT throw for a bad/malformed <paramref name="config"/>.</b> A third-party driver
    /// must never be able to take down a host that controls machinery with an E-STOP merely because its
    /// factory method threw. Return <see langword="false"/> instead, with <paramref name="error"/> set to
    /// an operator-readable message describing what was wrong; the caller's contract is to log it and
    /// treat this connector as disabled for the run, never to crash. This interface cannot structurally
    /// force a third-party implementation to honor this — a badly-behaved factory can still throw — which
    /// is exactly why a host is expected to treat a call to this method the same defensive way it treats
    /// any other third-party code: assume it might throw anyway, and isolate that fault the same way a
    /// faulted driver's own <c>ReadAsync</c> is already isolated per-slot.</para>
    /// </summary>
    /// <param name="config">This connector's own configuration, opaque to the caller.</param>
    /// <param name="driver">The built driver on success; <see langword="null"/> on failure.</param>
    /// <param name="error">An operator-readable explanation on failure; <see langword="null"/> on success.</param>
    /// <returns><see langword="true"/> if <paramref name="driver"/> was built; <see langword="false"/> if
    /// <paramref name="config"/> could not be used to build one.</returns>
    bool TryCreate(string config, out IDeviceDriver? driver, out string? error);
}
