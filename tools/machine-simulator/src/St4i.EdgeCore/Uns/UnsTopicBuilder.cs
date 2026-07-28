using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Uns;

/// <summary>
/// The Sparkplug B node/device lifecycle + data message kinds this hand-rolled UNS spine addresses.
/// NBIRTH/NDEATH/DBIRTH/DDEATH are landed here only as topic-building targets for G2-3 (the actual
/// birth/death SEQUENCING — when to emit them, MQTT Will wiring for a real NDEATH-on-disconnect — is
/// explicitly out of scope for this task; see <see cref="UnsPublisher.PublishBirth"/>/
/// <see cref="UnsPublisher.PublishDeath"/>). G2-2's own wiring only ever produces <see cref="DDATA"/>.
/// </summary>
public enum SparkplugMsgType
{
    NBIRTH,
    NDEATH,
    DBIRTH,
    DDEATH,
    NDATA,
    DDATA,
}

/// <summary>
/// G2-2 — pure, unit-testable builders for the two topic families every canonical reading is additively
/// mirrored onto (see <see cref="UnsPublisher"/>): the Sparkplug B wire topic and the retained semantic
/// <c>syn/...</c> mirror. Neither builder touches the network/broker — both are total functions of
/// (<see cref="UnsOptions"/>, an equipment code, and either a <see cref="SparkplugMsgType"/> or a
/// <see cref="ReadingKind"/>), which is what makes them cheap to lock down with plain unit tests.
/// </summary>
public static class UnsTopicBuilder
{
    private const string SparkplugNamespace = "spBv1.0";
    private const string SemanticNamespace = "syn";

    /// <summary>The Sparkplug B <c>group_id</c>: <c>{site}.{area}.{line}</c>.</summary>
    public static string GroupId(UnsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return $"{options.Site}.{options.Area}.{options.Line}";
    }

    /// <summary>NBIRTH/NDEATH/NDATA are edge-node-level (no device segment); DBIRTH/DDEATH/DDATA are
    /// device-level (require an equipment/device_id segment).</summary>
    public static bool IsDeviceLevel(SparkplugMsgType msgType) =>
        msgType is SparkplugMsgType.DBIRTH or SparkplugMsgType.DDEATH or SparkplugMsgType.DDATA;

    /// <summary>
    /// Builds the Sparkplug B wire topic: <c>spBv1.0/{group_id}/{msgType}/{edge_node_id}[/{device_id}]</c>
    /// — <c>edge_node_id</c> is <see cref="UnsOptions.Cell"/> (this process models exactly one Sparkplug
    /// edge node); <c>device_id</c> (<paramref name="equipmentCode"/>) is only appended for a
    /// <see cref="IsDeviceLevel"/> <paramref name="msgType"/>, and is REQUIRED in that case.
    /// </summary>
    public static string BuildSparkplugTopic(UnsOptions options, SparkplugMsgType msgType, string? equipmentCode = null)
    {
        ArgumentNullException.ThrowIfNull(options);

        var basePath = $"{SparkplugNamespace}/{GroupId(options)}/{msgType}/{options.Cell}";
        if (!IsDeviceLevel(msgType))
        {
            return basePath;
        }

        if (string.IsNullOrWhiteSpace(equipmentCode))
        {
            throw new ArgumentException($"{msgType} is device-level and requires a non-blank equipmentCode.", nameof(equipmentCode));
        }

        return $"{basePath}/{equipmentCode}";
    }

    /// <summary>Overload taking a <see cref="MachineDescriptor"/> directly (its <see cref="MachineDescriptor.Code"/>
    /// is the Sparkplug <c>device_id</c>/equipment segment) — the shape unit tests exercise directly.</summary>
    public static string BuildSparkplugTopic(UnsOptions options, MachineDescriptor device, SparkplugMsgType msgType)
    {
        ArgumentNullException.ThrowIfNull(device);
        return BuildSparkplugTopic(options, msgType, device.Code);
    }

    /// <summary>Convenience for the one message kind G2-2's own wiring actually publishes.</summary>
    public static string BuildSparkplugDataTopic(UnsOptions options, MachineDescriptor device) =>
        BuildSparkplugTopic(options, device, SparkplugMsgType.DDATA);

