using System.Collections;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using St4i.DeviceClient;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// The "actually leaves the building" <see cref="ITransport"/>: wraps the reference
/// <see cref="St4iDeviceClient"/> SDK (examples/device-client/csharp/St4iDeviceClient.cs, linked into
/// this project) and turns each <see cref="CanonicalEnvelope"/> the Normalizer produced into the right
/// typed SDK call, then maps the SDK's ack DTO (or a thrown SDK exception) back into a <see cref="TransportAck"/>.
///
/// One client == one machine (per the SDK's own doc comment) — <see cref="ForMachine"/> is the normal
/// entry point; the public ctor exists mainly so tests/tasks 7/13/14 can hand in a pre-built client
/// (e.g. one that already has a loaded mk_ key or a fake <see cref="HttpMessageHandler"/>).
/// </summary>
public sealed class LiveTransport : ITransport
{
    private readonly St4iDeviceClient _client;

    public LiveTransport(St4iDeviceClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <summary>Builds the SDK client from raw connection parameters and wraps it. The normal entry point.</summary>
    public static LiveTransport ForMachine(
        string serverUrl,
        string mkKey,
        string machineCode,
        string? queuePath,
        bool verifyTls,
        HttpMessageHandler? handler = null)
    {
        var client = new St4iDeviceClient(
            serverUrl: serverUrl,
            mkKey: mkKey,
            machineCode: machineCode,
            queuePath: queuePath,
            verifyTls: verifyTls,
            handler: handler);
        return new LiveTransport(client);
    }

    public TransportMode Mode => TransportMode.Live;

    // ─────────────────────────────────────────────────────────────────────
    // SendAsync — dispatch by ReadingKind to the matching typed SDK call.
    // ─────────────────────────────────────────────────────────────────────
    public async Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            return env.Kind switch
            {
                ReadingKind.ProcessResult => await SendProcessResultAsync(env, sw, ct).ConfigureAwait(false),
                ReadingKind.Telemetry => await SendTelemetryAsync(env, sw, ct).ConfigureAwait(false),
                ReadingKind.Inspection => await SendInspectionAsync(env, sw, ct).ConfigureAwait(false),
                _ => throw new ArgumentOutOfRangeException(nameof(env), env.Kind, "Unknown ReadingKind"),
            };
        }
        catch (St4iNetworkException e)
        {
            // Network/timeout — the SDK itself already queued it locally (store-and-forward) before
            // throwing, so from the caller's point of view this send "succeeded" into the local queue.
            sw.Stop();
            return new TransportAck(Success: false, Queued: true, Error: e.Message, LatencyMs: sw.ElapsedMilliseconds);
        }
        catch (St4iApiException e)
        {
            // Permanent 4xx/5xx the server rejected outright — NOT queued, caller must fix/drop it.
            sw.Stop();
            return new TransportAck(Success: false, Queued: false, HttpStatus: e.Status, Error: e.Message, LatencyMs: sw.ElapsedMilliseconds);
        }
        catch (St4iConfigException e)
        {
            // Live is UNCONFIGURED (no mk_ — see St4iDeviceClient.HttpSendAsync's guard) rather than
            // reachable-but-rejecting. Treated the same as a network failure (Success:false, Queued:true)
            // rather than a permanent 4xx: an unconfigured live side is exactly the case Auto mode
            // (Task 19a) must fall back to demo for, and AutoTransport's fallback trigger keys off this
            // Queued:true/Error-not-null shape (see AutoTransport.IsNetworkFailure) — a CONFIGURED live
            // server's own St4iApiException (real 4xx) is caught separately above and must keep
            // surfacing, not fall back.
            sw.Stop();
            return new TransportAck(Success: false, Queued: true, Error: e.Message, LatencyMs: sw.ElapsedMilliseconds);
        }
    }

    private async Task<TransportAck> SendProcessResultAsync(CanonicalEnvelope env, Stopwatch sw, CancellationToken ct)
    {
        var d = env.Payload;
        var ack = await _client.SubmitProcessResultAsync(
            serialNumber: GetString(d, "serialNumber") ?? "",
            stepType: GetString(d, "stepType") ?? "",
            result: GetString(d, "result") ?? "",
            metrics: ReadMetrics(d),
            waveforms: ReadWaveforms(d),
            recipe: ReadRecipe(d),
            idempotencyKey: GetString(d, "idempotencyKey") ?? env.IdempotencyKey,
            ts: GetString(d, "ts"),
            machineCode: GetString(d, "machineCode") ?? env.MachineCode,
            extra: ReadExtra(d),
            ct: ct).ConfigureAwait(false);
        sw.Stop();
        return new TransportAck(
            Success: ack.Success,
            Id: ack.ProcessResultId,
            Duplicate: ack.Duplicate,
            Queued: ack.Queued,
            HttpStatus: 201,
            LatencyMs: sw.ElapsedMilliseconds,
            RawBody: ack.SubmissionId);
    }

    private async Task<TransportAck> SendInspectionAsync(CanonicalEnvelope env, Stopwatch sw, CancellationToken ct)
    {
        var d = env.Payload;
        var ack = await _client.SubmitInspectionAsync(
            serialNumber: GetString(d, "serialNumber") ?? "",
            overallResult: GetString(d, "overallResult") ?? "",
            measurements: ReadMeasurements(d),
            productModel: GetString(d, "productModel"),
            variantCode: GetString(d, "variantCode"),
            idempotencyKey: GetString(d, "idempotencyKey") ?? env.IdempotencyKey,
            ts: GetString(d, "ts"),
            panelId: GetString(d, "panelId"),
            boardIndex: GetInt(d, "boardIndex"),
            inspectionTime: GetString(d, "inspectionTime"),
            machineCode: GetString(d, "machineCode") ?? env.MachineCode,
            ct: ct).ConfigureAwait(false);
        sw.Stop();
        return new TransportAck(
            Success: ack.Success,
            Id: ack.InspectionId,
            Duplicate: ack.Duplicate,
            Queued: ack.Queued,
            HttpStatus: 201,
            LatencyMs: sw.ElapsedMilliseconds);
    }

    private async Task<TransportAck> SendTelemetryAsync(CanonicalEnvelope env, Stopwatch sw, CancellationToken ct)
    {
        var ack = await _client.SubmitTelemetryAsync(ReadSamples(env.Payload), ct).ConfigureAwait(false);
        sw.Stop();
        // TelemetryAck carries no Success flag of its own — reaching here at all means the SDK got a
        // 2xx back (anything else surfaced as an exception, handled above).
        return new TransportAck(
            Success: true,
            Accepted: ack.Accepted,
            HttpStatus: 202,
            LatencyMs: sw.ElapsedMilliseconds,
            RawBody: ack.Machine);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Heartbeat / config-sync — the brief only strictly specifies SendAsync's behavior; these two are
    // a reasonable mapping onto the SDK's own Heartbeat/CheckConfig calls (noted in task-6-report.md).
    // ─────────────────────────────────────────────────────────────────────
    public async Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct)
    {
        // The wrapped client is already bound to one machine (see class doc) — machineCode is accepted
        // to satisfy ITransport but the SDK call itself doesn't take one.
        try
        {
            var data = await _client.HeartbeatAsync(ct).ConfigureAwait(false);
            return new HeartbeatResult(
                Success: JsonBool(data, "success"),
                MachineId: JsonLong(data, "machineId"),
                KeyStatus: JsonString(data, "keyStatus"),
                KeyExpiresInDays: JsonInt(data, "keyExpiresInDays"));
        }
        catch (St4iNetworkException)
        {
            return new HeartbeatResult(false, null, null, null);
        }
        catch (St4iApiException)
        {
            return new HeartbeatResult(false, null, null, null);
        }
        catch (St4iConfigException)
        {
            // Unconfigured (no mk_) — see SendAsync's St4iConfigException catch remarks. Same
            // Success:false shape AutoTransport.HeartbeatAsync already treats as a fallback trigger.
            return new HeartbeatResult(false, null, null, null);
        }
    }

    public async Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct)
    {
        // ITransport's SyncConfigAsync has no "apply" callback — it is a lightweight version CHECK
        // (mirrors DemoTransport's own behavior), not the SDK's full check->get->apply->ack loop.
        try
        {
            var chk = await _client.CheckConfigAsync(configKind: configKind, ct: ct).ConfigureAwait(false);
            var changed = !string.Equals(cachedVersion, chk.Version, StringComparison.Ordinal);
            return new ConfigSyncResult(changed, chk.Version, changed ? "synced" : "none", Applied: true);
        }
        catch (St4iNetworkException)
        {
            return new ConfigSyncResult(false, cachedVersion, "error", Applied: false);
        }
        catch (St4iApiException)
        {
            return new ConfigSyncResult(false, cachedVersion, "error", Applied: false);
        }
        catch (St4iConfigException)
        {
            // Unconfigured (no mk_) — see SendAsync's St4iConfigException catch remarks. Same
            // DriftState=="error" shape AutoTransport.SyncConfigAsync already treats as a fallback trigger.
            return new ConfigSyncResult(false, cachedVersion, "error", Applied: false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Payload readers — translate the Dictionary<string,object> the Normalizer produced into the
    // SDK's typed DTOs. Each nested entry is itself an IDictionary<string,object> (Normalizer emits
    // Dictionary<string,object?> — the same runtime type; nullable annotations are erased).
    // ─────────────────────────────────────────────────────────────────────
    private static readonly HashSet<string> ProcessResultKnownKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "schemaVersion", "machineCode", "serialNumber", "stepType", "result", "ts", "idempotencyKey",
        "metrics", "waveforms", "recipe",
    };

    private static List<Metric>? ReadMetrics(IDictionary<string, object> payload)
    {
        if (!payload.TryGetValue("metrics", out var raw) || raw is null) return null;
        var list = new List<Metric>();
        foreach (var entry in AsEnumerable(raw))
        {
            var d = AsDict(entry);
            if (d is null) continue;
            list.Add(new Metric
            {
                Name = GetString(d, "name") ?? "",
                Value = GetDouble(d, "value") ?? 0.0,
                Unit = GetString(d, "unit"),
                Lsl = GetDouble(d, "lsl"),
                Usl = GetDouble(d, "usl"),
                Nominal = GetDouble(d, "nominal"),
            });
        }
        return list;
    }

    private static List<Waveform>? ReadWaveforms(IDictionary<string, object> payload)
    {
        if (!payload.TryGetValue("waveforms", out var raw) || raw is null) return null;
        var list = new List<Waveform>();
        foreach (var entry in AsEnumerable(raw))
        {
            var d = AsDict(entry);
            if (d is null) continue;
            list.Add(new Waveform
            {
                Name = GetString(d, "name") ?? "",
                Unit = GetString(d, "unit"),
                RateHz = GetDouble(d, "rateHz"),
                Samples = ReadSampleSeries(d),
            });
        }
        return list;
    }

    private static List<double[]> ReadSampleSeries(IDictionary<string, object> waveformDict)
    {
        var series = new List<double[]>();
        if (!waveformDict.TryGetValue("samples", out var raw) || raw is null) return series;
        foreach (var point in AsEnumerable(raw))
        {
            if (point is double[] arr) series.Add(arr);
        }
        return series;
    }

    private static Recipe? ReadRecipe(IDictionary<string, object> payload)
    {
        if (!payload.TryGetValue("recipe", out var raw) || raw is null) return null;
        var d = AsDict(raw);
        if (d is null) return null;
        return new Recipe
        {
            Code = GetString(d, "code") ?? "",
            Version = GetString(d, "version"),
            Checksum = GetString(d, "checksum"),
        };
    }

    private static Dictionary<string, object>? ReadExtra(IDictionary<string, object> payload)
    {
        // Genealogy fields (lineCode/lotCode/stationId/...) travel FLAT in the payload dict alongside
        // the "known" ones the SDK already has dedicated parameters for — everything else goes to
        // SubmitProcessResultAsync's `extra` bag.
        Dictionary<string, object>? extra = null;
        foreach (var kv in payload)
        {
            if (ProcessResultKnownKeys.Contains(kv.Key)) continue;
            if (kv.Value is null) continue;
            (extra ??= new Dictionary<string, object>())[kv.Key] = kv.Value;
        }
        return extra;
    }

    private static List<Sample> ReadSamples(IDictionary<string, object> payload)
    {
        var list = new List<Sample>();
        if (!payload.TryGetValue("samples", out var raw) || raw is null) return list;
        foreach (var entry in AsEnumerable(raw))
        {
            var d = AsDict(entry);
            if (d is null) continue;
            list.Add(new Sample
            {
                Metric = GetString(d, "metric") ?? "",
                Value = d.TryGetValue("value", out var v) ? v : null,
                Unit = GetString(d, "unit") ?? "",
                Ts = GetString(d, "ts") ?? "",
                DeviceId = GetString(d, "deviceId") ?? "",
                Quality = GetString(d, "quality") ?? "",
            });
        }
        return list;
    }

    private static List<MeasurementPoint> ReadMeasurements(IDictionary<string, object> payload)
    {
        var list = new List<MeasurementPoint>();
        if (!payload.TryGetValue("measurements", out var raw) || raw is null) return list;
        foreach (var entry in AsEnumerable(raw))
        {
            var d = AsDict(entry);
            if (d is null) continue;
            list.Add(new MeasurementPoint
            {
                PointCode = GetString(d, "pointCode") ?? "",
                MeasuredValue = GetDouble(d, "measuredValue"),
                Result = GetString(d, "result") ?? "",
                Unit = GetString(d, "unit") ?? "",
                DefectCatalogCode = GetString(d, "defectCatalogCode"),
                DefectSeverity = GetString(d, "defectSeverity"),
                ValueHeight = GetDouble(d, "valueHeight"),
                ValueArea = GetDouble(d, "valueArea"),
                ValueVolume = GetDouble(d, "valueVolume"),
                ValueVoidPct = GetDouble(d, "valueVoidPct"),
                ValueCoplanarity = GetDouble(d, "valueCoplanarity"),
                ValueWarpage = GetDouble(d, "valueWarpage"),
                ValueOffsetX = GetDouble(d, "valueOffsetX"),
                ValueOffsetY = GetDouble(d, "valueOffsetY"),
                ValueTilt = GetDouble(d, "valueTilt"),
                ValueThickness = GetDouble(d, "valueThickness"),
                ValueZ = GetDouble(d, "valueZ"),
                ImageBase64 = GetString(d, "imageBase64") ?? "",
            });
        }
        return list;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Small untyped-dictionary/JsonElement accessors.
    // ─────────────────────────────────────────────────────────────────────
    private static IEnumerable<object?> AsEnumerable(object raw)
    {
        if (raw is IEnumerable en and not string)
        {
            foreach (var item in en) yield return item;
        }
    }

    private static IDictionary<string, object>? AsDict(object? entry) => entry as IDictionary<string, object>;

    private static string? GetString(IDictionary<string, object> d, string key)
    {
        if (!d.TryGetValue(key, out var v) || v is null) return null;
        return v as string ?? Convert.ToString(v, CultureInfo.InvariantCulture);
    }

    private static double? GetDouble(IDictionary<string, object> d, string key)
    {
        if (!d.TryGetValue(key, out var v) || v is null) return null;
        return v switch
        {
            double dd => dd,
            float f => f,
            int i => i,
            long l => l,
            short s => s,
            decimal m => (double)m,
            string str when double.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null,
        };
    }

    private static int? GetInt(IDictionary<string, object> d, string key)
    {
        var value = GetDouble(d, key);
        return value.HasValue ? (int)value.Value : null;
    }

    private static bool JsonBool(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static long? JsonLong(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetInt64()
            : null;

    private static int? JsonInt(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetInt32()
            : null;

    private static string? JsonString(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}
