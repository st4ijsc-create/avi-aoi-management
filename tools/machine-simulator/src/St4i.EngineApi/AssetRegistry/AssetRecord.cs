namespace St4i.EngineApi.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — one persisted asset. <see cref="DeviceClass"/> is stored/carried as the
/// enum member NAME (storage-stable — see <see cref="AssetRegistryStore"/>'s schema doc comment for why
/// plain TEXT columns, not integers, hold them). <see cref="DriverKind"/> is already a plain
/// <see langword="string"/> at the source (GP-3 opened it from a closed enum into the connector's own
/// free-form id — see <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/>), so it round-trips
/// through this TEXT column completely unchanged, built-in or third-party alike. <see cref="ConfigChecksum"/>
/// is a stable fingerprint of the descriptor at the time of the last upsert (drift-vs-ecosystem is
/// config-sync's own job — see <c>ConfigDriftService</c>/<c>MachineState.DriftState</c> — this checksum
/// is purely "what did this asset's descriptor look like last time it registered", the raw material a
/// future comparison could use, not a drift verdict itself).
/// </summary>
public sealed record AssetRecord(
    string Urn,
    string Code,
    string DeviceClass,
    string DriverKind,
    string MachineType,
    AssetLifecycleState Lifecycle,
    string? ConfigChecksum,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);