    /// <summary>Same as <see cref="BuildSparkplugDataTopic(UnsOptions,MachineDescriptor)"/> but for callers
    /// (e.g. <see cref="UnsPublisher"/>, which only ever sees a <see cref="DeviceReading.MachineCode"/>,
    /// never a full <see cref="MachineDescriptor"/>) that only have the equipment code string in hand.</summary>
    public static string BuildSparkplugDataTopic(UnsOptions options, string equipmentCode) =>
        BuildSparkplugTopic(options, SparkplugMsgType.DDATA, equipmentCode);

    /// <summary>
    /// Builds the retained semantic-mirror topic: <c>syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}</c>,
    /// where <c>aspect</c> is <see cref="AspectFor"/>'s result/telemetry/inspection mapping of
    /// <paramref name="kind"/> — the same three <see cref="ReadingKind"/> buckets
    /// <see cref="St4i.EdgeCore.Mapping.Normalizer"/> already switches on for the HTTP ingest paths.
    /// </summary>
    public static string BuildSemanticTopic(UnsOptions options, MachineDescriptor device, ReadingKind kind)
    {
        ArgumentNullException.ThrowIfNull(device);
        return BuildSemanticTopic(options, device.Code, kind);
    }

    /// <summary>String-equipment-code overload — see <see cref="BuildSparkplugDataTopic(UnsOptions,string)"/>'s
    /// doc comment for why this exists alongside the <see cref="MachineDescriptor"/> overload.</summary>
    public static string BuildSemanticTopic(UnsOptions options, string equipmentCode, ReadingKind kind)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentException.ThrowIfNullOrEmpty(equipmentCode);
        return $"{SemanticNamespace}/{options.Site}/{options.Area}/{options.Line}/{options.Cell}/{equipmentCode}/{AspectFor(kind)}";
    }

    /// <summary>GĐ3 sub-4 LC-3 — the retained topic <see cref="UnsPublisher.PublishLineState"/> publishes
    /// the PackML line state onto: <c>syn/{site}/{area}/{line}/{cell}/_line/state</c>. Deliberately its OWN
    /// builder (not a <see cref="BuildSemanticTopic(UnsOptions,string,ReadingKind)"/> overload) — the line
    /// state isn't keyed by an equipment code/<see cref="ReadingKind"/> at all, it's a single per-process
    /// value, hence the fixed literal <c>_line</c> segment (underscore-prefixed so it can never collide with
    /// a real equipment code, which this codebase always derives from <see cref="St4i.EdgeCore.Models.MachineDescriptor.Code"/>).</summary>
    public static string BuildLineStateTopic(UnsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return $"{SemanticNamespace}/{options.Site}/{options.Area}/{options.Line}/{options.Cell}/_line/state";
    }

    /// <summary>GĐ3 closeout WI-3 — the retained topic <see cref="St4i.EdgeCore.Site.UnsBridge"/> publishes
    /// its resync record onto, immediately after a successful remote (Site) reconnect and BEFORE replaying
    /// any spooled backlog: <c>syn/{site}/{area}/{line}/{cell}/_bridge/resync</c>. Same underscore-prefixed
    /// fixed-segment idiom as <see cref="BuildLineStateTopic"/>'s own <c>_line</c> segment (can never collide
    /// with a real equipment code) — <c>_bridge</c> here instead of <c>_line</c>.</summary>
    public static string BuildBridgeResyncTopic(UnsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return $"{SemanticNamespace}/{options.Site}/{options.Area}/{options.Line}/{options.Cell}/_bridge/resync";
    }

    /// <summary>result|telemetry|inspection — the semantic-mirror "aspect" segment for each
    /// <see cref="ReadingKind"/>, matching the same three buckets <see cref="St4i.EdgeCore.Mapping.Normalizer.Normalize"/>
    /// switches on (ProcessResult/Telemetry/Inspection → the same three HTTP ingest paths).</summary>
    public static string AspectFor(ReadingKind kind) => kind switch
    {
        ReadingKind.ProcessResult => "result",
        ReadingKind.Telemetry => "telemetry",
        ReadingKind.Inspection => "inspection",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown ReadingKind"),
    };
}
