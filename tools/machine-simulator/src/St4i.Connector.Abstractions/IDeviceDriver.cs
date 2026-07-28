using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Abstractions;

/// <summary>
/// The single seam every reading SOURCE implements — whether it's <c>SimulatedDriver</c>
/// (this task), a hot-folder AOI watcher (Task 11), or an MQTT subscriber (Task 12). Everything
/// downstream (Task 13's pipeline, Normalizer, Transport) only ever talks to this interface, so
/// P3-P5 drivers (Modbus/OPC-UA/SECS-GEM — doc-62 §11) slot in later without touching the pipeline.
/// </summary>
public interface IDeviceDriver : IAsyncDisposable
{
    /// <summary>Stable identifier for this driver instance (for logging/UI, not a machine code).</summary>
    string Id { get; }

    DriverKind Kind { get; }

    /// <summary>Current connectivity/health state — surfaced by the UI (dashboard driver badges).</summary>
    DriverHealthState Health { get; }

    /// <summary>
    /// Streams readings for as long as <paramref name="ct"/> is not cancelled. Implementations may
    /// throw <see cref="OperationCanceledException"/> from the enumerator when <paramref name="ct"/>
    /// is cancelled — this is the standard cancellable-async-iterator contract.
    /// </summary>
    IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct);
}
